import type {
  Quantity,
  QuantityCompound,
  QuantityRange,
  QuantitySingle,
  ScaledQuantity,
  ScaledQuantityCompound,
  ScaledQuantityRange,
  ScaledQuantitySingle,
  UnitMatch,
} from "./types";
import { lookupUnit, roundToProfile } from "./units";

const scaleValue = (value: number, factor: number, unit: UnitMatch | null) => {
  const raw = value * factor;
  const rounded = unit?.rounding ? roundToProfile(raw, unit.rounding) : raw;
  return {
    raw,
    rounded,
  };
};

const scaleSingle = (
  quantity: QuantitySingle,
  factor: number,
  unitMatch: UnitMatch | null,
): ScaledQuantitySingle => {
  const { raw, rounded } = scaleValue(quantity.value, factor, unitMatch);

  return {
    ...quantity,
    value: raw,
    scaledValue: rounded,
    unitInfo: unitMatch,
  };
};

const scaleRange = (
  quantity: QuantityRange,
  factor: number,
  unitMatch: UnitMatch | null,
): ScaledQuantityRange => {
  const scaledMin = scaleValue(quantity.min, factor, unitMatch);
  const scaledMax = scaleValue(quantity.max, factor, unitMatch);

  return {
    ...quantity,
    min: scaledMin.raw,
    max: scaledMax.raw,
    scaledMin: scaledMin.rounded,
    scaledMax: scaledMax.rounded,
    unitInfo: unitMatch,
  };
};

const scaleCompound = (
  quantity: QuantityCompound,
  factor: number,
): ScaledQuantityCompound => {
  const [p1, p2] = quantity.parts;
  const u1 = p1.unit ? lookupUnit(p1.unit) : null;
  const u2 = p2.unit ? lookupUnit(p2.unit) : null;
  return {
    ...quantity,
    scaledParts: [scaleSingle(p1, factor, u1), scaleSingle(p2, factor, u2)],
  };
};

export const scaleQuantity = (
  quantity: Quantity | null | undefined,
  factor: number,
): ScaledQuantity | null => {
  if (!quantity) {
    return null;
  }

  if (!Number.isFinite(factor) || factor <= 0) {
    return null;
  }

  if (quantity.kind === "compound") {
    return scaleCompound(quantity, factor);
  }

  const unitMatch = quantity.unit ? lookupUnit(quantity.unit) : null;

  if (quantity.kind === "single") {
    return scaleSingle(quantity, factor, unitMatch);
  }

  return scaleRange(quantity as QuantityRange, factor, unitMatch);
};
