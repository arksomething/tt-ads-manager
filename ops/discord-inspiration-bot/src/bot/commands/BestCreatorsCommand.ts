import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { Command } from '../CommandRegistry';
import { ServiceContainer } from '../../core/ServiceContainer';
import { ErrorHandler } from '../middleware/ErrorHandler';

const formatViews = (views: number): string => {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K`;
  return `${views}`;
};

const formatPulledAt = (date: Date): string => {
  const unixSeconds = Math.floor(date.getTime() / 1000);
  return `<t:${unixSeconds}:F>\n<t:${unixSeconds}:R>`;
};

const ANALYTICS_CAVEAT = 'Views come from third-party snapshots, may lag behind live platform counts, and can be inflated by paid ads or boosted distribution.';

const isValidationError = (message?: string): boolean => {
  if (!message) return false;
  return message.includes('start_date') || message.includes('end_date') || message.includes('YYYY-MM-DD');
};

export const BestCreatorsCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('bestcreators')
    .setDescription('Get the top creators by views within a date range (defaults to last 7 days)')
    .addStringOption(option =>
      option
        .setName('start_date')
        .setDescription('Inclusive start date in YYYY-MM-DD')
        .setRequired(false)
    )
    .addStringOption(option =>
      option
        .setName('end_date')
        .setDescription('Inclusive end date in YYYY-MM-DD')
        .setRequired(false)
    )
    .addIntegerOption(option =>
      option
        .setName('limit')
        .setDescription('Number of creators to show (default: 10)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(25)
    ),

  async execute(interaction: ChatInputCommandInteraction, services: ServiceContainer): Promise<void> {
    try {
      await interaction.deferReply();
    } catch (error: any) {
      if (!await ErrorHandler.handleDeferError(error)) return;
    }

    const rankingService = services.getRankingService();
    const startDate = interaction.options.getString('start_date') || undefined;
    const endDate = interaction.options.getString('end_date') || undefined;
    const limit = interaction.options.getInteger('limit') || 10;

    try {
      const result = await rankingService.getBestCreators({ limit, startDate, endDate });

      if (result.entries.length === 0) {
        await interaction.editReply(`❌ No creator data found from ${result.startDate} to ${result.endDate}.`);
        return;
      }

      const lines = result.entries.map((entry, index) => {
        const marker = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${entry.rank}`;
        return `${marker} @${entry.creator.username} • ${formatViews(entry.creator.views)} views`;
      });

      const embed = new EmbedBuilder()
        .setTitle('Verification Not Required — Best Creators')
        .setDescription(`📈 Top ${result.entries.length} creators by views from ${result.startDate} to ${result.endDate}\n\n${lines.join('\n')}`)
        .setColor(0x57F287)
        .addFields(
          { name: 'Data Pulled', value: formatPulledAt(result.generatedAt), inline: true },
          { name: 'Analytics Caveat', value: ANALYTICS_CAVEAT, inline: false }
        )
        .setTimestamp(result.generatedAt);

      await interaction.editReply({ embeds: [embed] });
      console.log(`✅ Successfully displayed best creators for ${interaction.user.tag}`);
    } catch (error: any) {
      const message = isValidationError(error?.message)
        ? `❌ ${error.message}`
        : '❌ Failed to fetch top creators. Please try again later.';
      await interaction.editReply(message);
      console.error('❌ Error fetching best creators:', error);
    }
  }
};
