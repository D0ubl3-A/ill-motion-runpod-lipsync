# RunPod Lip Sync Bridge

This replaces the Kaggle tunnel idea with a compliant RunPod Serverless setup.

The GPU workload is intentionally scoped to lip sync only.

Architecture:

- Google AI Studio app calls the Vercel proxy.
- Vercel proxy calls RunPod Serverless `/run`.
- RunPod runs the GPU worker only when lip-sync jobs are executing.

## Billing Setup

In RunPod Serverless, use:

- Endpoint type: Queue-based
- Workers min: `0`
- Workers max: `1` to start, `3` after traffic exists
- Idle timeout: `5` to `15` seconds
- GPU: L4/A5000/3090 tier first

This is the important setting: `workersMin=0`. It keeps idle GPU cost at zero.

## Product Defaults

Default decision:

- GPU is only used for lip sync.
- Audio can be either `voiceover` or `music`.
- A project can include the owner plus 2 collaborators.
- The source video must contain one primary face. Multi-face clips are rejected before rendering to prevent identity blending.
- Character accuracy comes from a clean source clip: one face, stable lighting, front-facing mouth, and matching audio duration.

Render tiers:

| Tier | Max input | Steps | Suggested customer price | Use case |
| --- | ---: | ---: | ---: | --- |
| `economy` | 30s | 16 | `$0.75` | quick clips and previews |
| `standard` | 75s | 20 | `$1.49` | default voiceover/music-video clips |
| `precision` | 120s | 30 | `$2.99` | higher quality character accuracy |

## RunPod Worker

The starter worker lives in `runpod-worker/`.

It serves LatentSync 1.6:

```text
ByteDance/LatentSync-1.6
```

LatentSync 1.6 needs roughly 18GB VRAM for inference, so use the 24GB RunPod tier. If we need lower cost later, we can add a separate low-quality fallback, but this is the better first production target.

## Deploy Worker

The easiest path:

1. Push this folder to GitHub.
2. In RunPod Console, create a new Serverless endpoint.
3. Choose GitHub/Docker deployment.
4. Point the build context to `runpod-worker/`.
5. Select the GPU tier.
6. Set `workersMin=0`.
7. Deploy and copy the endpoint ID.

Runtime env vars for RunPod:

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `MAX_VIDEO_SECONDS` | No | `60` | Hard limit for input video length |
| `MAX_VIDEO_BYTES` | No | `629145600` | Hard limit for source video download size |
| `MAX_AUDIO_BYTES` | No | `104857600` | Hard limit for source audio download size |
| `ALLOWED_ASSET_HOSTS` | Recommended | empty | Comma-separated host allowlist for signed asset URLs |

RunPod secrets are optional for this first worker. The worker receives signed URLs from Vercel/app code:

- `video_url`: signed GET URL for the source video
- `audio_url`: signed GET URL for the speech/audio track
- `output_upload_url`: signed PUT URL for the result video
- `output_url`: signed/public GET URL to return to the app

Set `ALLOWED_ASSET_HOSTS` once your storage domain is known. Example:

```text
ALLOWED_ASSET_HOSTS=pub-abc123.r2.dev,my-bucket.s3.amazonaws.com
```

If you create RunPod secrets later, use lowercase/underscore names such as `illco_r2_access_key`, then reference them as environment variables like `R2_ACCESS_KEY_ID={{ RUNPOD_SECRET_illco_r2_access_key }}`. Do not put the RunPod API key inside the worker.

## Deploy Vercel Proxy

Set these Vercel env vars:

| Variable | Required | Purpose |
| --- | --- | --- |
| `RUNPOD_API_KEY` | Yes | Secret RunPod API key |
| `RUNPOD_ENDPOINT_ID` | Yes | Serverless endpoint ID |
| `LIPSYNC_API_TOKEN` | Recommended before launch | Optional route lock for paid GPU job submission/status |

Then deploy:

```powershell
npm run build
vercel deploy --prod -y --scope illcoai
```

`LIPSYNC_API_TOKEN` is required by the bridge before any paid GPU job can be submitted. Do not expose it in browser-only code. The production app should call this bridge from an authenticated server action/API route after checking the user, project, credits, and collaborator permissions.

## App Call

From Google AI Studio or any frontend, call Vercel, not RunPod directly:

```js
const response = await fetch("/api/runpod/lipsync", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    videoUrl,
    audioUrl,
    outputUploadUrl,
    outputUrl,
    audioMode: "voiceover", // or "music"
    renderTier: "standard", // economy, standard, precision
    collaborators: ["person1@example.com", "person2@example.com"],
    identity: {
      profileId: "character-001",
      referenceUrls: [],
      antiIdentityBlending: true
    }
  })
});

const result = await response.json();
console.log(result.id || result.outputUrl);
```

Jobs are always async. Poll:

```text
/api/runpod/status?jobId=<job-id>
```

## Profit Check

Use the margin helper:

```text
/api/runpod/margin?seconds=90&price=1.00&gpuHourly=0.69
```

Example:

- 90 seconds at `$0.69/hr` costs about `$0.01725`.
- Charging `$1.00` gives roughly `98%` gross margin before payment, failed-job, storage, Vercel, and support costs.

Tier examples:

```text
/api/runpod/margin?tier=economy
/api/runpod/margin?tier=standard
/api/runpod/margin?tier=precision
```

## Sources

- RunPod Serverless overview: https://docs.runpod.io/serverless
- RunPod endpoint requests: https://docs.runpod.io/serverless/endpoints/get-started
- RunPod environment variables: https://docs.runpod.io/serverless/development/environment-variables
- RunPod pricing: https://www.runpod.io/pricing
