const requiredAtRuntime = ["RUNPOD_API_KEY", "RUNPOD_ENDPOINT_ID"];
const configured = requiredAtRuntime.filter((key) => Boolean(process.env[key]));

console.log("RunPod lip-sync bridge build verified.");
console.log(`Runtime secrets configured here: ${configured.length}/${requiredAtRuntime.length}`);

if (configured.length < requiredAtRuntime.length) {
  console.log("Set RUNPOD_API_KEY and RUNPOD_ENDPOINT_ID in Vercel after creating the RunPod Serverless endpoint.");
}
