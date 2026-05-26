const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || "";
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID || "";
const LIPSYNC_API_TOKEN = process.env.LIPSYNC_API_TOKEN || "";
const RUNPOD_BASE_URL = "https://api.runpod.ai/v2";

const AUDIO_MODES = new Set(["voiceover", "music"]);
const RENDER_TIERS = {
  economy: {
    label: "Economy",
    maxSeconds: 30,
    inferenceSteps: 16,
    guidanceScale: 1.35,
    recommendedPrice: 0.75,
    executionTimeout: 900000,
    ttl: 1800000,
  },
  standard: {
    label: "Standard",
    maxSeconds: 75,
    inferenceSteps: 20,
    guidanceScale: 1.5,
    recommendedPrice: 1.49,
    executionTimeout: 1800000,
    ttl: 3600000,
  },
  precision: {
    label: "Precision",
    maxSeconds: 120,
    inferenceSteps: 30,
    guidanceScale: 1.7,
    recommendedPrice: 2.99,
    executionTimeout: 1800000,
    ttl: 3600000,
  },
};

export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.setHeader("Allow", "POST");
    return response.status(405).json({ error: "Method not allowed." });
  }

  if (!RUNPOD_API_KEY || !RUNPOD_ENDPOINT_ID) {
    return response.status(503).json({
      error: "RunPod bridge is not configured. Set RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID in Vercel.",
    });
  }

  if (!LIPSYNC_API_TOKEN) {
    return response.status(503).json({ error: "Lip-sync route protection is not configured." });
  }

  if (request.headers["x-illco-lipsync-token"] !== LIPSYNC_API_TOKEN) {
    return response.status(401).json({ error: "Invalid lip-sync access token." });
  }

  const body = await readJsonBody(request);
  const videoUrl = String(body.videoUrl || body.video_url || "").trim();
  const audioUrl = String(body.audioUrl || body.audio_url || "").trim();
  const outputUploadUrl = String(body.outputUploadUrl || body.output_upload_url || "").trim();
  const outputUrl = String(body.outputUrl || body.output_url || "").trim();
  const audioMode = normalizeChoice(body.audioMode || body.audio_mode, AUDIO_MODES, "voiceover");
  const renderTierKey = normalizeChoice(body.renderTier || body.render_tier, new Set(Object.keys(RENDER_TIERS)), "standard");
  const renderTier = RENDER_TIERS[renderTierKey];
  const collaborators = normalizeCollaborators(body.collaborators || []);
  const identity = normalizeIdentity(body.identity || body.characterIdentity || {});

  if (!videoUrl || !audioUrl) {
    return response.status(400).json({ error: "videoUrl and audioUrl are required." });
  }

  if (!outputUploadUrl || !outputUrl) {
    return response.status(400).json({
      error: "outputUploadUrl and outputUrl are required so RunPod can upload the finished video without sending large files through Vercel.",
    });
  }

  if (collaborators.length > 2) {
    return response.status(400).json({
      error: "A lip-sync project can include the owner plus up to 2 collaborators on this plan.",
    });
  }

  if (identity.referenceUrls.length > 1) {
    return response.status(400).json({
      error: "Only one character reference is allowed per job. This prevents identity blending across multiple people.",
    });
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);

  try {
    const upstream = await fetch(`${RUNPOD_BASE_URL}/${RUNPOD_ENDPOINT_ID}/run`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RUNPOD_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        input: {
          video_url: videoUrl,
          audio_url: audioUrl,
          output_upload_url: outputUploadUrl,
          output_url: outputUrl,
          audio_mode: audioMode,
          render_tier: renderTierKey,
          collaborators,
          identity,
          anti_identity_blending: identity.antiIdentityBlending,
          inference_steps: clampInteger(body.inferenceSteps || body.inference_steps, 10, renderTier.inferenceSteps, renderTier.inferenceSteps),
          guidance_scale: clampNumber(body.guidanceScale || body.guidance_scale, 1, renderTier.guidanceScale, renderTier.guidanceScale),
          max_video_seconds: clampInteger(body.maxVideoSeconds || body.max_video_seconds, 1, renderTier.maxSeconds, renderTier.maxSeconds),
        },
        policy: {
          executionTimeout: renderTier.executionTimeout,
          ttl: renderTier.ttl,
        },
      }),
      signal: controller.signal,
    });

    const result = await readUpstreamJson(upstream);
    if (!upstream.ok) {
      return response.status(upstream.status).json({
        error: "RunPod lip-sync request failed.",
        upstreamStatus: upstream.status,
        upstreamStatusText: result?.error || result?.message || "RunPod rejected the request.",
      });
    }

    return response.status(200).json(normalizeRunpodResult(result));
  } catch (error) {
    return response.status(error?.name === "AbortError" ? 504 : 502).json({
      error: error?.name === "AbortError" ? "RunPod lip-sync request timed out." : "RunPod lip-sync request failed.",
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function readJsonBody(request) {
  if (request.body && typeof request.body === "object") return request.body;

  const chunks = [];
  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};

  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

async function readUpstreamJson(upstream) {
  const text = await upstream.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

function normalizeRunpodResult(result) {
  const output = result?.output || null;
  return {
    id: result?.id || null,
    status: result?.status || "SUBMITTED",
    mode: "async",
    pollUrl: result?.id ? `/api/runpod/status?jobId=${encodeURIComponent(result.id)}` : null,
    outputUrl: output?.output_url || null,
    elapsedMs: output?.elapsed_ms || null,
    engine: output?.engine || null,
    audioMode: output?.audio_mode || null,
    renderTier: output?.render_tier || null,
    identityPolicy: output?.identity_policy || null,
  };
}

function normalizeChoice(value, allowedValues, fallback) {
  const normalized = String(value || "").trim().toLowerCase();
  return allowedValues.has(normalized) ? normalized : fallback;
}

function normalizeCollaborators(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((collaborator) => String(collaborator || "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

function normalizeIdentity(value) {
  const identity = value && typeof value === "object" ? value : {};
  const referenceUrls = Array.isArray(identity.referenceUrls || identity.reference_urls)
    ? (identity.referenceUrls || identity.reference_urls).map((url) => String(url || "").trim()).filter(Boolean)
    : [];

  return {
    profileId: String(identity.profileId || identity.profile_id || "").trim(),
    mode: "single_source_face",
    antiIdentityBlending: identity.antiIdentityBlending !== false && identity.anti_identity_blending !== false,
    referenceUrls,
    facePolicy: "reject_multi_face_source",
  };
}

function clampInteger(value, min, max, fallback) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}
