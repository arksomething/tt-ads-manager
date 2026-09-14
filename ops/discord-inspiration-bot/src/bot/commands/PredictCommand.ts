import { ChatInputCommandInteraction, SlashCommandBuilder, AttachmentBuilder } from 'discord.js';
import { Command } from '../CommandRegistry';
import { ServiceContainer } from '../../core/ServiceContainer';
import { OptionBuilders } from '../builders/OptionBuilders';
import { buildHeightInputFromInteraction } from '../helpers/HeightCommandInputs';
import { ErrorHandler } from '../middleware/ErrorHandler';

export const PredictCommand: Command = {
  data: OptionBuilders.addAllHeightOptions(
    new SlashCommandBuilder()
      .setName('predict')
      .setDescription('Generate the GoTall height prediction screen')
  ),

  async execute(interaction: ChatInputCommandInteraction, services: ServiceContainer): Promise<void> {
    try {
      await interaction.deferReply();
    } catch (error: any) {
      if (!await ErrorHandler.handleDeferError(error)) return;
    }

    const heightService = services.getHeightService();
    const imageService = services.getImageService();

    const result = heightService.calculateHeight(
      buildHeightInputFromInteraction(interaction)
    );

    if (typeof result === 'string') {
      await interaction.editReply(`❌ ${result}`);
      return;
    }

    const imageBuffer = await imageService.renderProjectionImage(
      heightService.buildProjectionImageData(result)
    );

    const attachment = new AttachmentBuilder(imageBuffer, { name: 'predict.png' });
    await interaction.editReply({
      content: '✨ Prediction image generated!',
      files: [attachment]
    });

    console.log(`✅ Successfully generated predict image for ${interaction.user.tag}`);
  }
};
