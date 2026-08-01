// Minimal stdio MCP server exposing read-only Discord access through the
// archived GoTall bot. The bot token is read at runtime from the archived
// bot's .env and is never stored in this repo.
//
// Note: Discord hides message `content` from bots unless the application has
// the privileged "Message Content Intent" enabled (Discord Developer Portal →
// the bot app → Bot → Privileged Gateway Intents). Timestamps, authors,
// embeds, and attachments are returned regardless.

import { readFileSync } from "node:fs";
import { createInterface } from "node:readline";

const BOT_ENV_PATH = "/home/ark296/projects/archive/gotall-discord-bot/.env";
const API_BASE = "https://discord.com/api/v10";

function getBotToken() {
  const envText = readFileSync(BOT_ENV_PATH, "utf8");
  const match = envText.match(/^DISCORD_TOKEN=(.*)$/m);

  if (!match || match[1].trim().length === 0) {
    throw new Error(`DISCORD_TOKEN not found in ${BOT_ENV_PATH}`);
  }

  return match[1].trim();
}

async function discordGet(path) {
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { Authorization: `Bot ${getBotToken()}` },
  });

  if (!response.ok) {
    throw new Error(`Discord API ${response.status}: ${await response.text()}`);
  }

  return response.json();
}

const tools = [
  {
    name: "discord_list_guilds",
    description: "List the Discord servers (guilds) the GoTall bot is in.",
    inputSchema: { type: "object", properties: {} },
    run: async () => {
      const guilds = await discordGet("/users/@me/guilds");
      return guilds.map((guild) => ({ id: guild.id, name: guild.name }));
    },
  },
  {
    name: "discord_list_channels",
    description:
      "List channels in a guild. Defaults to the GoTall Creators guild (1400610531189985310).",
    inputSchema: {
      type: "object",
      properties: {
        guildId: { type: "string", description: "Guild ID (optional)" },
      },
    },
    run: async (args) => {
      const guildId = args.guildId ?? "1400610531189985310";
      const channels = await discordGet(`/guilds/${guildId}/channels`);
      return channels
        .sort((left, right) => (left.position ?? 0) - (right.position ?? 0))
        .map((channel) => ({
          id: channel.id,
          name: channel.name,
          type: channel.type,
          parentId: channel.parent_id,
        }));
    },
  },
  {
    name: "discord_read_messages",
    description:
      "Read recent messages from a channel (newest first). Message text requires the bot app's Message Content Intent to be enabled; timestamps/authors/embeds always work.",
    inputSchema: {
      type: "object",
      properties: {
        channelId: { type: "string", description: "Channel ID" },
        limit: { type: "number", description: "Max messages (1-100, default 50)" },
        before: {
          type: "string",
          description: "Only messages before this message ID (for paging back)",
        },
      },
      required: ["channelId"],
    },
    run: async (args) => {
      const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
      const beforeQuery = args.before ? `&before=${args.before}` : "";
      const messages = await discordGet(
        `/channels/${args.channelId}/messages?limit=${limit}${beforeQuery}`,
      );
      return messages.map((message) => ({
        id: message.id,
        timestamp: message.timestamp,
        author: message.author?.username,
        content: message.content,
        embeds: message.embeds?.length ?? 0,
        attachments: (message.attachments ?? []).map((attachment) => attachment.url),
        referencedMessageId: message.message_reference?.message_id ?? null,
      }));
    },
  },
];

function respond(id, result) {
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
}

function respondError(id, message) {
  process.stdout.write(
    JSON.stringify({ jsonrpc: "2.0", id, error: { code: -32000, message } }) + "\n",
  );
}

const readline = createInterface({ input: process.stdin });

readline.on("line", async (line) => {
  let request;

  try {
    request = JSON.parse(line);
  } catch {
    return;
  }

  const { id, method, params } = request;

  try {
    if (method === "initialize") {
      respond(id, {
        protocolVersion: params?.protocolVersion ?? "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "gotall-discord", version: "1.0.0" },
      });
    } else if (method === "tools/list") {
      respond(id, {
        tools: tools.map(({ name, description, inputSchema }) => ({
          name,
          description,
          inputSchema,
        })),
      });
    } else if (method === "tools/call") {
      const tool = tools.find((candidate) => candidate.name === params.name);

      if (!tool) {
        respondError(id, `Unknown tool: ${params.name}`);
        return;
      }

      const result = await tool.run(params.arguments ?? {});
      respond(id, {
        content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
      });
    } else if (id !== undefined) {
      respondError(id, `Unknown method: ${method}`);
    }
  } catch (error) {
    if (id !== undefined) {
      respondError(id, error instanceof Error ? error.message : String(error));
    }
  }
});
