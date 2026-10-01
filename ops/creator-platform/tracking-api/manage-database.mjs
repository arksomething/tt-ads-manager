import { readFileSync, writeFileSync } from "node:fs";
import { parseArgs, parseEnv } from "node:util";
const project = "qubkgekdpyntuanzqqeu";
const { values } = parseArgs({ options: { "management-env": { type: "string" }, migrate: { type: "boolean" }, "export-env": { type: "string" } } });
// Only the provider-level management token is read from the supplied authority.
const token = process.env.SUPABASE_ACCESS_TOKEN ?? (values["management-env"] ? parseEnv(readFileSync(values["management-env"], "utf8")).SUPABASE_ACCESS_TOKEN : undefined);
if (!token) throw new Error("Supabase management access is required.");
async function management(path, body) {
  const response = await fetch(`https://api.supabase.com/v1/projects/${project}${path}`, {
    method: body ? "POST" : "GET", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(120000),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(`Management request failed (${response.status}): ${typeof data.message === "string" ? data.message.slice(0,500) : "unknown error"}`);
  return data;
}
const info = await management("");
if (info.id !== project || info.name !== "gotall-creator-platform") throw new Error("Unexpected Supabase project.");
console.log(JSON.stringify({ project: info.id, name: info.name }));
if (values.migrate) {
  for (const name of ["20260912090000_tracking_api", "20260912091000_tracking_api_source_bridge"]) {
    const version = name.split("_")[0];
    const present = await management("/database/migrations");
    if (present.some((migration) => migration.name === name)) { console.log(`${version}: already applied`); continue; }
    const sql = readFileSync(new URL(`../../../creator-platform/supabase/migrations/${name}.sql`, import.meta.url), "utf8");
    await management("/database/migrations", { name, query: `${sql}\nnotify pgrst, 'reload schema';` });
    console.log(`${version}: applied`);
  }
}
if (values["export-env"]) {
  const keys = await management("/api-keys");
  const admin = keys.find((key) => key.name === "service_role")?.api_key;
  const publicKey = keys.find((key) => key.type === "publishable")?.api_key;
  if (!admin || !publicKey) throw new Error("Required project keys unavailable.");
  writeFileSync(values["export-env"], `NEXT_PUBLIC_SUPABASE_URL=https://${project}.supabase.co\nNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=${publicKey}\nSUPABASE_SERVICE_ROLE_KEY=${admin}\n`, { flag: "wx", mode: 0o600 });
  console.log(JSON.stringify({ environment_file: values["export-env"] }));
}
