FROM nvidia/cuda:12.1.1-cudnn8-runtime-ubuntu22.04

ENV DEBIAN_FRONTEND=noninteractive
ENV PYTHONUNBUFFERED=1
ENV LATENTSYNC_ROOT=/opt/LatentSync
ENV WORK_ROOT=/tmp/illco-lipsync
ENV MAX_VIDEO_SECONDS=60
ENV MAX_VIDEO_BYTES=629145600
ENV MAX_AUDIO_BYTES=104857600

ARG LATENTSYNC_REF=a229c3948406bc2cf6eaf4873e662e70c6a04746

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    ffmpeg \
    git \
    libglib2.0-0 \
    libgl1 \
    python3 \
    python3-pip \
    python3-venv \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt

RUN git clone https://github.com/bytedance/LatentSync.git /opt/LatentSync \
    && cd /opt/LatentSync \
    && git checkout ${LATENTSYNC_REF}

WORKDIR /opt/LatentSync

RUN python3 -m pip install --no-cache-dir --upgrade pip setuptools wheel \
    && python3 -m pip install --no-cache-dir -r requirements.txt \
    && huggingface-cli download ByteDance/LatentSync-1.6 whisper/tiny.pt --local-dir checkpoints \
    && huggingface-cli download ByteDance/LatentSync-1.6 latentsync_unet.pt --local-dir checkpoints

WORKDIR /app

COPY requirements.txt .
RUN python3 -m pip install --no-cache-dir -r requirements.txt

COPY handler.py .

CMD ["python3", "-u", "handler.py"]
