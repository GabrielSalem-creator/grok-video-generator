/**
 * Quick stress test for Neon video API (local or production).
 * Usage: node scripts/test-neon-api.mjs [baseUrl]
 */
const base = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");

async function main() {
  console.log("Testing", `${base}/api/video/create`);
  const start = Date.now();
  const res = await fetch(`${base}/api/video/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: "A golden retriever running through a field of sunflowers, cinematic 4K",
      aspectRatio: "16:9",
    }),
  });
  const data = await res.json();
  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log("Status:", res.status, "Time:", elapsed + "s");
  console.log(JSON.stringify(data, null, 2));
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
