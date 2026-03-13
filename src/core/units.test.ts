import { expect, test } from "bun:test";
import {
  UNITS,
  choosePreferredUnit,
  fromBaseValue,
  isMetricFamily,
  lookupUnit,
  roundToProfile,
  toBaseValue,
} from "./units";

test("lookupUnit normalizes aliases and casing", () => {
  const unit = lookupUnit("Tablespoons");
  expect(unit).toBeTruthy();
  expect(unit?.canonical).toBe("tbsp");
});

test("lookupUnit returns null for unknown unit", () => {
  expect(lookupUnit("glug")).toBeNull();
});

test("toBaseValue and fromBaseValue convert between units", () => {
  const cup = lookupUnit("cup")!;
  const tsp = lookupUnit("tsp")!;
  const baseValue = toBaseValue(2, cup);
  expect(baseValue).toBeCloseTo(96);
  const converted = fromBaseValue(baseValue, tsp);
  expect(converted).toBeCloseTo(96);
});

test("roundToProfile applies increment and precision", () => {
  const tbsp = lookupUnit("tbsp")!;
  const rounded = roundToProfile(1.37, tbsp.rounding);
  expect(rounded).toBeCloseTo(1.5);
});

test("choosePreferredUnit selects preferred unit based on thresholds", () => {
  const tsp = lookupUnit("tsp")!;
  const preferred = choosePreferredUnit(toBaseValue(60, tsp), tsp.family);
  expect(preferred?.canonical).toBe("cup");
});

test("choosePreferredUnit returns null when no preferred unit", () => {
  const count = lookupUnit("each")!;
  expect(choosePreferredUnit(10, count.family)).toBeNull();
});

test("roundToProfile rounds grams to 0.1 increments", () => {
  const g = lookupUnit("g")!;
  expect(roundToProfile(0.3, g.rounding)).toBe(0.3);
  expect(roundToProfile(0.15, g.rounding)).toBe(0.1);
  expect(roundToProfile(0.16, g.rounding)).toBe(0.2);
  expect(roundToProfile(535, g.rounding)).toBe(535);
});

test("roundToProfile rounds ml to 1 increment", () => {
  const ml = lookupUnit("ml")!;
  expect(roundToProfile(3.7, ml.rounding)).toBe(4);
  expect(roundToProfile(130, ml.rounding)).toBe(130);
});

test("isMetricFamily identifies metric unit families", () => {
  expect(isMetricFamily("mass")).toBe(true);
  expect(isMetricFamily("volume_metric")).toBe(true);
  expect(isMetricFamily("volume_us")).toBe(false);
  expect(isMetricFamily("count")).toBe(false);
  expect(isMetricFamily(undefined)).toBe(false);
});
