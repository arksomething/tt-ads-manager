import { randomBytes, createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../creator-platform/package.json", import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const { values } = parseArgs({ options: { name: { type: "string" }, output: { type: "string" }, worker: { type: "boolean", default: false } } });
if (!values.name || !values.output?.startsWith("/")) throw new Error("Pass --name and an absolute --output path. Credentials are written only to that owner-only file.");
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const token = `${values.worker ? "trk_worker_" : "trk_live_"}${randomBytes(32).toString("hex")}`;
const token_hash = createHash("sha256").update(token).digest("hex");
let organizationId;
if (values.worker) {
  const { error } = await client.from("tracking_worker_keys").insert({ token_hash, name: values.name });
  if (error) throw new Error(`Worker provisioning failed: ${error.code}`);
} else {
  const { data, error } = await client.from("tracking_organizations").insert({ name: values.name }).select("id").single();
  if (error) throw new Error(`Organization provisioning failed: ${error.code}`);
  organizationId = data.id;
  const key = await client.from("tracking_api_keys").insert({ organization_id: organizationId, name: "Initial administrator", token_hash, prefix: token.slice(0,17), scopes: ["tracking:read","tracking:write","keys:manage"] });
  if (key.error) throw new Error(`Key provisioning failed: ${key.error.code}; organization ${organizationId} exists.`);
}
writeFileSync(values.output, JSON.stringify({ organization_id: organizationId, token }, null, 2)+"\n", { flag: "wx", mode: 0o600 });
console.log(JSON.stringify({ organization_id: organizationId, credential_file: values.output }));
