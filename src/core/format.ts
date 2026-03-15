import type {
  Quantity,
  QuantityRange,
  QuantitySingle,
  ScaledQuantity,
  ScaledQuantityCompound,
  ScaledQuantityRange,
  ScaledQuantitySingle,
  UnitDefinition,
  UnitMatch,
} from "./types";
import {
  choosePreferredUnit,
  fromBaseValue,
  isMetric,
  lookupUnit,
  roundToProfile,
  toBaseValue,
} from "./units";

const FRACTION_MAP: Record<number, string> = {
  0.125: "1/8",
  0.25: "1/4",
  0.3333333333: "1/3",
  0.5: "1/2",
  0.6666666666: "2/3",
  0.75: "3/4",
};

const VULGAR_FRACTIONS: Record<string, string> = {
  "1/8": "⅛",
  "1/4": "¼",
  "1/3": "⅓",
  "1/2": "½",
  "2/3": "⅔",
  "3/4": "¾",
};

const EPSILON = 1e-6;
const HAS_EXPLICIT_NUMBER = /[\d/]/;

const nearestFraction = (value: number): { whole: number; fraction: string | null } => {
  const whole = Math.trunc(value);
  const remainder = value - whole;

  let bestFraction: string | null = null;
  let bestDiff = Number.POSITIVE_INFINITY;
  let bestValue = 0;

  for (const [key, label] of Object.entries(FRACTION_MAP)) {
    const numeric = Number(key);
    const diff = Math.abs(remainder - numeric);
    if (diff < bestDiff - EPSILON) {
      bestDiff = diff;
      bestFraction = label;
      bestValue = numeric;
    }
  }

  if (bestFraction && bestDiff <= 0.05) {
    if (Math.abs(bestValue - 1) < EPSILON) {
      return { whole: whole + Math.sign(value), fraction: null };
    }
    return { whole, fraction: bestFraction };
  }

  return { whole, fraction: null };
};

const formatNumber = (value: number, unitInfo: UnitMatch | null, _allowFractions = false): string => {
  const isMetricUnit = unitInfo && isMetric(unitInfo.system);
  const fractionEnabled = !isMetricUnit;
  const absValue = Math.abs(value);

  // Try to match fractions first, before rounding
  if (fractionEnabled) {
    const fractionCandidate = nearestFraction(absValue);

    if (fractionCandidate.fraction) {
      const vulgar = VULGAR_FRACTIONS[fractionCandidate.fraction] ?? fractionCandidate.fraction;
      if (fractionCandidate.whole === 0) {
        return `${value < 0 ? "-" : ""}${vulgar}`;
      }
      return `${value < 0 ? "-" : ""}${Math.abs(fractionCandidate.whole)}${vulgar}`;
    }
  }

  // Apply rounding only if we didn't use a fraction
  const rounded = unitInfo?.rounding ? roundToProfile(value, unitInfo.rounding) : value;
  const precision = unitInfo?.rounding.precision;
  // For unknown units (no rounding profile), cap at 1 decimal place
  const effectivePrecision = precision ?? (unitInfo?.rounding ? undefined : 1);
  const fixed = effectivePrecision !== undefined ? rounded.toFixed(effectivePrecision) : rounded.toString();

  return fixed.replace(/\.0+$/, "").replace(/(\.\d*?[1-9])0+$/, "$1");
};

const convertValue = (
  value: number,
  sourceUnit: UnitMatch | null,
  targetUnit: UnitMatch | null,
): number => {
  if (!sourceUnit || !targetUnit || sourceUnit.canonical === targetUnit.canonical) {
    return value;
  }
  const base = toBaseValue(value, sourceUnit);
  if (base == null) {
    return value;
  }
  const converted = fromBaseValue(base, targetUnit);
  return converted ?? value;
};

const toUnitMatch = (
  unit: UnitDefinition | UnitMatch | null,
  fallback?: string | null,
): UnitMatch | null => {
  if (!unit) {
    return null;
  }
  if ((unit as UnitMatch).matched) {
    return unit as UnitMatch;
  }
  const definition = unit as UnitDefinition;
  return {
    ...definition,
    matched: fallback ?? definition.display,
  } satisfies UnitMatch;
};

const formatQuantitySingle = (
  quantity: QuantitySingle | ScaledQuantitySingle,
  sourceUnit: UnitMatch | null,
  displayUnit: UnitMatch | null,
  allowFractions: boolean,
  originalUnit: string | null,
): string => {
  const rawValue = "scaledValue" in quantity ? quantity.scaledValue : (quantity as QuantitySingle).value;
  const targetUnit = displayUnit ?? sourceUnit;
  const value = convertValue(rawValue, sourceUnit, targetUnit);
  const unit = targetUnit?.matched ?? originalUnit ?? quantity.unit ?? "";
  const formattedNumber = formatNumber(value, targetUnit ?? sourceUnit, allowFractions);
  return unit ? `${formattedNumber} ${unit}`.trim() : formattedNumber;
};

