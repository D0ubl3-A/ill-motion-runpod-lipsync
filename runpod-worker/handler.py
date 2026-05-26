import os
import ipaddress
import shutil
import socket
import subprocess
import sys
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import requests
import runpod


WORK_ROOT = Path(os.getenv("WORK_ROOT", "/tmp/illco-lipsync"))
LATENTSYNC_ROOT = Path(os.getenv("LATENTSYNC_ROOT", "/opt/LatentSync"))
MAX_VIDEO_SECONDS_DEFAULT = int(os.getenv("MAX_VIDEO_SECONDS", "60"))
MAX_VIDEO_BYTES = int(os.getenv("MAX_VIDEO_BYTES", str(600 * 1024 * 1024)))
MAX_AUDIO_BYTES = int(os.getenv("MAX_AUDIO_BYTES", str(100 * 1024 * 1024)))
ALLOWED_ASSET_HOSTS = {
    host.strip().lower()
    for host in os.getenv("ALLOWED_ASSET_HOSTS", "").split(",")
    if host.strip()
}


def handler(event: dict[str, Any]) -> dict[str, Any]:
    if not ALLOWED_ASSET_HOSTS:
        raise RuntimeError("ALLOWED_ASSET_HOSTS must be configured before accepting media URLs.")

    started = time.perf_counter()
    payload = event.get("input") or {}
    video_url = required_url(payload, "video_url", require_allowed_host=True)
    audio_url = required_url(payload, "audio_url", require_allowed_host=True)
    output_upload_url = required_url(payload, "output_upload_url", require_allowed_host=True)
    output_url = required_url(payload, "output_url", require_allowed_host=True)
    audio_mode = normalize_choice(payload.get("audio_mode"), {"voiceover", "music"}, "voiceover")
    render_tier = normalize_choice(payload.get("render_tier"), {"economy", "standard", "precision"}, "standard")
    anti_identity_blending = bool(payload.get("anti_identity_blending", True))
    identity = payload.get("identity") if isinstance(payload.get("identity"), dict) else {}
    max_video_seconds = clamp_int(payload.get("max_video_seconds"), 1, 120, MAX_VIDEO_SECONDS_DEFAULT)
    inference_steps = clamp_int(payload.get("inference_steps"), 10, 50, 20)
    guidance_scale = clamp_float(payload.get("guidance_scale"), 1.0, 3.0, 1.5)

    job_dir = WORK_ROOT / str(uuid.uuid4())
    job_dir.mkdir(parents=True, exist_ok=True)

    try:
        video_path = job_dir / "input_video.mp4"
        audio_path = job_dir / "input_audio"
        prepared_audio_path = job_dir / "prepared_audio.wav"
        output_path = job_dir / "output.mp4"

        download_file(video_url, video_path, max_bytes=MAX_VIDEO_BYTES)
        audio_path = download_file(audio_url, audio_path, preserve_extension=True, max_bytes=MAX_AUDIO_BYTES)
        video_seconds = enforce_media_duration(video_path, max_video_seconds, "Video")
        audio_seconds = enforce_media_duration(audio_path, max_video_seconds, "Audio")
        prepare_audio(audio_path, prepared_audio_path, max_video_seconds)
        if anti_identity_blending:
            enforce_single_face_source(video_path)
        run_latentsync(video_path, prepared_audio_path, output_path, inference_steps, guidance_scale)
        upload_file(output_upload_url, output_path)

        return {
            "output_url": output_url,
            "elapsed_ms": int((time.perf_counter() - started) * 1000),
            "engine": "LatentSync 1.6",
            "audio_mode": audio_mode,
            "render_tier": render_tier,
            "inference_steps": inference_steps,
            "guidance_scale": guidance_scale,
            "source_video_seconds": round(video_seconds, 3),
            "source_audio_seconds": round(audio_seconds, 3),
            "identity_policy": {
                "mode": "single_source_face",
                "anti_identity_blending": anti_identity_blending,
                "profile_id": str(identity.get("profileId") or identity.get("profile_id") or ""),
                "reference_url_count": len(identity.get("referenceUrls") or identity.get("reference_urls") or []),
            },
        }
    finally:
        shutil.rmtree(job_dir, ignore_errors=True)


def required_url(payload: dict[str, Any], key: str, require_allowed_host: bool = False) -> str:
    value = str(payload.get(key) or "").strip()
    if not value:
        raise ValueError(f"{key} is required.")

    parsed = urlparse(value)
    if parsed.scheme not in {"http", "https"}:
        raise ValueError(f"{key} must be an HTTP(S) URL.")
    if require_allowed_host and ALLOWED_ASSET_HOSTS and not host_is_allowed(parsed.hostname or ""):
        raise ValueError(f"{key} host is not in ALLOWED_ASSET_HOSTS.")
    assert_public_hostname(parsed.hostname or "", key)
    return value


def host_is_allowed(hostname: str) -> bool:
    host = hostname.lower()
    for allowed in ALLOWED_ASSET_HOSTS:
        normalized = allowed.removeprefix("*.").lower()
        if host == normalized or host.endswith(f".{normalized}"):
            return True
    return False


