import { calculateHeightProjection } from '../../prediction/heightProjection';
import { calculateDreamHeightProbability } from '../../prediction/dreamHeightProbability';
import { HeightValidator, HeightConverter } from '../../prediction/heightUtils';
import {
  createHeightMeasurementFromCm,
  formatHeight,
  type HeightMeasurement,
  type HeightUnit,
} from '../../prediction/heightMeasurement';
import {
  getShortReasons,
  type PubertyQuizInputs,
  type ShortReason,
} from '../../prediction/ShortReasons';
import type { PubertyAnswers } from '../../prediction/pubertyModel';
import type { ProjectionImageData } from './ImageService';

export interface HeightInput {
  heightStr: string;
  age: number;
  sex: '1' | '2';
  motherHeightStr?: string;
  fatherHeightStr?: string;
  dreamHeightStr?: string;
  weightKg?: number;
  sleepHoursPerNight?: number;
  exerciseHoursPerWeek?: number;
  tallRelativesBeyondParents?: boolean;
  puberty?: PubertyAnswers;
}

export interface HeightPresentation {
  outputUnit: HeightUnit;
  currentHeightDisplay: string;
  predictedHeightDisplay: string;
  actualHeightDisplay: string;
  potentialHeightDisplay: string;
  motherHeightDisplay?: string;
  fatherHeightDisplay?: string;
  heightGain: number;
  unitLabel: string;
  reasons: string[];
  issuesCount: number;
  issuesWord: string;
  growthComplete: number;
  percentileRank: number;
  percentileDisplay: string;
  currentAge: number;
  dreamProbability?: number;
}

export interface HeightCalculationResult {
  currentHeightCm: number;
  age: number;
  sex: '1' | '2';
  projection: ReturnType<typeof calculateHeightProjection>;
  probabilityResult: ReturnType<typeof calculateDreamHeightProbability> | null;
  motherHeightCm?: number;
  fatherHeightCm?: number;
  percentileRank: number;
  shortReasons: ShortReason[];
  pubertyQuiz: PubertyQuizInputs;
  presentation: HeightPresentation;
}

/**
 * Service for height calculation and prediction logic
 * Extracts business logic from command handlers
 */
export class HeightService {
  /**
   * Parse height string and determine unit
   */
  private parseHeightUnit(heightStr: string): 'cm' | 'ft' {
    return HeightConverter.detectUnit(heightStr);
  }

  private getPreferredDisplayUnit(heightStr: string): HeightUnit {
    return this.parseHeightUnit(heightStr) === 'cm' ? 'cm' : 'ft';
  }

  private formatMeasurement(
    measurement: HeightMeasurement,
    unit: HeightUnit,
    precision: number
  ): string {
    return formatHeight(measurement, { unit, precision });
  }

  private formatMeasurementFromCm(
    cm: number,
    unit: HeightUnit,
    precision: number
  ): string {
    return this.formatMeasurement(createHeightMeasurementFromCm(cm), unit, precision);
  }

  private formatPercentile(percentileRank: number): string {
    if (!Number.isFinite(percentileRank)) {
      return '50';
    }

    try {
      return new Intl.NumberFormat(undefined, {
        maximumFractionDigits: 2,
        minimumFractionDigits: 0,
      }).format(percentileRank);
    } catch {
      const rounded = Math.round(percentileRank * 100) / 100;
      return `${rounded}`;
    }
  }

