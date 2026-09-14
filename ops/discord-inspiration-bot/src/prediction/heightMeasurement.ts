import { HeightConverter, HeightFormatter, parseHeightToCm } from "./heightUtils";

export type HeightUnit = "ft" | "cm";

export interface HeightMeasurement {
  /**
   * Canonical centimetre value.
   */
  cm: number;
  /**
   * Total inches (feet * 12 + remainder).
   */
  inches: number;
  /**
   * Whole feet component derived from {@link inches}.
   */
  feet: number;
  /**
   * Remaining inches after subtracting {@link feet}. Always 0 <= value < 12.
   */
  inchesRemainder: number;
}

export interface HeightFormatOptions {
  unit: HeightUnit;
  /**
   * Number of fractional digits to keep (defaults: 0 for cm, 1 for ft).
   */
  precision?: number;
  /**
   * Remove the trailing double-quote from imperial strings (defaults to true).
   */
  stripInchSymbol?: boolean;
  /**
   * Optional suffix (defaults to `cm` for metric, empty for imperial).  
   * Pass `null` to suppress the suffix completely.
   */
  unitSuffix?: string | null;
  /**
   * Separator inserted between the numeric portion and suffix (defaults to no separator).
   */
  separator?: string;
}

const PRECISION_DEFAULTS: Record<HeightUnit, number> = {
  ft: 1,
  cm: 0,
};

/**
 * Utility guard ensuring we always work with finite, non-negative numbers.
 */
function normalizeValue(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, value);
}

export function createHeightMeasurementFromCm(cm: number): HeightMeasurement {
  const safeCm = normalizeValue(cm);
  const totalInches = HeightConverter.cmToInches(safeCm);
  const feet = Math.floor(totalInches / 12);
  const inchesRemainder = totalInches - feet * 12;

  return {
    cm: safeCm,
    inches: totalInches,
    feet,
    inchesRemainder,
  };
}

export function createHeightMeasurementFromInches(
  inches: number
): HeightMeasurement {
  const safeInches = normalizeValue(inches);
  const cm = HeightConverter.inchesToCm(safeInches);
  return createHeightMeasurementFromCm(cm);
}

export function createHeightMeasurementFromString(
  value: string
): HeightMeasurement {
  const trimmed = value?.trim();
  if (!trimmed) {
    return createHeightMeasurementFromCm(0);
  }

  const isMetric = /cm$/i.test(trimmed);
  const cm = isMetric
    ? normalizeValue(
        parseFloat(trimmed.replace(/cm/i, "").replace(/[^\d.]+/g, ""))
      )
    : normalizeValue(parseHeightToCm(trimmed, "ft"));
  return createHeightMeasurementFromCm(cm);
}

/**
 * Formats the provided measurement using shared rules so every screen
 * presents heights the same way.
 */
export function formatHeight(
  measurement: HeightMeasurement,
  options: HeightFormatOptions
): string {
  const { unit } = options;
  const precision =
    options.precision !== undefined
      ? Math.max(0, options.precision)
      : PRECISION_DEFAULTS[unit];
  const separator = options.separator ?? "";

  if (unit === "cm") {
    const multiplier = Math.pow(10, precision);
    const roundedRaw =
      precision === 0
        ? Math.round(measurement.cm)
        : Math.round(measurement.cm * multiplier) / multiplier;
    const formatted =
      precision === 0 ? String(roundedRaw) : roundedRaw.toFixed(precision);
    const suffix =
      options.unitSuffix === undefined
        ? "cm"
        : options.unitSuffix === null
        ? ""
        : options.unitSuffix;
    return suffix ? `${formatted}${separator}${suffix}` : formatted;
  }

  const raw = HeightConverter.inchesToFeetInchesPrecise(
    measurement.inches,
    precision
  );
  const stripInchSymbol = options.stripInchSymbol ?? true;
  const formatted = stripInchSymbol ? HeightFormatter.stripInchQuote(raw) : raw;
  const suffix =
    options.unitSuffix === undefined
      ? ""
      : options.unitSuffix === null
      ? ""
      : options.unitSuffix;
  return suffix ? `${formatted}${separator}${suffix}` : formatted;
}

