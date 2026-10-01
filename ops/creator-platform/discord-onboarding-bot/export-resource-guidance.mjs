import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';

// Read-only source export. Keep historical instructions separate from policy.
const guild = '1400610531189985310';
const token = readFileSync(`${process.env.CREDENTIALS_DIRECTORY}/discord-bot-token`, 'utf8').trim();
const output = process.argv[2];
if (!output?.startsWith('/')) throw Error('Provide an absolute protected output directory');
async function get(path) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await fetch(`https://discord.com/api/v10${path}`, { headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(30000) });
    const data = await r.json();
    if (r.status === 429) { await new Promise(resolve => setTimeout(resolve, Math.ceil(data.retry_after * 1000) + 100)); continue; }
    if (!r.ok) throw Error(`Discord read failed: ${r.status} ${path}`);
    return data;
  }
  throw Error('Rate limit retry exhausted');
}
const channels = await get(`/guilds/${guild}/channels`);
const parents = ['1450438764412272742', '1450439001080201226'];
const result = { guild, exportedAt: new Date().toISOString(), channels: [] };
for (const channel of channels.filter(c => c.type === 0 && parents.includes(c.parent_id))) {
  const messages = [];
  let before;
  while (true) {
    const page = await get(`/channels/${channel.id}/messages?limit=100${before ? `&before=${before}` : ''}`);
    messages.push(...page);
    if (page.length < 100) break;
    before = page.at(-1).id;
  }
  result.channels.push({ ...channel, messages: messages.reverse() });
  console.log(JSON.stringify({ channel: channel.name, messages: messages.length }));
}
mkdirSync(output, { recursive: true, mode: 0o700 });
writeFileSync(`${output}/source.json`, JSON.stringify(result, null, 2), { mode: 0o600 });
console.log(`Saved ${result.channels.length} channel histories. Attachments are references, not downloaded backups; threads are not included.`);