  private buildPubertyQuizInputs(puberty?: PubertyAnswers): PubertyQuizInputs {
    if (!puberty) {
      return {};
    }

    let stillGrowing: PubertyQuizInputs['stillGrowing'];
    switch (puberty.puberty_stillGrowingSlower) {
      case 'yes':
      case 'same':
      case 'faster':
        stillGrowing = 'yes';
        break;
      case 'slower':
        stillGrowing = 'yesButSlower';
        break;
      case 'no':
      case 'notgrown':
        stillGrowing = 'no';
        break;
      default:
        stillGrowing = undefined;
    }

    return {
      underarmHair:
        puberty.puberty_underarmHair && puberty.puberty_underarmHair !== 'idk'
          ? puberty.puberty_underarmHair
          : undefined,
      periodStarted:
        puberty.puberty_periodStart === 'not_started'
          ? 'notStarted'
          : puberty.puberty_periodStart && puberty.puberty_periodStart !== 'idk'
          ? puberty.puberty_periodStart
          : undefined,
      periodRegular:
        puberty.puberty_periodRegular && puberty.puberty_periodRegular !== 'idk'
          ? puberty.puberty_periodRegular
          : undefined,
      facialHair:
        puberty.puberty_facialHair === 'sometimes'
          ? 'shaveSometimes'
          : puberty.puberty_facialHair === 'regular'
          ? 'shaveRegularly'
          : puberty.puberty_facialHair && puberty.puberty_facialHair !== 'idk'
          ? puberty.puberty_facialHair
          : undefined,
      heightGainLastYear:
        puberty.puberty_growthLastYear === 'lt2'
          ? '<2cm'
          : puberty.puberty_growthLastYear === '2to5'
          ? '2-5cm'
          : puberty.puberty_growthLastYear === '6to9'
          ? '6-9cm'
          : puberty.puberty_growthLastYear === '10plus'
          ? '10+cm'
          : undefined,
      broaderShoulders:
        puberty.puberty_shouldersBroadening === 'broader'
          ? 'clearly'
          : puberty.puberty_shouldersBroadening && puberty.puberty_shouldersBroadening !== 'idk'
          ? puberty.puberty_shouldersBroadening
          : undefined,
      bodyOdor:
        puberty.puberty_bodyOdor === 'no'
          ? 'none'
          : puberty.puberty_bodyOdor === 'definitely'
          ? 'definite'
          : puberty.puberty_bodyOdor && puberty.puberty_bodyOdor !== 'idk'
          ? 'little'
          : undefined,
      acne:
        puberty.puberty_acneSeverity === 'severe'
          ? 'frequent'
          : puberty.puberty_acneSeverity === 'cleared'
          ? 'wentAway'
          : puberty.puberty_acneSeverity && puberty.puberty_acneSeverity !== 'idk'
          ? puberty.puberty_acneSeverity
          : undefined,
      muscleDefinition:
        puberty.puberty_muscleDefinition === 'clear'
          ? 'clearly'
          : puberty.puberty_muscleDefinition && puberty.puberty_muscleDefinition !== 'idk'
          ? puberty.puberty_muscleDefinition
          : undefined,
      voiceDeepened:
        puberty.puberty_voiceDepth === 'nochange'
          ? 'noChange'
          : puberty.puberty_voiceDepth === 'full'
          ? 'fully'
          : puberty.puberty_voiceDepth && puberty.puberty_voiceDepth !== 'idk'
          ? puberty.puberty_voiceDepth
          : undefined,
      stillGrowing,
    };
  }

