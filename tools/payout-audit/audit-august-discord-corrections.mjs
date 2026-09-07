import { readFile, writeFile } from "node:fs/promises";

const receiptPath = new URL(
  "../../payouts/2026-08/final-settlement/discord-delivery-receipt.md",
  import.meta.url,
);
const outputPath = new URL(
  "../../payouts/2026-08/final-settlement/discord-corrections-2026-09-03.json",
  import.meta.url,
);
const hermesEnvPath = "/home/ark296/.hermes/.env";
const apiBase = "https://discord.com/api/v10";
const cutoff = Date.parse("2026-09-02T08:29:33Z");
const creatorCategoryIds = new Set([
  "1524754775735009331", // Creators - TALKING
  "1492407167423352863", // Creators - NON TALKING
  "1492407020106678303", // Inactive / At Risk
  "1496975271486689280", // Not Active Creators
]);

function parseEnv(text, key) {
  const match = text.match(new RegExp(`^${key}=(.*)$`, "m"));
  if (!match || !match[1].trim()) throw new Error(`${key} is unavailable`);
  return match[1].trim();
}

function parseDeliveredChannels(receipt) {
  const delivered = receipt.split("## Delivered")[1]?.split("## Not delivered")[0] ?? "";
  return [...delivered.matchAll(/^- (.+?): https:\/\/discord\.com\/channels\/(\d+)\/(\d+)\/(\d+)$/gmu)].map(
    ([, recipient, guildId, channelId, deliveryMessageId]) => ({
      recipient,
      guildId,
      channelId,
      deliveryMessageId,
    }),
  );
}

async function discordGet(token, pathname) {
  const response = await fetch(`${apiBase}${pathname}`, {
    headers: { Authorization: `Bot ${token}` },
  });
  if (!response.ok) throw new Error(`Discord API ${response.status}: ${await response.text()}`);
  return response.json();
}

function normalizeMessage(message) {
  return {
    id: message.id,
    timestamp: message.timestamp,
    author: {
      id: message.author?.id ?? null,
      username: message.author?.username ?? null,
      globalName: message.author?.global_name ?? null,
      bot: Boolean(message.author?.bot),
    },
    content: message.content ?? "",
    attachmentNames: (message.attachments ?? []).map((attachment) => attachment.filename),
    referencedMessageId: message.message_reference?.message_id ?? null,
  };
}

const [receipt, envText] = await Promise.all([
  readFile(receiptPath, "utf8"),
  readFile(hermesEnvPath, "utf8"),
]);
const token = parseEnv(envText, "DISCORD_BOT_TOKEN");
const channels = parseDeliveredChannels(receipt);
const guildChannels = await discordGet(token, `/guilds/${channels[0].guildId}/channels`);
const creatorChannels = guildChannels
  .filter((channel) => channel.type === 0 && creatorCategoryIds.has(channel.parent_id))
  .map((channel) => ({
    channelId: channel.id,
    channelName: channel.name,
    parentId: channel.parent_id,
  }));

const results = [];
for (const channel of channels) {
  const messages = await discordGet(token, `/channels/${channel.channelId}/messages?limit=100`);
  const afterDelivery = messages
    .filter((message) => Date.parse(message.timestamp) >= cutoff)
    .map(normalizeMessage)
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
  results.push({ ...channel, messages: afterDelivery });
}

const audit = {
  auditedAt: new Date().toISOString(),
  cutoff: new Date(cutoff).toISOString(),
  guildId: channels[0]?.guildId ?? null,
  channelCount: channels.length,
  channels: results,
  allCreatorChannels: [],
};

for (const channel of creatorChannels) {
  const messages = await discordGet(token, `/channels/${channel.channelId}/messages?limit=100`);
  audit.allCreatorChannels.push({
    ...channel,
    messages: messages
      .filter((message) => Date.parse(message.timestamp) >= cutoff)
      .map(normalizeMessage)
      .sort((left, right) => left.timestamp.localeCompare(right.timestamp)),
  });
}

await writeFile(outputPath, `${JSON.stringify(audit, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      output: outputPath.pathname,
      channelCount: results.length,
      messageCount: results.reduce((sum, item) => sum + item.messages.length, 0),
      channelsWithCreatorReplies: results
        .filter((item) => item.messages.some((message) => !message.author.bot))
        .map((item) => item.recipient),
      allCreatorChannelCount: audit.allCreatorChannels.length,
    },
    null,
    2,
  ),
);
