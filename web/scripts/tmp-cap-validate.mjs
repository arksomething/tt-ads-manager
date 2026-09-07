import { createClient } from "@supabase/supabase-js";
import { readFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
for (const file of [".env", ".env.local"]) {
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^([A-Z_0-9]+)=(.*)$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const env = (k) => process.env[k];
const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SK"), { auth: { autoRefreshToken: false, persistSession: false } });
const { data: linkData } = await admin.auth.admin.generateLink({ type: "magiclink", email: "support@gotall.app" });
const anon = createClient(env("SUPABASE_URL"), env("SUPABASE_PK"), { auth: { autoRefreshToken: false, persistSession: false } });
const { data: otpData } = await anon.auth.verifyOtp({ type: "magiclink", token_hash: linkData.properties.hashed_token });
const ref = new URL(env("SUPABASE_URL")).hostname.split(".")[0];
const cookie = `sb-${ref}-auth-token=base64-` + Buffer.from(JSON.stringify(otpData.session)).toString("base64url");
const QUERY = new URLSearchParams({
  startDate: "2026-07-01", endDate: "2026-07-31", payMode: "gained",
  videoWindowStartDate: "2026-06-24", viewWindowMode: "first-days", globalViewWindowDays: "7",
  videoFetchMode: "per-creator", campaign: "8a7bd7e4-94c8-4dfe-a7c4-7a7b59024292",
}).toString();
function complete(csv) {
  if (/rate limit/i.test(csv)) return false;
  const declared = Number((csv.match(/^Videos,(\d+)/m) ?? [])[1] ?? 0);
  if (declared < 220) return false;
  const vi = csv.indexOf("\nVIDEOS");
  if (vi < 0) return false;
  const rowCount = csv.slice(vi).split("\n").filter((l) => l.includes("tiktok.com/") || l.includes("instagram.com/")).length;
  return rowCount >= declared && csv.endsWith("\n");
}
const dest = "/tmp/cap-validate.csv";
try { unlinkSync(dest); } catch {}
const started = Date.now();
const child = spawn("curl", ["-s", "--compressed", "-H", "Connection: close", "-H", `Cookie: ${cookie}`, `http://localhost:3100/org/gotall/ugc-pay/receipt?${QUERY}&capfix=1`, "-o", dest], { stdio: "ignore" });
let exited = false;
child.on("exit", () => { exited = true; });
let csv = "";
while (Date.now() - started < 45 * 60_000) {
  await new Promise((r) => setTimeout(r, 10000));
  try { csv = readFileSync(dest, "utf8"); } catch { csv = ""; }
  if (csv && complete(csv)) { try { child.kill("SIGKILL"); } catch {} break; }
  if (exited) break;
}
console.log(`CAP-FIX RUN: ${Math.round((Date.now() - started) / 1000)}s total=$${(csv.match(/^Total pay,([\d.]+)/m) ?? [])[1]} videos=${(csv.match(/^Videos,(\d+)/m) ?? [])[1]} complete=${complete(csv)}`);
for (const name of ["Mansuhn GoTall", "heightmuncher67", "bradyboosts"]) {
  console.log(" ", csv.split("\n").find((l) => l.startsWith(name)));
}
