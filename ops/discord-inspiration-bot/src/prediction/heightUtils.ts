type SupportedUnit = "cm" | "in" | "lb" | "kg";

type Converter = {
  from: (fromUnit: SupportedUnit) => {
    to: (toUnit: SupportedUnit) => number;
  };
};

const CM_PER_INCH = 2.54;
const KG_PER_LB = 0.45359237;

const convertUnits = (value: number, fromUnit: SupportedUnit, toUnit: SupportedUnit): number => {
  if (!Number.isFinite(value)) {
    return NaN;
  }
  if (fromUnit === toUnit) {
    return value;
  }
  if (fromUnit === "cm" && toUnit === "in") {
    return value / CM_PER_INCH;
  }
  if (fromUnit === "in" && toUnit === "cm") {
    return value * CM_PER_INCH;
  }
  if (fromUnit === "lb" && toUnit === "kg") {
    return value * KG_PER_LB;
  }
  if (fromUnit === "kg" && toUnit === "lb") {
    return value / KG_PER_LB;
  }
  throw new Error(`Unsupported unit conversion: ${fromUnit} -> ${toUnit}`);
};

export const convert = (value: number): Converter => ({
  from: (fromUnit: SupportedUnit) => ({
    to: (toUnit: SupportedUnit) => convertUnits(value, fromUnit, toUnit),
  }),
});

export interface HeightValidationResult {
  isValid: boolean;
  errorMessage?: string;
  heightInCm?: number;
}

// Single source of truth for height conversions
export class HeightConverter {
  /**
   * Detect whether a user-entered height is metric or imperial.
   */
  static detectUnit(heightStr: string): "cm" | "ft" {
    const normalized = `${heightStr || ""}`.trim().toLowerCase();
    if (
      normalized.includes("cm") ||
      /\b\d{3}(?:\.\d+)?\b/.test(normalized) ||
      /^\d+(?:\.\d+)?$/.test(normalized) && parseFloat(normalized) >= 100
    ) {
      return "cm";
    }
    return "ft";
  }

  /**
   * Convert centimeters to feet and inches string
   * @param cm - height in centimeters
   * @param roundInches - whether to round inches (default: true)
   * @returns formatted string like "5'8""
   */
  static cmToFeetInches(cm: number, roundInches: boolean = true): string {
    const totalInches = convert(cm).from('cm').to('in');
    const feet = Math.floor(totalInches / 12);
    const remainingInches = roundInches ? Math.round(totalInches % 12) : totalInches % 12;
    
    // Handle edge case where rounding makes inches = 12
    if (roundInches && remainingInches === 12) {
      return `${feet + 1}'0"`;
    }
    
    return `${feet}'${Math.round(remainingInches)}"`;
  }

  /**
   * Convert centimeters to feet and inches without rounding
   * @param cm - height in centimeters
   * @returns formatted string like "5'8.5""
   */
  static cmToFeetInchesExact(cm: number): string {
    return this.cmToFeetInches(cm, false);
  }

