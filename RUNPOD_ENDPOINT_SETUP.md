# RunPod Endpoint Setup

This project is not demo-video ready until this checklist is complete and a real lip-sync job succeeds.

## Endpoint

Create a RunPod Serverless endpoint from the RunPod console.

Recommended path:

1. Open RunPod Console -> Serverless -> New Endpoint.
2. Choose Docker registry import when the GitHub Actions image is ready.
3. Image: `ghcr.io/d0ubl3-a/ill-motion-runpod-lipsync/lipsync-worker:latest`.
4. If importing from GitHub instead, use build context `runpod-worker/` and Dockerfile path `runpod-worker/Dockerfile`.
5. Endpoint type: Queue.
6. GPU: 24GB minimum.
   - Preferred: L4, A5000, RTX 3090 24GB.
   - Avoid: 16GB GPUs.
7. Scaling:
   - Active workers / workersMin: `0`.
   - Max workers / workersMax: `1` for launch.
   - GPUs per worker: `1`.
   - Idle timeout: `5s` to `15s`.
   - Execution timeout: `1800s`.
8. Environment:
   - `ALLOWED_ASSET_HOSTS=blob.vercel-storage.com,ill-motion-ai.vercel.app`.
   - Optional: `MAX_VIDEO_SECONDS=60`.
   - Optional: `MAX_VIDEO_BYTES=629145600`.
   - Optional: `MAX_AUDIO_BYTES=104857600`.

After deploy, copy the endpoint ID from:

```text
https://api.runpod.ai/v2/<endpoint_id>/
```

Then set Vercel env:

```powershell
vercel env add RUNPOD_ENDPOINT_ID production --scope illcoai --sensitive --force --yes
vercel env add RUNPOD_ENDPOINT_ID preview --scope illcoai --sensitive --force --yes
```

## Required Live Proof

A finished hackathon demo needs all of this:

- `https://runpod-ai-studio-bridge.vercel.app/api/runpod/health` returns `ok: true`.
- `LIPSYNC_API_TOKEN` is configured in Vercel production/preview and only used server-side.
- `ALLOWED_ASSET_HOSTS` is configured in RunPod before accepting real uploads.
- A signed source video URL is accepted.
- A signed voiceover/music URL is accepted.
- Worker rejects an invalid multi-face or tiny-face clip.
- Worker completes a valid one-face job.
- `/api/runpod/status?jobId=<id>` returns a final output URL.
- The output video plays.

## Current Known Blockers

- RunPod endpoint ID is not configured yet.
- Storage signed URL issuer is not wired into ILL Motion yet.
- A real one-face test clip and audio file are needed for final proof.
- RunPod API key was pasted in chat earlier; rotate it before launch.

## Sources

- RunPod GitHub worker deployment: https://docs.runpod.io/serverless/workers/github-integration
- RunPod endpoint operation reference: https://docs.runpod.io/serverless/endpoints/operation-reference
- RunPod endpoint configuration: https://docs.runpod.io/serverless/endpoints/endpoint-configurations
- RunPod endpoint API: https://docs.runpod.io/api-reference/endpoints/POST/endpoints
- LatentSync: https://github.com/bytedance/LatentSync
