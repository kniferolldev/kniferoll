import type {
  RoundingProfile,
  UnitDefinition,
  UnitDimension,
  UnitFamily,
  UnitMatch,
} from "./types";

const define = (definition: UnitDefinition): UnitDefinition => definition;

const UNIT_DEFINITIONS: readonly UnitDefinition[] = [
  // Mass
  define({
    canonical: "g",
    display: "g",
    aliases: ["g", "gram", "grams"],
    dimension: "mass",
    rounding: { increment: 1 },
    base: "g",
    toBase: 1,
    family: "mass",
    preferred: {
      thresholds: [
        { unit: "kg", min: 1000 },
        { unit: "g", min: 0 },
      ],
    },
  }),
  define({
    canonical: "kg",
    display: "kg",
    aliases: ["kg", "kilogram", "kilograms"],
    dimension: "mass",
    rounding: { increment: 0.05, precision: 2 },
    base: "g",
    toBase: 1000,
    family: "mass",
  }),
  // Volume - metric
  define({
    canonical: "ml",
    display: "ml",
    aliases: ["ml", "milliliter", "milliliters", "millilitre", "millilitres"],
    dimension: "volume",
    rounding: { increment: 5 },
    base: "ml",
    toBase: 1,
    family: "volume_metric",
    preferred: {
      thresholds: [
        { unit: "l", min: 1000 },
        { unit: "ml", min: 0 },
      ],
    },
  }),
  define({
    canonical: "l",
    display: "L",
    aliases: ["l", "liter", "liters", "litre", "litres"],
    dimension: "volume",
    rounding: { increment: 0.05, precision: 2 },
    base: "ml",
    toBase: 1000,
    family: "volume_metric",
  }),

  // Volume - imperial / US customary
  define({
    canonical: "cup",
    display: "cup",
    aliases: ["cup", "cups"],
    dimension: "volume",
    rounding: { increment: 0.25, precision: 2 },
    base: "tsp",
    toBase: 48,
    family: "volume_us",
  }),
  define({
    canonical: "tbsp",
    display: "tbsp",
    aliases: ["tbsp", "tablespoon", "tablespoons"],
    dimension: "volume",
    rounding: { increment: 0.5, precision: 2 },
    base: "tsp",
    toBase: 3,
    family: "volume_us",
  }),
  define({
    canonical: "tsp",
    display: "tsp",
    aliases: ["tsp", "teaspoon", "teaspoons"],
    dimension: "volume",
    rounding: { increment: 0.25, precision: 2 },
    base: "tsp",
    toBase: 1,
    family: "volume_us",
    preferred: {
      thresholds: [
        { unit: "cup", min: 12 },  // >= 1/4 cup (12 tsp) -> use cups
        { unit: "tbsp", min: 3 },
        { unit: "tsp", min: 0 },
      ],
    },
  }),
  define({
    canonical: "fl oz",
    display: "fl oz",
    aliases: ["fl oz", "fluid ounce", "fluid ounces"],
    dimension: "volume",
    rounding: { increment: 0.5, precision: 2 },
    base: "tsp",
    toBase: 6,
    family: "volume_us",
  }),

  // Count
  define({
    canonical: "count",
    display: "",
    aliases: ["", "ea", "each"],
    dimension: "count",
    rounding: { increment: 1 },
    family: "count",
  }),
];

const UNIT_INDEX = new Map<string, UnitDefinition>();
const UNIT_BY_CANONICAL = new Map<string, UnitDefinition>();

for (const definition of UNIT_DEFINITIONS) {
  UNIT_BY_CANONICAL.set(definition.canonical, definition);
  for (const alias of definition.aliases) {
    UNIT_INDEX.set(alias.toLowerCase(), definition);
  }
}

const normalizeUnit = (unit: string): string | null => {
  const trimmed = unit.trim();
  if (trimmed === "") {
    return null;
  }
  return trimmed.toLowerCase();
};

export const lookupUnit = (unit: string): UnitMatch | null => {
  const normalized = normalizeUnit(unit);
  if (!normalized) {
    return null;
  }

  const definition = UNIT_INDEX.get(normalized);
  if (!definition) {
    return null;
  }

  return {
    ...definition,
    matched: unit ?? definition.display,
  };
};

export const getUnitDefinition = (canonical: string): UnitDefinition | null => {
  return UNIT_BY_CANONICAL.get(canonical) ?? null;
};

export const toBaseValue = (value: number, unit: UnitMatch | UnitDefinition): number => {
  const factor = unit.toBase ?? 1;
  return value * factor;
};

export const fromBaseValue = (baseValue: number, unit: UnitDefinition | UnitMatch): number => {
  const factor = unit.toBase ?? 1;
  if (factor === 0) {
    return baseValue;
  }
  return baseValue / factor;
};

export const roundToProfile = (value: number, profile: RoundingProfile): number => {
  const increment = profile.increment;
  if (!Number.isFinite(increment) || increment <= 0) {
    return value;
  }

  const rounded = Math.round(value / increment) * increment;
  if (profile.precision !== undefined) {
    const factor = 10 ** profile.precision;
    return Math.round(rounded * factor) / factor;
  }

  return rounded;
};

export const UNITS = UNIT_DEFINITIONS;

export interface UnitConversion {
  value: number;
  unit: UnitMatch;
}

export const convertUnit = (
  value: number,
  from: UnitMatch | null,
  toCanonical: string,
): number | null => {
  if (!from || !from.base || from.base === from.canonical) {
    return from?.toBase ? value * from.toBase : value;
  }

  if (from.base !== toCanonical) {
    // For now we only convert within same family/base.
    return null;
  }

  return value * (from.toBase ?? 1);
};

export const choosePreferredUnit = (
  baseValue: number,
  family: UnitFamily | undefined,
): UnitDefinition | null => {
  if (!family) {
    return null;
  }

  const candidates = UNIT_DEFINITIONS.filter((def) => def.family === family);
  if (candidates.length === 0) {
    return null;
  }

  const withPreferred = candidates.filter((def) => def.preferred);
  if (withPreferred.length === 0) {
    return null;
  }

  // Sort thresholds descending so we pick highest matching range.
  const matches = withPreferred.flatMap((def) =>
    def.preferred?.thresholds.map((entry) => ({ def, entry })) ?? [],
  );

  matches.sort((a, b) => b.entry.min - a.entry.min);

  const absBase = Math.abs(baseValue);

  for (const { entry } of matches) {
    if (absBase >= entry.min) {
      const target = UNIT_DEFINITIONS.find((candidate) => candidate.canonical === entry.unit);
      if (target) {
        return target;
      }
    }
  }

  return null;
};
