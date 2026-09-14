import type { ChatInputCommandInteraction } from 'discord.js';
import type { HeightInput } from '../../core/services/HeightService';
import { buildProjectionPubertyInputs, type PubertyAnswers } from '../../prediction/pubertyModel';

function parseOptionalNumber(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const parsed = parseFloat(value.trim());
  return Number.isFinite(parsed) ? parsed : undefined;
}

function parseWeightKg(value: string | null): number | undefined {
  if (!value) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  const numeric = parseFloat(normalized.replace(/[^0-9.]+/g, ''));
  if (!Number.isFinite(numeric)) {
    return undefined;
  }

  if (normalized.includes('lb')) {
    return numeric * 0.45359237;
  }

  return numeric;
}

function buildPubertyInput(
  interaction: ChatInputCommandInteraction
): PubertyAnswers | undefined {
  return buildProjectionPubertyInputs({
    puberty_underarmHair: (interaction.options.getString('underarm_hair') || undefined) as PubertyAnswers['puberty_underarmHair'],
    puberty_periodStart: (interaction.options.getString('period_started') || undefined) as PubertyAnswers['puberty_periodStart'],
    puberty_periodRegular: (interaction.options.getString('period_regular') || undefined) as PubertyAnswers['puberty_periodRegular'],
    puberty_facialHair: (interaction.options.getString('facial_hair') || undefined) as PubertyAnswers['puberty_facialHair'],
    puberty_growthLastYear: (interaction.options.getString('growth_last_year') || undefined) as PubertyAnswers['puberty_growthLastYear'],
    puberty_shouldersBroadening: (interaction.options.getString('shoulders') || undefined) as PubertyAnswers['puberty_shouldersBroadening'],
    puberty_bodyOdor: (interaction.options.getString('body_odor') || undefined) as PubertyAnswers['puberty_bodyOdor'],
    puberty_acneSeverity: (interaction.options.getString('acne') || undefined) as PubertyAnswers['puberty_acneSeverity'],
    puberty_muscleDefinition: (interaction.options.getString('muscles') || undefined) as PubertyAnswers['puberty_muscleDefinition'],
    puberty_voiceDepth: (interaction.options.getString('voice_depth') || undefined) as PubertyAnswers['puberty_voiceDepth'],
    puberty_stillGrowingSlower: (interaction.options.getString('still_growing') || undefined) as PubertyAnswers['puberty_stillGrowingSlower'],
    puberty_shaveFrequency: (interaction.options.getString('shave_frequency') || undefined) as PubertyAnswers['puberty_shaveFrequency'],
  });
}

export function buildHeightInputFromInteraction(
  interaction: ChatInputCommandInteraction
): HeightInput {
  return {
    heightStr: interaction.options.getString('height', true),
    age: interaction.options.getInteger('age', true),
    sex: (interaction.options.getString('sex') || '1') as '1' | '2',
    motherHeightStr: interaction.options.getString('mother_height') || undefined,
    fatherHeightStr: interaction.options.getString('father_height') || undefined,
    dreamHeightStr: interaction.options.getString('dream_height') || undefined,
    weightKg: parseWeightKg(interaction.options.getString('weight')),
    sleepHoursPerNight: parseOptionalNumber(interaction.options.getString('sleep_hours')),
    exerciseHoursPerWeek: parseOptionalNumber(interaction.options.getString('exercise_hours')),
    tallRelativesBeyondParents: interaction.options.getString('tall_relatives') === 'true',
    puberty: buildPubertyInput(interaction),
  };
}
