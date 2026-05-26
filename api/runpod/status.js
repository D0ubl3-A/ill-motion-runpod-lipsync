const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || "";
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID || "";
const LIPSYNC_API_TOKEN = process.env.LIPSYNC_API_TOKEN || "";
const RUNPOD_BASE_URL = "https://api.runpod.ai/v2";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
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

  const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
  const jobId = String(url.searchParams.get("jobId") || "").trim();

  if (!jobId) {
    return response.status(400).json({ error: "jobId is required." });
  }

  const upstream = await fetch(`${RUNPOD_BASE_URL}/${RUNPOD_ENDPOINT_ID}/status/${encodeURIComponent(jobId)}`, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${RUNPOD_API_KEY}`,
    },
  });
  const result = await readUpstreamJson(upstream);

  response.status(upstream.status).json({
    id: result?.id || jobId,
    status: result?.status || null,
    outputUrl: result?.output?.output_url || null,
    elapsedMs: result?.output?.elapsed_ms || null,
    error: result?.error || result?.output?.error || null,
  });
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
