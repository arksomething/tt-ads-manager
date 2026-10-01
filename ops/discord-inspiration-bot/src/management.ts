import { Client, ClientUser, ChatInputCommandInteraction, ButtonInteraction, Routes } from 'discord.js';
import { AppConfig } from './config/Config';
import { ServiceContainer } from './core/ServiceContainer';
import { CommandRegistry } from './bot/CommandRegistry';
import { PredictCommand } from './bot/commands/PredictCommand';
import { BestCreatorsCommand } from './bot/commands/BestCreatorsCommand';
import { BestVideosCommand } from './bot/commands/BestVideosCommand';
import { InspirationSubscriptions, SUBSCRIBE, UNSUBSCRIBE } from './bot/InspirationSubscriptions';
import { VideoMilestoneMonitor } from './bot/VideoMilestoneMonitor';

const names = ['predict', 'bestcreators', 'bestvideos'];
export function ownsInspirationInteraction(raw: any, guildId: string, applicationId: string): boolean {
  return raw.guild_id === guildId && raw.application_id === applicationId &&
    ((raw.type === 2 && names.includes(raw.data?.name)) ||
     (raw.type === 3 && [SUBSCRIBE, UNSUBSCRIBE].includes(raw.data?.custom_id)));
}

// REST-only client: the management bot supplies interactions from its existing Gateway.
// Never call client.login here or start a second Discord session.
export async function createManagementInspiration(config: AppConfig) {
  const client = new Client({ intents: [] });
  client.rest.setToken(config.discord.token);
  const user: any = await client.rest.get(Routes.user('@me'));
  client.user = new (ClientUser as any)(client, user);
  const guild = await client.guilds.fetch(config.milestones.guildId);
  await guild.members.fetchMe();
  const subscriptions = new InspirationSubscriptions(client, guild.id, config.milestones.channelId, config.milestones.notificationRoleId);
  await subscriptions.preflight();
  const registry = new CommandRegistry();
  registry.registerMany([PredictCommand, BestCreatorsCommand, BestVideosCommand]);
  const services = new ServiceContainer(config);
  const monitor = new VideoMilestoneMonitor(client, services.getViralClient(), config.milestones);
  // Upsert individually: retain every unrelated management command in this guild.
  for (const command of registry.getCommandData()) {
    await client.rest.post(Routes.applicationGuildCommands(user.id, guild.id), { body: command });
  }
  const controlsId = await subscriptions.publishControls();
  console.log('Management inspiration controls:', controlsId);
  await monitor.start();
  return {
    controlsId,
    owns: (raw: any) => ownsInspirationInteraction(raw, guild.id, user.id),
    async handle(raw: any) {
      if (!ownsInspirationInteraction(raw, guild.id, user.id)) return false;
      const interaction: ButtonInteraction | ChatInputCommandInteraction = raw.type === 3 ? new (ButtonInteraction as any)(client, raw) : new (ChatInputCommandInteraction as any)(client, raw);
      try {
        if (interaction instanceof ButtonInteraction) await subscriptions.handle(interaction);
        else await registry.execute(interaction.commandName, interaction, services);
      } catch (error: any) {
        console.error('Management inspiration interaction failed:', error.message);
        const body = { content: 'Could not complete this request. Please try again.', allowedMentions: { parse: [] as [] } };
        if (interaction.deferred || interaction.replied) await interaction.editReply(body).catch(() => {});
        else await interaction.reply({ ...body, ephemeral: true }).catch(() => {});
      }
      return true;
    },
    stop() { monitor.stop(); client.destroy(); },
  };
}
