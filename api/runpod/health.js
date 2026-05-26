const RUNPOD_API_KEY = process.env.RUNPOD_API_KEY || "";
const RUNPOD_ENDPOINT_ID = process.env.RUNPOD_ENDPOINT_ID || "";
const LIPSYNC_API_TOKEN = process.env.LIPSYNC_API_TOKEN || "";

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed." });
  }

  const configured = Boolean(RUNPOD_API_KEY && RUNPOD_ENDPOINT_ID && LIPSYNC_API_TOKEN);
  response.status(configured ? 200 : 503).json({
    ok: configured,
    configured,
    workload: "lip-sync only",
    billingMode: "RunPod Serverless workersMin=0; GPU bills only while workers run lip-sync jobs.",
    missing: [
      !RUNPOD_API_KEY ? "RUNPOD_API_KEY" : null,
      !RUNPOD_ENDPOINT_ID ? "RUNPOD_ENDPOINT_ID" : null,
      !LIPSYNC_API_TOKEN ? "LIPSYNC_API_TOKEN" : null,
    ].filter(Boolean),
    protected: Boolean(LIPSYNC_API_TOKEN),
  });
}