def download_file(url: str, path: Path, preserve_extension: bool = False, max_bytes: int = 0) -> Path:
    target = path
    if preserve_extension:
        suffix = Path(urlparse(url).path).suffix
        target = path.with_suffix(suffix if suffix else ".wav")

    with requests.get(url, stream=True, timeout=120, allow_redirects=False) as response:
        response.raise_for_status()
        content_length = int(response.headers.get("content-length") or 0)
        if max_bytes and content_length > max_bytes:
            raise ValueError(f"Input file is too large. Limit is {max_bytes} bytes.")
        bytes_written = 0
        with target.open("wb") as file:
            for chunk in response.iter_content(chunk_size=1024 * 1024):
                if chunk:
                    bytes_written += len(chunk)
                    if max_bytes and bytes_written > max_bytes:
                        raise ValueError(f"Input file exceeded limit of {max_bytes} bytes.")
                    file.write(chunk)
    return target


def upload_file(url: str, path: Path) -> None:
    with path.open("rb") as file:
        response = requests.put(url, data=file, headers={"Content-Type": "video/mp4"}, timeout=300, allow_redirects=False)
    response.raise_for_status()


def assert_public_hostname(hostname: str, label: str) -> None:
    if not hostname:
        raise ValueError(f"{label} must include a hostname.")
    for _, _, _, _, sockaddr in socket.getaddrinfo(hostname, None):
        ip = ipaddress.ip_address(sockaddr[0])
        if (
            ip.is_private
            or ip.is_loopback
            or ip.is_link_local
            or ip.is_multicast
            or ip.is_reserved
            or ip.is_unspecified
        ):
            raise ValueError(f"{label} resolves to a non-public address.")


def prepare_audio(input_path: Path, output_path: Path, max_seconds: int) -> None:
    command = [
        "ffmpeg",
        "-y",
        "-i",
        str(input_path),
        "-t",
        str(max_seconds),
        "-ac",
        "1",
        "-ar",
        "16000",
        "-af",
        "loudnorm=I=-16:TP=-1.5:LRA=11",
        str(output_path),
    ]
    subprocess.run(command, check=True, capture_output=True, text=True, timeout=300)


def enforce_media_duration(path: Path, max_seconds: int, label: str) -> float:
    command = [
        "ffprobe",
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        str(path),
    ]
    result = subprocess.run(command, check=True, capture_output=True, text=True)
    duration = float(result.stdout.strip())
    if duration > max_seconds:
        raise ValueError(f"{label} is {duration:.1f}s. Max allowed is {max_seconds}s for this endpoint.")
    return duration


def enforce_single_face_source(video_path: Path) -> None:
    import cv2
    import mediapipe as mp

    capture = cv2.VideoCapture(str(video_path))
    if not capture.isOpened():
        raise ValueError("Could not open source video for identity preflight.")

    try:
        frame_count = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        sample_indexes = build_sample_indexes(frame_count, 12)
        max_faces = 0
        best_face_area = 0.0

        with mp.solutions.face_detection.FaceDetection(model_selection=1, min_detection_confidence=0.55) as detector:
            for frame_index in sample_indexes:
                capture.set(cv2.CAP_PROP_POS_FRAMES, frame_index)
                ok, frame = capture.read()
                if not ok:
                    continue
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                result = detector.process(rgb)
                detections = result.detections or []
                face_count = len(detections)
                max_faces = max(max_faces, face_count)
                if detections:
                    best_face_area = max(best_face_area, max_face_area(detections))
                if max_faces > 1:
                    raise ValueError(
                        "Multiple faces detected in the source video. Use one primary character per lip-sync job to prevent identity blending."
                    )
    finally:
        capture.release()

    if max_faces < 1:
        raise ValueError("No face detected in the source video.")
    if best_face_area < 0.035:
        raise ValueError("Detected face is too small for reliable lip sync. Use a closer source clip with the character's mouth clearly visible.")


def max_face_area(detections: list[Any]) -> float:
    areas = []
    for detection in detections:
        box = detection.location_data.relative_bounding_box
        areas.append(max(0.0, box.width) * max(0.0, box.height))
    return max(areas or [0.0])


def build_sample_indexes(frame_count: int, samples: int) -> list[int]:
    if frame_count <= 1:
        return [0]
    if frame_count <= samples:
        return list(range(frame_count))
    return [round(index * (frame_count - 1) / (samples - 1)) for index in range(samples)]


def run_latentsync(
    video_path: Path,
    audio_path: Path,
    output_path: Path,
    inference_steps: int,
    guidance_scale: float,
) -> None:
    command = [
        sys.executable,
        "-m",
        "scripts.inference",
        "--unet_config_path",
        "configs/unet/stage2_512.yaml",
        "--inference_ckpt_path",
        "checkpoints/latentsync_unet.pt",
        "--inference_steps",
        str(inference_steps),
        "--guidance_scale",
        str(guidance_scale),
        "--enable_deepcache",
        "--video_path",
        str(video_path),
        "--audio_path",
        str(audio_path),
        "--video_out_path",
        str(output_path),
    ]
    subprocess.run(command, cwd=LATENTSYNC_ROOT, check=True, timeout=1800)


def clamp_int(value: Any, minimum: int, maximum: int, fallback: int) -> int:
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return fallback
    return min(maximum, max(minimum, parsed))


def clamp_float(value: Any, minimum: float, maximum: float, fallback: float) -> float:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        return fallback
    return min(maximum, max(minimum, parsed))


def normalize_choice(value: Any, allowed_values: set[str], fallback: str) -> str:
    normalized = str(value or "").strip().lower()
    return normalized if normalized in allowed_values else fallback


runpod.serverless.start({"handler": handler})
