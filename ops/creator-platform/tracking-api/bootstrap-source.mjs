import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(new URL("../../../creator-platform/package.json",import.meta.url));
const { createClient } = require("@supabase/supabase-js");
const [organizationFile, workerFile] = process.argv.slice(2);
const organization = JSON.parse(readFileSync(organizationFile,"utf8"));
const worker = JSON.parse(readFileSync(workerFile,"utf8"));
const client = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false}});
const {data:batches,error} = await client.from("creator_tracker_ingest_batches").select("organization_id").eq("status","committed").limit(1000);
if(error) throw new Error(`Source discovery failed: ${error.code}`);
const sourceIds=[...new Set(batches.map(row=>row.organization_id))];
if(sourceIds.length!==1) throw new Error("Expected exactly one source organization; explicit source selection is required.");
const binding=await client.from("tracking_source_bindings").insert({source_organization_id:sourceIds[0],organization_id:organization.organization_id});
if(binding.error && binding.error.code!=="23505") throw new Error(`Source binding failed: ${binding.error.code}`);
const {data:bound,error:boundError}=await client.from("tracking_source_bindings").select("organization_id").eq("source_organization_id",sourceIds[0]).single();
if(boundError||bound.organization_id!==organization.organization_id) throw new Error("Source is bound to a different organization.");
const tokenHash=createHash("sha256").update(worker.token).digest("hex");
let total=0;
for(let i=0;i<1000;i++) {
  const {data,error}=await client.rpc("tracking_sync_sources",{p_hash:tokenHash});
  if(error||data.error) throw new Error(`Source sync failed: ${error?.code ?? data.error}`);
  total+=data.batches;
  if(!data.batches) break;
}
const counts={};
for(const table of ["tracking_subscriptions","tracking_videos","tracking_observations"]) {
  const {count,error}=await client.from(table).select("id",{count:"exact",head:true});
  if(error) throw new Error(`Readback failed: ${error.code}`);
  counts[table]=count;
}
console.log(JSON.stringify({organization_id:organization.organization_id,imported_batches:total,counts}));
