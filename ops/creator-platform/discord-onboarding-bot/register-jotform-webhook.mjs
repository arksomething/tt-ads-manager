// Run on the bot host as root; credentials stay in the service credential mount.
import {readFileSync} from 'node:fs';
import {JOTFORM_ID} from './jotform.mjs';
const dir=process.env.CREDENTIALS_DIRECTORY||'/run/credentials/gotall-discord-onboarding-test.service';
const key=readFileSync(`${dir}/jotform-api-key`,'utf8').trim();
const secret=readFileSync(`${dir}/jotform-webhook-secret`,'utf8').trim();
const endpoint=`https://gotall-webhooks.billionviews.app/jotform/${secret}`;
async function api(method,body){
 const r=await fetch(`https://api.jotform.com/form/${JOTFORM_ID}/webhooks`,{method,headers:{APIKEY:key},...(body?{body}:{}),signal:AbortSignal.timeout(20000)});
 const data=await r.json();if(!r.ok||data.responseCode!==200)throw Error(`Webhook API failed: HTTP ${r.status}, code ${data.responseCode}`);return data.content;
}
const before=await api('GET');
const probe=await fetch(endpoint,{method:'POST',body:new URLSearchParams({probe:'verification-only'}),signal:AbortSignal.timeout(20000)});
if(probe.status!==202)throw Error(`Public webhook probe failed: HTTP ${probe.status}`);
if(!Object.values(before).includes(endpoint))await api('POST',new URLSearchParams({webhookURL:endpoint}));
const after=await api('GET');
if(!Object.values(after).includes(endpoint))throw Error('Webhook registration readback failed.');
console.log(JSON.stringify({publicEndpointAccepted:true,registered:true,form:JOTFORM_ID,existingWebhooksPreserved:Object.values(before).every(url=>Object.values(after).includes(url))}));
