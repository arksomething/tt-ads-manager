import { SlashCommandBuilder, SlashCommandStringOption, SlashCommandIntegerOption } from 'discord.js';

/**
 * Reusable command option builders to eliminate duplication
 * These builders define common options used across multiple commands
 */
export class OptionBuilders {
  /**
   * Add height option (required)
   */
  static addHeightOption(builder: SlashCommandBuilder | any, required: boolean = true): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('height')
        .setDescription('Current height (e.g., "5\'8" or "173cm")')
        .setRequired(required)
    );
  }

  /**
   * Add age option (required)
   */
  static addAgeOption(builder: SlashCommandBuilder | any, required: boolean = true): typeof builder {
    return builder.addIntegerOption((option: SlashCommandIntegerOption) =>
      option
        .setName('age')
        .setDescription('Age in years')
        .setRequired(required)
        .setMinValue(1)
        .setMaxValue(100)
    );
  }

  /**
   * Add sex option (optional, defaults to Male)
   */
  static addSexOption(builder: SlashCommandBuilder | any): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('sex')
        .setDescription('Biological sex (default: Male)')
        .setRequired(false)
        .addChoices(
          { name: 'Male', value: '1' },
          { name: 'Female', value: '2' }
        )
    );
  }

  /**
   * Add mother's height option
   */
  static addMotherHeightOption(builder: SlashCommandBuilder | any, required: boolean = false): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('mother_height')
        .setDescription(required ? 'Mother\'s height (required, e.g., "5\'4" or "163cm")' : 'Mother\'s height (optional, e.g., "5\'4" or "163cm")')
        .setRequired(required)
    );
  }

  /**
   * Add father's height option
   */
  static addFatherHeightOption(builder: SlashCommandBuilder | any, required: boolean = false): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('father_height')
        .setDescription(required ? 'Father\'s height (required, e.g., "6\'0" or "183cm")' : 'Father\'s height (optional, e.g., "6\'0" or "183cm")')
        .setRequired(required)
    );
  }

  /**
   * Add dream height option
   */
  static addDreamHeightOption(builder: SlashCommandBuilder | any): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('dream_height')
        .setDescription('Dream height for probability calculation (optional, e.g., "6\'0" or "183cm")')
        .setRequired(false)
    );
  }

  /**
   * Add sleep hours option
   */
  static addSleepHoursOption(builder: SlashCommandBuilder | any): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('sleep_hours')
        .setDescription('Sleep hours per night (optional, default: none)')
        .setRequired(false)
    );
  }

  /**
   * Add exercise hours option
   */
  static addExerciseHoursOption(builder: SlashCommandBuilder | any): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('exercise_hours')
        .setDescription('Exercise hours per week (optional, default: none)')
        .setRequired(false)
    );
  }

  /**
   * Add weight option
   */
  static addWeightOption(builder: SlashCommandBuilder | any): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('weight')
        .setDescription('Weight (optional, e.g., "150lbs" or "70kg", default: none)')
        .setRequired(false)
    );
  }

  /**
   * Add growth last year option
   */
  static addGrowthLastYearOption(builder: SlashCommandBuilder | any): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('growth_last_year')
        .setDescription('Growth in the last year')
        .setRequired(false)
        .addChoices(
          { name: '<2 cm', value: 'lt2' },
          { name: '2-5 cm', value: '2to5' },
          { name: '6-9 cm', value: '6to9' },
          { name: '10+ cm', value: '10plus' }
        )
    );
  }

  /**
   * Add still growing option
   */
  static addStillGrowingOption(builder: SlashCommandBuilder | any): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('still_growing')
        .setDescription('How your growth feels right now')
        .setRequired(false)
        .addChoices(
          { name: 'Yes', value: 'yes' },
          { name: 'About the same', value: 'same' },
          { name: 'Yes, but slower', value: 'slower' },
          { name: 'Yes, faster', value: 'faster' },
          { name: 'No', value: 'no' }
        )
    );
  }

  /**
   * Add tall relatives option
   */
  static addTallRelativesOption(builder: SlashCommandBuilder | any): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('tall_relatives')
        .setDescription('Have tall relatives beyond parents? (default: false)')
        .setRequired(false)
        .addChoices(
          { name: 'Yes', value: 'true' },
          { name: 'No', value: 'false' }
        )
    );
  }

  static addUnderarmHairOption(builder: SlashCommandBuilder | any): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('underarm_hair')
        .setDescription('Underarm hair stage')
        .setRequired(false)
        .addChoices(
          { name: 'No', value: 'no' },
          { name: 'A little', value: 'little' },
          { name: 'Yes', value: 'yes' }
        )
    );
  }

  static addBodyOdorOption(builder: SlashCommandBuilder | any): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('body_odor')
        .setDescription('Body odor changes')
        .setRequired(false)
        .addChoices(
          { name: 'No', value: 'no' },
          { name: 'A little', value: 'little' },
          { name: 'Definitely', value: 'definitely' }
        )
    );
  }

  static addAcneOption(builder: SlashCommandBuilder | any): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('acne')
        .setDescription('Acne severity')
        .setRequired(false)
        .addChoices(
          { name: 'None', value: 'none' },
          { name: 'A few', value: 'few' },
          { name: 'Regular', value: 'regular' },
          { name: 'Frequent', value: 'severe' },
          { name: 'Went away', value: 'cleared' }
        )
    );
  }

  static addFacialHairOption(builder: SlashCommandBuilder | any): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('facial_hair')
        .setDescription('Facial hair stage')
        .setRequired(false)
        .addChoices(
          { name: 'None', value: 'none' },
          { name: 'Faint', value: 'faint' },
          { name: 'Sometimes shave', value: 'sometimes' },
          { name: 'Regular shave', value: 'regular' }
        )
    );
  }

  static addShouldersOption(builder: SlashCommandBuilder | any): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('shoulders')
        .setDescription('Shoulder broadening')
        .setRequired(false)
        .addChoices(
          { name: 'No', value: 'no' },
          { name: 'Starting', value: 'starting' },
          { name: 'Broader', value: 'broader' }
        )
    );
  }

  static addMusclesOption(builder: SlashCommandBuilder | any): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('muscles')
        .setDescription('Muscle definition')
        .setRequired(false)
        .addChoices(
          { name: 'No', value: 'no' },
          { name: 'A little', value: 'little' },
          { name: 'Clear', value: 'clear' }
        )
    );
  }

  static addVoiceDepthOption(builder: SlashCommandBuilder | any): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('voice_depth')
        .setDescription('Voice deepening')
        .setRequired(false)
        .addChoices(
          { name: 'No change', value: 'nochange' },
          { name: 'Somewhat', value: 'somewhat' },
          { name: 'Fully', value: 'full' }
        )
    );
  }

  static addShaveFrequencyOption(builder: SlashCommandBuilder | any): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('shave_frequency')
        .setDescription('Shaving frequency')
        .setRequired(false)
        .addChoices(
          { name: 'Do not shave', value: 'no' },
          { name: 'Sometimes', value: 'sometimes' },
          { name: 'Regularly', value: 'regularly' }
        )
    );
  }

  static addPeriodStartedOption(builder: SlashCommandBuilder | any): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('period_started')
        .setDescription('If applicable, when periods started')
        .setRequired(false)
        .addChoices(
          { name: 'Not started', value: 'not_started' },
          { name: '<6 months ago', value: 'lt6mo' },
          { name: 'About 1 year ago', value: '1y' },
          { name: 'About 2 years ago', value: '2y' }
        )
    );
  }

  static addPeriodRegularOption(builder: SlashCommandBuilder | any): typeof builder {
    return builder.addStringOption((option: SlashCommandStringOption) =>
      option
        .setName('period_regular')
        .setDescription('If applicable, whether periods are regular')
        .setRequired(false)
        .addChoices(
          { name: 'Yes', value: 'yes' },
          { name: 'No', value: 'no' },
          { name: 'Not sure', value: 'idk' }
        )
    );
  }

  /**
   * Add all basic height prediction options
   */
  static addBasicHeightOptions(builder: SlashCommandBuilder): SlashCommandBuilder {
    this.addHeightOption(builder, true);
    this.addAgeOption(builder, true);
    this.addSexOption(builder);
    this.addMotherHeightOption(builder, false);
    this.addFatherHeightOption(builder, false);
    this.addDreamHeightOption(builder);
    return builder;
  }

  /**
   * Add all extended options (for projection/framed images)
   */
  static addExtendedOptions(builder: SlashCommandBuilder): SlashCommandBuilder {
    this.addSleepHoursOption(builder);
    this.addExerciseHoursOption(builder);
    this.addWeightOption(builder);
    this.addGrowthLastYearOption(builder);
    this.addStillGrowingOption(builder);
    this.addTallRelativesOption(builder);
    this.addUnderarmHairOption(builder);
    this.addBodyOdorOption(builder);
    this.addAcneOption(builder);
    this.addFacialHairOption(builder);
    this.addShouldersOption(builder);
    this.addMusclesOption(builder);
    this.addVoiceDepthOption(builder);
    this.addShaveFrequencyOption(builder);
    this.addPeriodStartedOption(builder);
    this.addPeriodRegularOption(builder);
    return builder;
  }

  /**
   * Add all height prediction options (basic + extended)
   */
  static addAllHeightOptions(builder: SlashCommandBuilder): SlashCommandBuilder {
    this.addBasicHeightOptions(builder);
    this.addExtendedOptions(builder);
    return builder;
  }
}


