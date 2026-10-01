// Read-only deployment check. Execute with the systemd Jotform credential.
import {readFileSync} from 'node:fs';
import {jotformClient,JOTFORM_ID,TOKEN_FIELD} from './jotform.mjs';
const key=readFileSync(`${process.env.CREDENTIALS_DIRECTORY}/jotform-api-key`,'utf8').trim();
const api=jotformClient(key),q=await api(`/form/${JOTFORM_ID}/questions`);
if(q['66']?.name!==TOKEN_FIELD||q['66']?.hidden!=='Yes')throw Error('Correlation field is not configured');
const rows=await api(`/form/${JOTFORM_ID}/submissions?limit=1`);
if(!Array.isArray(rows))throw Error('Submission reads failed');
console.log(JSON.stringify({form:JOTFORM_ID,hiddenCorrelationField:true,authenticatedSubmissionRead:true}));
