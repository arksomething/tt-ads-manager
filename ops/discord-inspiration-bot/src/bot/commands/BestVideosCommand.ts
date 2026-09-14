import { ChatInputCommandInteraction, EmbedBuilder, SlashCommandBuilder } from 'discord.js';
import { Command } from '../CommandRegistry';
import { ServiceContainer } from '../../core/ServiceContainer';
import { ErrorHandler } from '../middleware/ErrorHandler';

const formatViews = (views: number): string => {
  if (views >= 1_000_000) return `${(views / 1_000_000).toFixed(1)}M`;
  if (views >= 1_000) return `${(views / 1_000).toFixed(1)}K`;
  return `${views}`;
};

const formatPublishedDate = (publishedAt?: string): string => {
  if (!publishedAt) return 'unknown';
  const timestamp = Date.parse(publishedAt);
  if (!Number.isFinite(timestamp)) return 'unknown';
  return new Date(timestamp).toISOString().slice(0, 10);
};

const formatPulledAt = (date: Date): string => {
  const unixSeconds = Math.floor(date.getTime() / 1000);
  return `<t:${unixSeconds}:F>\n<t:${unixSeconds}:R>`;
};

const ANALYTICS_CAVEAT = 'Views come from third-party snapshots, may lag behind live platform counts, and can be inflated by paid ads or boosted distribution.';

export const BestVideosCommand: Command = {
  data: new SlashCommandBuilder()
    .setName('bestvideos')
    .setDescription('Get the top videos by views in a recent time range (defaults to last 7 days)')
    .addIntegerOption(option =>
      option
        .setName('range')
        .setDescription('Days to look back (default: 7)')
        .setRequired(false)
        .setMinValue(1)
        .setMaxValue(365)
    )
    .addIntegerOption(option =>
      option
        .setName('limit')
        .setDescription('Number of videos to show (default: 10)')
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
    const rangeDays = interaction.options.getInteger('range') || 7;
    const limit = interaction.options.getInteger('limit') || 10;

    try {
      const result = await rankingService.getBestVideos({ sinceDays: rangeDays, limit });

      if (result.entries.length === 0) {
        await interaction.editReply(`❌ No tracked videos found in the last ${rangeDays} days.`);
        return;
      }

      const lines = result.entries.map((entry, index) => {
        const marker = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `#${entry.rank}`;
        const urlText = entry.url ? entry.url : `no direct link (${entry.platform}:${entry.videoId || 'unknown'})`;
        return `${marker} @${entry.username} • ${formatViews(entry.views)} views • ${formatPublishedDate(entry.publishedAt)} • ${urlText}`;
      });

      const embed = new EmbedBuilder()
        .setTitle('Verification Not Required — Best Videos')
        .setDescription(`🎥 Top ${result.entries.length} videos by views in the last ${result.windowDays} days\n\n${lines.join('\n')}`)
        .setColor(0x5865F2)
        .addFields(
          { name: 'Data Pulled', value: formatPulledAt(result.generatedAt), inline: true },
          { name: 'Analytics Caveat', value: ANALYTICS_CAVEAT, inline: false }
        )
        .setTimestamp(result.generatedAt);

      await interaction.editReply({ embeds: [embed] });
      console.log(`✅ Successfully displayed best videos for ${interaction.user.tag}`);
    } catch (error: any) {
      await interaction.editReply('❌ Failed to fetch top videos. Please try again later.');
      console.error('❌ Error fetching best videos:', error);
    }
  }
};
