// Computes the CSP SHA-256 hash of every inline <script> in index.html and checks (or updates) the
// script-src of the Content-Security-Policy in vercel.json.
//
//   node tools/csp-hash.js           check only — exits 1 if vercel.json is out of date
//   node tools/csp-hash.js --write   update vercel.json
//
// Line endings are normalised to LF, matching what Git stores and Vercel serves (.gitattributes).
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const root = path.join(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8").replace(/\r\n/g, "\n");
const hashes = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
  .map((m) => "'sha256-" + crypto.createHash("sha256").update(m[1], "utf8").digest("base64") + "'");

const cfgPath = path.join(root, "vercel.json");
const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
const header = cfg.headers.flatMap((h) => h.headers).find((h) => h.key === "Content-Security-Policy");
const policy = header.value;
const scriptSrc = policy.split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src"));
const current = (scriptSrc.match(/'sha256-[^']+'/g) || []);
const ok = hashes.length === current.length && hashes.every((h) => current.includes(h));

console.log("inline scripts in index.html:", hashes.length);
hashes.forEach((h) => console.log("  " + h));
console.log("vercel.json script-src:", ok ? "up to date" : "OUT OF DATE");

if (!ok && process.argv.includes("--write")) {
  const others = scriptSrc.split(/\s+/).slice(1).filter((t) => !/^'sha256-/.test(t));
  const updated = ["script-src", ...others, ...hashes].join(" ");
  header.value = policy.replace(scriptSrc, updated);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  console.log("vercel.json updated.");
} else if (!ok) {
  process.exitCode = 1;
}