function formatTruncatedNumber(value: number, decimals: number): string {
  const safeDecimals = Math.max(0, decimals);
  if (safeDecimals === 0) {
    return String(Math.floor(value));
  }
  const factor = Math.pow(10, safeDecimals);
  const truncated = Math.floor(value * factor) / factor;
  const fixed = truncated.toFixed(safeDecimals);
  const trimmed = fixed.replace(/0+$/, "");
  return trimmed.endsWith(".") ? `${trimmed}0` : trimmed;
}

/**
 * Formats the provided measurement without rounding up the displayed value.
 * Used for exact prediction surfaces where the rounded card value is shown
 * separately from the full underlying estimate.
 */
export function formatHeightTruncated(
  measurement: HeightMeasurement,
  options: HeightFormatOptions
): string {
  const { unit } = options;
  const precision =
    options.precision !== undefined
      ? Math.max(0, options.precision)
      : PRECISION_DEFAULTS[unit];
  const separator = options.separator ?? "";

  if (unit === "cm") {
    const formatted = formatTruncatedNumber(measurement.cm, precision);
    const suffix =
      options.unitSuffix === undefined
        ? "cm"
        : options.unitSuffix === null
        ? ""
        : options.unitSuffix;
    return suffix ? `${formatted}${separator}${suffix}` : formatted;
  }

  const feet = Math.floor(measurement.inches / 12);
  const inchesRemainder = Math.max(0, measurement.inches - feet * 12);
  const raw = `${feet}'${formatTruncatedNumber(inchesRemainder, precision)}"`;
  const stripInchSymbol = options.stripInchSymbol ?? true;
  const formatted = stripInchSymbol ? HeightFormatter.stripInchQuote(raw) : raw;
  const suffix =
    options.unitSuffix === undefined
      ? ""
      : options.unitSuffix === null
      ? ""
      : options.unitSuffix;
  return suffix ? `${formatted}${separator}${suffix}` : formatted;
}

export interface HeightDeltaFormatOptions
  extends Omit<HeightFormatOptions, "unitSuffix"> {
  /**
   * When provided, overrides the suffix appended to the result.
   */
  unitSuffix?: string | null;
  /**
    * Include the sign prefix (defaults to true).
    */
  showSign?: boolean;
}

/**
 * Formats a delta in centimetres using the shared formatting rules.
 */
export function formatHeightDelta(
  deltaCm: number,
  options: HeightDeltaFormatOptions
): string {
  const { unit, showSign = true } = options;
  const sign = deltaCm === 0 ? "" : deltaCm > 0 ? "+" : "-";
  const absoluteCm = Math.abs(deltaCm);
  if (unit === "cm") {
    const precision =
      options.precision !== undefined ? options.precision : 1;
    const measurement = createHeightMeasurementFromCm(absoluteCm);
    const formatted = formatHeight(measurement, {
      unit,
      precision,
      unitSuffix:
        options.unitSuffix === undefined ? "cm" : options.unitSuffix,
      separator: options.separator,
      stripInchSymbol: options.stripInchSymbol,
    });
    return showSign && sign ? `${sign}${formatted}` : formatted;
  }

  // For imperial representation we express the delta purely in inches.
  const deltaInches = HeightConverter.cmToInches(absoluteCm);
  const measurement = createHeightMeasurementFromInches(deltaInches);
  const precision = options.precision ?? 1;

  const suffix =
    options.unitSuffix === undefined ? '"' : options.unitSuffix ?? "";
  const separator = options.separator ?? "";

  if (measurement.feet === 0) {
    const roundedValue =
      precision === 0
        ? Math.round(measurement.inchesRemainder)
        : parseFloat(measurement.inchesRemainder.toFixed(precision));
    const formatted =
      precision === 0 ? String(roundedValue) : roundedValue.toFixed(precision);
    const suffixPart = suffix ? `${separator}${suffix}` : "";
    const result = `${formatted}${suffixPart}`;
    return showSign && sign ? `${sign}${result}` : result;
  }

  const formatted = formatHeight(measurement, {
    unit,
    precision,
    unitSuffix: options.unitSuffix ?? "",
    separator: options.separator,
    stripInchSymbol: options.stripInchSymbol,
  });
  return showSign && sign ? `${sign}${formatted}` : formatted;
}


