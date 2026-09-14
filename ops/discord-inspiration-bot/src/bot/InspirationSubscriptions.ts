import { Client, ButtonInteraction, ActionRowBuilder, ButtonBuilder, ButtonStyle, TextChannel } from 'discord.js';

export const SUBSCRIBE = 'inspiration:subscribe';
export const UNSUBSCRIBE = 'inspiration:unsubscribe';
export function notificationPayload(roleId: string, url?: string) {
  if (!/^\d{17,20}$/.test(roleId)) throw new Error('Invalid inspiration role');
  return { content: `<@&${roleId}>${url ? ` ${url}` : ''}`, allowedMentions: { parse: [] as [], roles: [roleId], users: [] as [], repliedUser: false } };
}

export class InspirationSubscriptions {
  constructor(private client: Client, private guildId: string, private channelId: string, private roleId: string) {}

  async preflight() {
    notificationPayload(this.roleId);
    const guild = await this.client.guilds.fetch(this.guildId);
    const role = await guild.roles.fetch(this.roleId);
    const channel = await this.client.channels.fetch(this.channelId);
    if (!role || role.managed || role.id === guild.id || role.permissions.bitfield !== 0n || !role.editable) throw new Error('Inspiration role must be editable and grant no permissions');
    if (!(channel instanceof TextChannel) || channel.guildId !== guild.id) throw new Error('Invalid inspiration channel');
    const me = await guild.members.fetchMe();
    if (!me.permissions.has('ManageRoles') || !channel.permissionsFor(me)?.has(['ViewChannel', 'SendMessages', 'ReadMessageHistory', 'EmbedLinks'])) throw new Error('Inspiration bot permissions are incomplete');
    if (!role.mentionable && !channel.permissionsFor(me)?.has('MentionEveryone')) throw new Error('Inspiration role must be mentionable when mass mentions are disabled');
  }

  async publishControls() {
    const channel = await this.client.channels.fetch(this.channelId) as TextChannel;
    const messages = await channel.messages.fetch({ limit: 100 });
    const prior = messages.find(m => m.author.id === this.client.user?.id && m.components.some(r => 'components' in r && r.components.some(b => 'customId' in b && b.customId === SUBSCRIBE)));
    if (prior) return prior.id;
    const message = await channel.send({
      content: '**Video inspiration alerts**\nGet a notification when a tracked video crosses 100,000 views. Alerts are optional; you can keep reading this channel without subscribing.\n\nChoose below to turn alerts on or off.',
      allowedMentions: { parse: [] },
      components: [new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(SUBSCRIBE).setLabel('Notify me').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId(UNSUBSCRIBE).setLabel('Turn off alerts').setStyle(ButtonStyle.Secondary),
      )],
    });
    return message.id;
  }

  async handle(i: ButtonInteraction) {
    if (![SUBSCRIBE, UNSUBSCRIBE].includes(i.customId)) return false;
    if (i.guildId !== this.guildId || i.channelId !== this.channelId) { await i.reply({ content: 'Use the alert controls in the inspiration channel.', ephemeral: true }); return true; }
    await i.deferReply({ ephemeral: true });
    await this.preflight();
    const guild = await this.client.guilds.fetch(this.guildId);
    const member = await guild.members.fetch(i.user.id);
    if (i.customId === SUBSCRIBE) await member.roles.add(this.roleId, 'Creator opted into inspiration alerts');
    else await member.roles.remove(this.roleId, 'Creator opted out of inspiration alerts');
    await i.editReply(i.customId === SUBSCRIBE ? 'Inspiration alerts are on. You can turn them off here anytime.' : 'Inspiration alerts are off. You can still read this channel.');
    return true;
  }
}