  /**
   * Convert feet and inches string to centimeters
   * @param feetInches - height string like "5'8""
   * @returns height in centimeters
   */
  static feetInchesToCm(feetInches: string): number {
    const cleanHeight = feetInches
      .trim()
      .toLowerCase()
      .replace(/ft|feet/g, "'")
      .replace(/in|inch|inches|"/g, "")
      .replace(/\s*'\s*/, "'")
      .replace(/\s+/g, " ");

    let feet = 0;
    let inches = 0;

    if (cleanHeight.includes("'")) {
      const parts = cleanHeight.split("'");
      feet = parseInt(parts[0]) || 0;
      if (parts.length > 1) {
        inches = parseFloat(parts[1]) || 0;
      }
    } else if (cleanHeight.includes(" ")) {
      const parts = cleanHeight.split(" ");
      feet = parseInt(parts[0]) || 0;
      if (parts.length > 1) {
        inches = parseFloat(parts[1]) || 0;
      }
    } else {
      feet = parseInt(cleanHeight) || 0;
    }

    if (feet < 0 || feet > 8 || inches < 0 || inches >= 12) {
      return 0;
    }

    const totalInches = feet * 12 + inches;
    return convert(totalInches).from("in").to("cm");
  }

  /**
   * Convert centimeters to inches
   * @param cm - height in centimeters
   * @returns height in inches
   */
  static cmToInches(cm: number): number {
    return convert(cm).from('cm').to('in');
  }

  /**
   * Convert inches to centimeters
   * @param inches - height in inches
   * @returns height in centimeters
   */
  static inchesToCm(inches: number): number {
    return convert(inches).from('in').to('cm');
  }

  /**
   * Convert inches to feet and inches string
   * @param inches - height in inches
   * @param roundInches - whether to round inches (default: true)
   * @returns formatted string like "5'8""
   */
  static inchesToFeetInches(inches: number, roundInches: boolean = true): string {
    const feet = Math.floor(inches / 12);
    const remainingInches = roundInches ? Math.round(inches % 12) : inches % 12;
    
    // Handle edge case where rounding makes inches = 12
    if (roundInches && remainingInches === 12) {
      return `${feet + 1}'0"`;
    }
    
    return `${feet}'${Math.round(remainingInches)}"`;
  }

  /**
   * Convert inches to feet and inches string with decimal inches precision
   * @param inches - height in total inches
   * @param decimals - number of decimal places for inches (default: 2)
   * @returns formatted string like "5'8.25""
   */
  static inchesToFeetInchesPrecise(inches: number, decimals: number = 2): string {
    const feet = Math.floor(inches / 12);
    const fractionalInches = inches - feet * 12;
    const factor = Math.pow(10, decimals);
    let roundedInches = Math.round(fractionalInches * factor) / factor;

    // Handle rollover where rounding makes inches equal to 12.00
    if (roundedInches >= 12) {
      return `${feet + 1}'${(0).toFixed(decimals)}"`;
    }

    return `${feet}'${roundedInches.toFixed(decimals)}"`;
  }

  /**
   * Round height to specified decimal places
   * @param cm - height in centimeters
   * @param decimals - number of decimal places (default: 1)
   * @returns rounded height in centimeters
   */
  static roundHeight(cm: number, decimals: number = 1): number {
    return Math.round(cm * Math.pow(10, decimals)) / Math.pow(10, decimals);
  }

  /**
   * Round height to nearest centimeter
   * @param cm - height in centimeters
   * @returns rounded height in centimeters
   */
  static roundToNearestCm(cm: number): number {
    return Math.round(cm);
  }

  /**
   * Format a centimetre value with a configurable number of decimals.
   */
  static formatCm(cm: number, decimals: number = 1): string {
    const safeDecimals = Math.max(0, decimals);
    const rounded = HeightConverter.roundHeight(cm, safeDecimals);
    return `${rounded.toFixed(safeDecimals)}cm`;
  }
}

// Single source of truth for height validation
export class HeightValidator {
  /**
   * Validate height input and convert to centimeters
   * @param heightStr - height string input
   * @param unit - unit of input ("ft" or "cm")
   * @returns validation result with height in cm if valid
   */
  static validateAndConvert(heightStr: string, unit: "ft" | "cm"): HeightValidationResult {
    if (!heightStr.trim()) {
      return { isValid: false, errorMessage: "Height is required" };
    }
    
    let heightInCm: number;
    
    if (unit === "cm") {
      const cm = parseFloat(heightStr.trim());
      if (isNaN(cm)) {
        return { isValid: false, errorMessage: "Please enter a valid number" };
      }
      heightInCm = cm;
    } else {
      heightInCm = HeightConverter.feetInchesToCm(heightStr);
      if (heightInCm === 0) {
        return { isValid: false, errorMessage: "Please enter a valid height (e.g., 5'8 or 5 8)" };
      }
    }
    
    // Validate reasonable bounds
    if (unit === "cm") {
      if (heightInCm < 100 || heightInCm > 250) {
        return { isValid: false, errorMessage: "Please enter a height between 100-250 cm" };
      }
    } else {
      // For feet/inches, check reasonable bounds (about 3'0" to 8'0")
      if (heightInCm < 91 || heightInCm > 244) {
        return { isValid: false, errorMessage: "Please enter feet between 3-8" };
      }
    }
    
    return { isValid: true, heightInCm };
  }

  /**
   * Check if height is within reasonable bounds
   * @param cm - height in centimeters
   * @returns true if height is reasonable
   */
  static isReasonableHeight(cm: number): boolean {
    return cm >= 91 && cm <= 244; // 3'0" to 8'0"
  }
}

// Formatting utilities
export class HeightFormatter {
  /**
   * Format height for input display
   * @param heightInCm - height in centimeters
   * @param unit - desired output unit
   * @returns formatted height string
   */
  static formatForDisplay(heightInCm: number, unit: "ft" | "cm"): string {
    if (unit === "cm") {
      return HeightConverter.roundToNearestCm(heightInCm).toString();
    } else {
      return HeightConverter.cmToFeetInches(heightInCm);
    }
  }

  /**
   * Format height for storage (always in cm, rounded to 1 decimal)
   * @param heightInCm - height in centimeters
   * @returns formatted height for storage
   */
  static formatForStorage(heightInCm: number): number {
    return HeightConverter.roundHeight(heightInCm, 1);
  }

  /**
   * Format height string (ft/in format) to user's preferred unit
   * @param ftHeight - height in feet/inches format (e.g., "5'8"")
   * @param preferredUnit - user's preferred unit ("ft" or "cm")
   * @returns formatted height string
   */
  static formatHeightForDisplay(ftHeight: string, preferredUnit: "ft" | "cm"): string {
    if (preferredUnit === "cm") {
      const cm = HeightConverter.feetInchesToCm(ftHeight);
      const rounded = Math.round(cm * 100) / 100;
      return `${rounded.toFixed(2)}cm`;
    }
    // Convert to a normalized one-decimal feet-inches string without trailing quote
    const cm = HeightConverter.feetInchesToCm(ftHeight);
    const inches = HeightConverter.cmToInches(cm);
    const ftOneDecimal = HeightConverter.inchesToFeetInchesPrecise(inches, 1);
    return HeightFormatter.stripInchQuote(ftOneDecimal);
  }

  /**
   * Remove trailing inch quote for display (e.g., 6'3.21" -> 6'3.21)
   */
  static stripInchQuote(ftHeight: string): string {
    if (typeof ftHeight !== 'string') return ftHeight as unknown as string;
    return ftHeight.endsWith('"') ? ftHeight.slice(0, -1) : ftHeight;
  }

  /**
   * Format height for display, preserving original cm value when preferred unit is cm
   * @param originalCm - original height in centimeters
   * @param ftHeight - height in feet/inches format (e.g., "5'8"")
   * @param preferredUnit - user's preferred unit ("ft" or "cm")
   * @returns formatted height string
   */
  static formatHeightForDisplayPreserveOriginal(originalCm: number, ftHeight: string, preferredUnit: "ft" | "cm"): string {
    if (preferredUnit === "cm") {
      // Preserve original current height display in cm (no forced 2 decimals)
      return `${Math.round(originalCm)}cm`;
    }
    // Normalize to one-decimal feet-inches without trailing quote
    const inches = HeightConverter.cmToInches(originalCm);
    const ftOneDecimal = HeightConverter.inchesToFeetInchesPrecise(inches, 1);
    return HeightFormatter.stripInchQuote(ftOneDecimal);
  }
}

// Legacy functions for backward compatibility
export const getHeightForInput = (heightInCm: number, unit: "ft" | "cm"): string => {
  return HeightFormatter.formatForDisplay(heightInCm, unit);
};

export const parseHeightToCm = (heightStr: string, unit: "ft" | "cm"): number => {
  if (unit === "cm") {
    // Accept strings like "170", "170 cm", "170cm"
    const cleaned = heightStr.trim().toLowerCase().replace(/cm/g, "");
    const cm = parseFloat(cleaned.replace(/[^0-9.]+/g, "").trim());
    return isNaN(cm) ? 0 : cm;
  } else {
    return HeightConverter.feetInchesToCm(heightStr);
  }
};

export const validateHeightInput = (heightStr: string, unit: "ft" | "cm"): HeightValidationResult => {
  return HeightValidator.validateAndConvert(heightStr, unit);
};

export const validateHeight = validateHeightInput;
