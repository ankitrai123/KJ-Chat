// Fails if server-only secrets (or their variable names) appear in browser JavaScript.
// Usage: node scripts/scan-client-bundle.mjs [distDir]   (default .next)
// Build with canary secret values first (scripts/smoke.sh does this).
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const distDir = process.argv[2] ?? process.env.NEXT_DIST_DIR ?? ".next";
const root = path.join(distDir, "static");
const forbidden = [
  "SECRET_CANARY",
  "SUPABASE_SECRET_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "LIVEKIT_API_SECRET",
  "VAPID_PRIVATE_KEY",
  "CRON_SECRET",
];

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) yield* walk(full);
    else if (/\.(js|mjs|json|html|css|map)$/.test(entry)) yield full;
  }
}

let files = 0;
const hits = [];
for (const file of walk(root)) {
  files += 1;
  const text = readFileSync(file, "utf8");
  for (const needle of forbidden) if (text.includes(needle)) hits.push(`${file}: ${needle}`);
}

if (files === 0) {
  console.error(`No client assets found under ${root}. Build first.`);
  process.exit(2);
}
if (hits.length) {
  console.error("Server secrets found in client bundles:\n" + hits.join("\n"));
  process.exit(1);
}
console.log(`Scanned ${files} client files in ${root}: no server secrets found.`);