  private buildPresentation(params: {
    input: HeightInput;
    currentHeightCm: number;
    motherHeightCm?: number;
    fatherHeightCm?: number;
    projection: ReturnType<typeof calculateHeightProjection>;
    probabilityResult: ReturnType<typeof calculateDreamHeightProbability> | null;
    shortReasons: ShortReason[];
  }): HeightPresentation {
    const {
      input,
      currentHeightCm,
      motherHeightCm,
      fatherHeightCm,
      projection,
      probabilityResult,
      shortReasons,
    } = params;
    const outputUnit = this.getPreferredDisplayUnit(input.heightStr);
    const predictedAdultHeightCm =
      typeof projection.projectedAdultHeightCm === 'number' &&
      Number.isFinite(projection.projectedAdultHeightCm)
        ? projection.projectedAdultHeightCm
        : projection.potential.cm;
    const heightGainCm = Math.max(0, projection.potential.cm - projection.actual.cm);
    const percentileRank =
      typeof projection.percentileRank === 'number' && Number.isFinite(projection.percentileRank)
        ? projection.percentileRank
        : 50;
    const reasons = shortReasons.map((reason) => reason.message);

    return {
      outputUnit,
      currentHeightDisplay: this.formatMeasurementFromCm(
        currentHeightCm,
        outputUnit,
        0
      ),
      predictedHeightDisplay: this.formatMeasurementFromCm(
        predictedAdultHeightCm,
        outputUnit,
        1
      ),
      actualHeightDisplay: this.formatMeasurement(
        projection.actual,
        outputUnit,
        1
      ),
      potentialHeightDisplay: this.formatMeasurement(
        projection.potential,
        outputUnit,
        1
      ),
      motherHeightDisplay:
        motherHeightCm != null
          ? this.formatMeasurementFromCm(motherHeightCm, outputUnit, 0)
          : undefined,
      fatherHeightDisplay:
        fatherHeightCm != null
          ? this.formatMeasurementFromCm(fatherHeightCm, outputUnit, 0)
          : undefined,
      heightGain:
        outputUnit === 'cm'
          ? Math.round(heightGainCm)
          : Math.round(HeightConverter.cmToInches(heightGainCm)),
      unitLabel: outputUnit === 'cm' ? 'cm' : 'inch(es)',
      reasons,
      issuesCount: Math.max(1, reasons.length),
      issuesWord: reasons.length === 1 ? 'issue' : 'issues',
      growthComplete: projection.growthComplete ?? 85,
      percentileRank,
      percentileDisplay: this.formatPercentile(percentileRank),
      currentAge: input.age,
      dreamProbability: probabilityResult?.probability,
    };
  }

  /**
   * Validate and convert height string to centimeters
   */
  public validateHeight(heightStr: string): { isValid: boolean; heightInCm?: number; errorMessage?: string } {
    const unit = this.parseHeightUnit(heightStr);
    return HeightValidator.validateAndConvert(heightStr, unit);
  }

  /**
   * Calculate height projection with all validations
   */
  public calculateHeight(input: HeightInput): HeightCalculationResult | string {
    // Validate current height
    const heightValidation = this.validateHeight(input.heightStr);
    if (!heightValidation.isValid) {
      return heightValidation.errorMessage!;
    }
    const currentHeightCm = heightValidation.heightInCm!;

    // Parse parent heights if provided
    let motherHeightCm: number | undefined;
    let fatherHeightCm: number | undefined;

    if (input.motherHeightStr) {
      const motherValidation = this.validateHeight(input.motherHeightStr);
      if (motherValidation.isValid) {
        motherHeightCm = motherValidation.heightInCm;
      }
    }

    if (input.fatherHeightStr) {
      const fatherValidation = this.validateHeight(input.fatherHeightStr);
      if (fatherValidation.isValid) {
        fatherHeightCm = fatherValidation.heightInCm;
      }
    }

    // Calculate height projection
    const projection = calculateHeightProjection({
      heightCm: currentHeightCm,
      age: input.age,
      sex: input.sex,
      motherHeightCm,
      fatherHeightCm,
      weightKg: input.weightKg,
      sleepHoursPerNight: input.sleepHoursPerNight,
      exerciseHoursPerWeek: input.exerciseHoursPerWeek,
      puberty: input.puberty,
    });

    // Calculate dream height probability if provided
    let probabilityResult = null;
    if (input.dreamHeightStr) {
      const dreamValidation = this.validateHeight(input.dreamHeightStr);
      if (dreamValidation.isValid) {
        probabilityResult = calculateDreamHeightProbability({
          dreamHeightCm: dreamValidation.heightInCm!,
          currentHeightCm,
          age: input.age,
          sex: input.sex,
          motherHeightCm,
          fatherHeightCm,
          weightKg: input.weightKg,
          sleepHoursPerNight: input.sleepHoursPerNight,
          exerciseHoursPerWeek: input.exerciseHoursPerWeek,
          puberty: input.puberty,
        });
      }
    }

    const pubertyQuiz = this.buildPubertyQuizInputs(input.puberty);
    const shortReasons = getShortReasons({
      ageYears: input.age,
      sex: input.sex === '1' ? 'male' : 'female',
      selfHeightCm: currentHeightCm,
      weightKg: input.weightKg,
      motherHeightCm,
      fatherHeightCm,
      tallRelativesBeyondParents: input.tallRelativesBeyondParents,
      exerciseHoursPerWeek: input.exerciseHoursPerWeek,
      sleepHoursPerNight: input.sleepHoursPerNight,
      pubertyQuiz,
    });
    const presentation = this.buildPresentation({
      input,
      currentHeightCm,
      motherHeightCm,
      fatherHeightCm,
      projection,
      probabilityResult,
      shortReasons,
    });

    return {
      currentHeightCm,
      age: input.age,
      sex: input.sex,
      projection,
      probabilityResult,
      motherHeightCm,
      fatherHeightCm,
      percentileRank: presentation.percentileRank,
      shortReasons,
      pubertyQuiz,
      presentation,
    };
  }