const formatQuantityRange = (
  quantity: QuantityRange | ScaledQuantityRange,
  sourceUnit: UnitMatch | null,
  displayUnit: UnitMatch | null,
  allowFractions: boolean,
  originalUnit: string | null,
): string => {
  const rawMin = "scaledMin" in quantity ? quantity.scaledMin : (quantity as QuantityRange).min;
  const rawMax = "scaledMax" in quantity ? quantity.scaledMax : (quantity as QuantityRange).max;
  const targetUnit = displayUnit ?? sourceUnit;
  const min = convertValue(rawMin, sourceUnit, targetUnit);
  const max = convertValue(rawMax, sourceUnit, targetUnit);
  const unit = targetUnit?.matched ?? originalUnit ?? quantity.unit ?? "";
  const formattedMin = formatNumber(min, targetUnit ?? sourceUnit, allowFractions);
  const formattedMax = formatNumber(max, targetUnit ?? sourceUnit, allowFractions);
  return unit ? `${formattedMin}-${formattedMax} ${unit}`.trim() : `${formattedMin}-${formattedMax}`;
};

export interface FormatQuantityOptions {
  scaled?: ScaledQuantity | null;
  targetUnit?: string | null;
  usePreferredUnit?: boolean;
}

export const formatQuantity = (
  original: Quantity | null | undefined,
  options: FormatQuantityOptions = {},
): string | null => {
  if (!original) {
    return null;
  }

  // If not scaling or converting, use the original raw text for unit-only
  // quantities (e.g., "pinch" instead of "1 pinch"). For quantities with
  // explicit numbers, always go through the formatter for consistent spacing.
  const isNotScaling = !options.scaled;
  const isNotConverting = !options.targetUnit && !options.usePreferredUnit;
  const hasExplicitNumber = original.raw ? HAS_EXPLICIT_NUMBER.test(original.raw) : false;
  if (isNotScaling && isNotConverting && original.raw && !hasExplicitNumber) {
    return original.raw;
  }

  // Compound: format each part independently and join with " + "
  if (original.kind === "compound") {
    const scaled = options.scaled as ScaledQuantityCompound | null | undefined;
    const formatPart = (part: QuantitySingle, scaledPart?: ScaledQuantitySingle) => {
      return formatQuantity(part, {
        scaled: scaledPart,
        targetUnit: options.targetUnit,
        usePreferredUnit: options.usePreferredUnit,
      });
    };
    const p1 = formatPart(original.parts[0], scaled?.scaledParts?.[0]);
    const p2 = formatPart(original.parts[1], scaled?.scaledParts?.[1]);
    if (p1 && p2) return `${p1} + ${p2}`;
    return p1 ?? p2;
  }

  // After compound early-return, original is single or range
  const singleOrRange = original as QuantitySingle | QuantityRange;
  const quantity = (options.scaled ?? singleOrRange) as
    | QuantitySingle
    | QuantityRange
    | ScaledQuantitySingle
    | ScaledQuantityRange;
  const fallbackUnit =
    "unitInfo" in quantity && quantity.unitInfo
      ? (quantity.unitInfo as UnitMatch)
      : quantity.unit
        ? lookupUnit(quantity.unit)
        : singleOrRange.unit
          ? lookupUnit(singleOrRange.unit)
          : null;

  const unitInfo: UnitMatch | null = "unitInfo" in quantity && quantity.unitInfo
    ? (quantity.unitInfo as UnitMatch)
    : fallbackUnit;

  const originalUnit = singleOrRange.unit ?? null;
  const sourceUnit = unitInfo ?? (originalUnit ? lookupUnit(originalUnit) : null);

  let displayUnit: UnitMatch | null = null;

  if (options.targetUnit) {
    displayUnit = lookupUnit(options.targetUnit);
  } else if (options.usePreferredUnit && sourceUnit?.base && sourceUnit?.system) {
    let baseMagnitude: number | null = null;

    if (quantity.kind === "range") {
      const range = quantity as QuantityRange;
      const rawMax = "scaledMax" in quantity ? (quantity as ScaledQuantityRange).scaledMax : range.max;
      baseMagnitude = toBaseValue(rawMax, sourceUnit);
    } else {
      const single = quantity as QuantitySingle;
      const rawValue = "scaledValue" in quantity ? (quantity as ScaledQuantitySingle).scaledValue : single.value;
      baseMagnitude = toBaseValue(rawValue, sourceUnit);
    }

    if (baseMagnitude != null) {
      const preferred = choosePreferredUnit(baseMagnitude, sourceUnit.base, sourceUnit.system);
      displayUnit = toUnitMatch(preferred, preferred?.display ?? null);
    }
  }

  // Allow fractions when not converting, or when converting within the same unit
  const allowFractions = !displayUnit || !!(displayUnit && sourceUnit && displayUnit.canonical === sourceUnit.canonical);

  if (quantity.kind === "range") {
    return formatQuantityRange(quantity, sourceUnit, displayUnit, allowFractions, originalUnit);
  }

  return formatQuantitySingle(quantity, sourceUnit, displayUnit, allowFractions, originalUnit);
};

/** Format a number as a text fraction string (e.g. 1.333 → "1 1/3") for user-facing inputs. */
export const numberToFractionText = (value: number): string => {
  const { whole, fraction } = nearestFraction(value);
  if (fraction) {
    return whole > 0 ? `${whole} ${fraction}` : fraction;
  }
  return Number.isInteger(value) ? value.toString() : parseFloat(value.toFixed(2)).toString();
};
