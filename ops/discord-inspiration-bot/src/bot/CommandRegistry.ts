import { ChatInputCommandInteraction, SlashCommandBuilder } from 'discord.js';
import { ServiceContainer } from '../core/ServiceContainer';

export interface Command {
  data: any; // Accept any command builder type (SlashCommandBuilder, SlashCommandOptionsOnlyBuilder, etc.)
  execute(interaction: ChatInputCommandInteraction, services: ServiceContainer): Promise<void>;
}

/**
 * Command Registry
 * Manages command registration and execution
 */
export class CommandRegistry {
  private commands: Map<string, Command> = new Map();

  /**
   * Register a command
   */
  public register(command: Command): void {
    const commandName = command.data.name;
    
    if (this.commands.has(commandName)) {
      console.warn(`⚠️ Command '${commandName}' is already registered. Overwriting...`);
    }
    
    this.commands.set(commandName, command);
    console.log(`✓ Registered command: ${commandName}`);
  }

  /**
   * Register multiple commands
   */
  public registerMany(commands: Command[]): void {
    commands.forEach(command => this.register(command));
  }

  /**
   * Get a command by name
   */
  public get(commandName: string): Command | undefined {
    return this.commands.get(commandName);
  }

  /**
   * Get all command data for Discord API registration
   */
  public getCommandData(): any[] {
    return Array.from(this.commands.values()).map(cmd => cmd.data.toJSON());
  }

  /**
   * Execute a command
   */
  public async execute(
    commandName: string,
    interaction: ChatInputCommandInteraction,
    services: ServiceContainer
  ): Promise<void> {
    const command = this.commands.get(commandName);
    
    if (!command) {
      console.error(`❌ Unknown command: ${commandName}`);
      await interaction.reply({
        content: '❌ Unknown command.',
        ephemeral: true
      });
      return;
    }

    try {
      await command.execute(interaction, services);
    } catch (error: any) {
      console.error(`❌ Error executing command '${commandName}':`, error);
      throw error; // Re-throw for middleware to handle
    }
  }

  /**
   * Get all registered command names
   */
  public getCommandNames(): string[] {
    return Array.from(this.commands.keys());
  }

  /**
   * Get total number of registered commands
   */
  public size(): number {
    return this.commands.size;
  }
}