  public buildProjectionImageData(result: HeightCalculationResult): ProjectionImageData {
    return {
      currentHeight: result.presentation.currentHeightDisplay,
      predictedHeight: result.presentation.predictedHeightDisplay,
      heightGain: result.presentation.heightGain,
      unitLabel: result.presentation.unitLabel,
      issuesCount: result.presentation.issuesCount,
      issuesWord: result.presentation.issuesWord,
      reasons: result.presentation.reasons,
      growthComplete: result.presentation.growthComplete,
      dreamData:
        result.presentation.dreamProbability != null
          ? { probability: result.presentation.dreamProbability }
          : undefined,
      percentileRank: result.presentation.percentileRank,
      percentileDisplay: result.presentation.percentileDisplay,
      currentAge: result.presentation.currentAge,
      progressPercent: 85,
    };
  }

  /**
   * Format calculation results as text
   */
  public formatResults(result: HeightCalculationResult): string {
    let responseText = `## Height Calculation Results\n\n`;
    responseText += `**Current Height:** ${result.presentation.currentHeightDisplay}\n`;
    responseText += `**Age:** ${result.age} years old\n`;
    responseText += `**Sex:** ${result.sex === '1' ? 'Male' : 'Female'}\n\n`;

    if (result.presentation.motherHeightDisplay) {
      responseText += `**Mother's Height:** ${result.presentation.motherHeightDisplay}\n`;
    }
    if (result.presentation.fatherHeightDisplay) {
      responseText += `**Father's Height:** ${result.presentation.fatherHeightDisplay}\n`;
    }
    if (result.presentation.motherHeightDisplay || result.presentation.fatherHeightDisplay) {
      responseText += `\n`;
    }

    responseText += `### Projection\n`;
    responseText += `• **Predicted Adult Height:** ${result.presentation.predictedHeightDisplay}\n`;
    responseText += `• **Likely Adult Height:** ${result.presentation.actualHeightDisplay}\n`;
    responseText += `• **Best-Case Height:** ${result.presentation.potentialHeightDisplay}\n`;
    responseText += `• **Optimize Gain:** +${result.presentation.heightGain} ${result.presentation.unitLabel}\n`;
    responseText += `• **Taller Than:** ${result.presentation.percentileDisplay}% of people your age\n\n`;

    responseText += `### Height Analysis\n`;
    result.presentation.reasons.forEach((reason) => {
      responseText += `• ${reason}\n`;
    });
    responseText += `\n`;

    if (result.probabilityResult) {
      responseText += `### Dream Height Probability\n`;
      responseText += `• **Dream Height:** ${result.probabilityResult.dreamHeightFormatted}\n`;
      responseText += `• **Probability:** ${result.probabilityResult.probability}%\n`;
      responseText += `• **Difference:** ${result.probabilityResult.heightDifferenceFormatted}\n`;
    }

    return responseText;
  }
}


