import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { Config } from './config/Config';
import { ServiceContainer } from './core/ServiceContainer';
import { CommandRegistry } from './bot/CommandRegistry';
import { ErrorHandler } from './bot/middleware/ErrorHandler';
import { VideoMilestoneMonitor } from './bot/VideoMilestoneMonitor';
import { InspirationSubscriptions } from './bot/InspirationSubscriptions';

// Import commands
import { PredictCommand } from './bot/commands/PredictCommand';
import { BestCreatorsCommand } from './bot/commands/BestCreatorsCommand';
import { BestVideosCommand } from './bot/commands/BestVideosCommand';

/**
 * Main bot application
 * Handles initialization, command registration, and event handling
 */
class BotApplication {
  private config: Config;
  private services: ServiceContainer;
  private commandRegistry: CommandRegistry;
  private client: Client;
  private rest: REST;
  private videoMilestoneMonitor: VideoMilestoneMonitor;
  private subscriptions: InspirationSubscriptions;

  constructor() {
    // Initialize configuration
    this.config = Config.getInstance();
    const appConfig = this.config.get();

    // Initialize service container
    this.services = new ServiceContainer(appConfig);

    // Initialize command registry
    this.commandRegistry = new CommandRegistry();
    this.registerCommands();

    // Initialize Discord client
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds],
    });

    this.videoMilestoneMonitor = new VideoMilestoneMonitor(
      this.client,
      this.services.getViralClient(),
      appConfig.milestones
    );
    this.subscriptions = new InspirationSubscriptions(this.client, appConfig.milestones.guildId, appConfig.milestones.channelId, appConfig.milestones.notificationRoleId);

    this.rest = new REST({ version: '10' }).setToken(appConfig.discord.token);

    // Setup event handlers
    this.setupEventHandlers();
  }

  /**
   * Register all bot commands
   */
  private registerCommands(): void {
    this.commandRegistry.registerMany([
      PredictCommand,
      BestCreatorsCommand,
      BestVideosCommand,
    ]);

    console.log(`✓ Registered ${this.commandRegistry.size()} commands`);
  }

  /**
   * Setup Discord event handlers
   */
  private setupEventHandlers(): void {
    this.client.once('ready', () => {
      console.log(`✅ Bot logged in as ${this.client.user?.tag}`);
      console.log(`📊 Ready in ${this.client.guilds.cache.size} server(s)`);
      console.log(`🤖 Commands available: ${this.commandRegistry.getCommandNames().join(', ')}`);
      void this.subscriptions.preflight().then(() => this.subscriptions.publishControls()).then(() => this.videoMilestoneMonitor.start()).catch((error) => {
        console.error('❌ Failed to start video milestone monitor:', error);
        process.exitCode = 1;
        this.client.destroy();
      });
    });

    this.client.on('interactionCreate', async (interaction) => {
      if (interaction.isButton()) {
        try { await this.subscriptions.handle(interaction); }
        catch { if(interaction.deferred) await interaction.editReply('Could not update alerts. Please try again or contact the team.'); }
        return;
      }
      if (!interaction.isChatInputCommand()) return;

      console.log(`📥 Received command: ${interaction.commandName} from ${interaction.user.tag}`);

      try {
        await this.commandRegistry.execute(
          interaction.commandName,
          interaction,
          this.services
        );
      } catch (error: any) {
        console.error(`❌ Error executing command ${interaction.commandName}:`, error);
        await ErrorHandler.handleCommandError(
          interaction,
          error,
          interaction.commandName
        );
      }
    });

    // Add error handlers for uncaught errors
    this.client.on('error', (error) => {
      console.error('❌ Discord client error:', error);
    });

    process.on('unhandledRejection', (error) => {
      console.error('❌ Unhandled promise rejection:', error);
    });
  }

  /**
   * Register slash commands with Discord API
   */
  private async registerSlashCommands(): Promise<void> {
    const appConfig = this.config.get();
    const commands = this.commandRegistry.getCommandData();

    try {
      console.log('🔄 Registering slash commands globally...');
      console.log('  → Commands may take up to 1 hour to appear across all servers');
      
      await this.rest.put(
        Routes.applicationCommands(appConfig.discord.clientId),
        { body: commands }
      );
      
      console.log('✅ Slash commands registered globally!');
    } catch (error) {
      console.error('❌ Error registering commands:', error);
      throw error;
    }
  }

  /**
   * Start the bot
   */
  public async start(): Promise<void> {
    try {
      const appConfig = this.config.get();
      
      console.log('🚀 Starting bot...');
      console.log(`📝 Environment: ${appConfig.environment}`);
      
      await this.registerSlashCommands();
      await this.client.login(appConfig.discord.token);
    } catch (error) {
      console.error('❌ Failed to start bot:', error);
      process.exit(1);
    }
  }

  /**
   * Gracefully shutdown the bot
   */
  public async shutdown(): Promise<void> {
    console.log('🛑 Shutting down bot...');
    this.videoMilestoneMonitor.stop();
    this.client.destroy();
    console.log('✅ Bot shut down successfully');
  }
}

// Start the application
const bot = new BotApplication();

// Handle process termination
process.on('SIGINT', async () => {
  await bot.shutdown();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await bot.shutdown();
  process.exit(0);
});

// Start the bot
bot.start().catch(console.error);
