import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
const [ownerFile,otherFile,stateFile,phase="submit"] = process.argv.slice(2);
const owner=JSON.parse(readFileSync(ownerFile,"utf8"));
const other=JSON.parse(readFileSync(otherFile,"utf8"));
const base="https://gotall-creator-platform.vercel.app/api/tracking/v1";
async function api(path,{token=owner.token,method="GET",body,key}={}) {
  const response=await fetch(`${base}/${path}`,{method,headers:{authorization:`Bearer ${token}`,"content-type":"application/json",...(key?{"idempotency-key":key}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(30000)});
  return {status:response.status,data:await response.json()};
}
if(phase==="submit") {
  const videos=await api("videos?limit=1");assert.equal(videos.status,200);assert.ok(videos.data.data.length);
  const first=videos.data.data[0];
  assert.equal((await api(`videos/${first.id}`,{token:other.token})).status,404);
  assert.equal((await api(`videos/${first.id}/observations`,{token:other.token})).status,404);
  const created=await api("keys",{method:"POST",body:{name:"Temporary verification",scopes:["tracking:read"]}});
  assert.equal(created.status,201);
  const restricted=created.data.data;
  assert.equal((await api("videos",{token:restricted.token})).status,200);
  assert.equal((await api("subscriptions",{method:"POST",token:restricted.token,body:{url:first.url},key:randomUUID()})).status,403);
  assert.equal((await api(`keys/${restricted.id}`,{method:"DELETE"})).status,200);
  assert.equal((await api("videos",{token:restricted.token})).status,401);
  const key=randomUUID();
  const input={url:process.env.TRACKING_SMOKE_URL ?? first.url,metadata:{purpose:"production_api_verification"}};
  const submitted=await api("subscriptions",{method:"POST",body:input,key});assert.equal(submitted.status,202);assert.ok(submitted.data.job_id);
  const replay=await api("subscriptions",{method:"POST",body:input,key});assert.equal(replay.status,202);assert.equal(replay.data.replayed,true);assert.equal(replay.data.job_id,submitted.data.job_id);
  assert.equal((await api("subscriptions",{method:"POST",body:{...input,metadata:{purpose:"different"}},key})).status,409);
  assert.equal((await api(`jobs/${submitted.data.job_id}`,{token:other.token})).status,404);
  writeFileSync(stateFile,JSON.stringify({subscription_id:submitted.data.data.id,job_id:submitted.data.job_id,key}),{flag:"wx",mode:0o600});
  console.log(JSON.stringify({phase,tenant_isolation:true,key_scopes:true,key_revocation:true,idempotency:true,job_id:submitted.data.job_id}));
} else {
  const state=JSON.parse(readFileSync(stateFile,"utf8"));
  const job=await api(`jobs/${state.job_id}`);assert.equal(job.status,200);
  console.log(JSON.stringify({phase,job:job.data.data}));
  if(phase==="verify") {
    assert.equal(job.data.data.state,"succeeded");
    const videos=await api(`videos?subscription_id=${state.subscription_id}`);assert.equal(videos.status,200);assert.ok(videos.data.data.length);
    const video=videos.data.data[0];assert.ok(video.latest_observation);assert.ok(video.latest_observation.observed_at);
    const history=await api(`videos/${video.id}/observations?limit=100`);assert.equal(history.status,200);assert.ok(history.data.data.length);
    assert.equal((await api(`subscriptions/${state.subscription_id}`,{method:"PATCH",body:{state:"paused"}})).status,200);
    assert.equal((await api(`subscriptions/${state.subscription_id}/refreshes`,{method:"POST",key:randomUUID()})).status,409);
    assert.equal((await api(`subscriptions/${state.subscription_id}`,{method:"DELETE"})).status,200);
    assert.equal((await api(`subscriptions/${state.subscription_id}`)).status,404);
    console.log(JSON.stringify({collection_verified:true,video_id:video.id,latest_observed_at:video.latest_observation.observed_at,latest_views:video.latest_observation.views,history_rows:history.data.data.length,pause_delete_verified:true}));
  }
}
