const DEFAULT_PRICE_PER_GPU_HOUR = 0.69;
const TIER_DEFAULTS = {
  economy: { seconds: 75, price: 0.75 },
  standard: { seconds: 180, price: 1.49 },
  precision: { seconds: 360, price: 2.99 },
};

export default async function handler(request, response) {
  if (request.method !== "GET") {
    response.setHeader("Allow", "GET");
    return response.status(405).json({ error: "Method not allowed." });
  }

  const url = new URL(request.url, `https://${request.headers.host || "localhost"}`);
  const tier = normalizeTier(url.searchParams.get("tier"));
  const seconds = clampNumber(url.searchParams.get("seconds"), 1, 3600, TIER_DEFAULTS[tier].seconds);
  const customerPrice = clampNumber(url.searchParams.get("price"), 0.001, 1000, TIER_DEFAULTS[tier].price);
  const gpuHourly = clampNumber(url.searchParams.get("gpuHourly"), 0.01, 100, DEFAULT_PRICE_PER_GPU_HOUR);
  const computeCost = (gpuHourly / 3600) * seconds;
  const grossProfit = customerPrice - computeCost;
  const grossMargin = customerPrice > 0 ? grossProfit / customerPrice : 0;

  response.status(200).json({
    seconds,
    tier,
    customerPrice,
    gpuHourly,
    computeCost: roundMoney(computeCost),
    grossProfit: roundMoney(grossProfit),
    grossMarginPercent: Math.round(grossMargin * 10000) / 100,
    note: "Lip-sync estimate only. Excludes payment processor, Vercel, storage egress, model cold start, failed job, and support costs.",
  });
}

function normalizeTier(value) {
  const tier = String(value || "").trim().toLowerCase();
  return TIER_DEFAULTS[tier] ? tier : "standard";
}

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function roundMoney(value) {
  return Math.round(value * 1_000_000) / 1_000_000;
}
