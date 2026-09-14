import { ChatInputCommandInteraction } from 'discord.js';

/**
 * Centralized error handling for command execution
 */
export class ErrorHandler {
  /**
   * Handle command execution errors
   */
  public static async handleCommandError(
    interaction: ChatInputCommandInteraction,
    error: any,
    commandName: string
  ): Promise<void> {
    // Don't log "Unknown interaction" errors (code 10062) - they're expected when interactions expire
    if (error.code !== 10062) {
      console.error(`❌ Error in ${commandName} command:`, error);
    }
    
    // If interaction expired, we can't respond
    if (error.code === 10062) {
      return;
    }

    // Build user-friendly error message
    let errorMessage = '❌ An unexpected error occurred. Please try again.';
    
    if (error.message?.includes('billing')) {
      errorMessage = '❌ OpenAI API error: Please check your billing and usage limits.';
    } else if (error.message?.includes('rate limit')) {
      errorMessage = '❌ Rate limit reached. Please try again later.';
    } else if (error.message?.includes('timeout')) {
      errorMessage = '❌ Request timed out. Please try again.';
    } else if (error.message && !error.message.includes('Unknown')) {
      errorMessage = `❌ Error: ${error.message}`;
    }

    // Try to respond to user
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errorMessage);
      } else {
        await interaction.reply({ content: errorMessage, ephemeral: true });
      }
    } catch (replyError: any) {
      // Ignore "Unknown interaction" errors when trying to reply
      if (replyError.code !== 10062) {
        console.error('❌ Failed to send error message:', replyError);
      }
    }
  }

  /**
   * Handle defer errors
   */
  public static async handleDeferError(error: any): Promise<boolean> {
    // Error code 10062 = Unknown interaction (token expired after 3 seconds)
    if (error.code === 10062) {
      return false; // Silently ignore expired interactions
    }
    
    console.warn('⚠️ Cannot defer reply:', error.code === 429 ? 'Rate limited' : error.message || 'Unknown error');
    return false;
  }
}



