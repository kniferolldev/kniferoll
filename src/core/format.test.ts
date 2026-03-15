import { expect, test } from "bun:test";
import { parseQuantity } from "./quantity";
import { scaleQuantity } from "./scale-quantity";
import { formatQuantity } from "./format";

const quantity = (text: string) =>
  parseQuantity(text, {
    line: 1,
    invalid: { code: "ERR", message: "invalid" },
  }).quantity!;

test("formatQuantity renders simple values", () => {
  const q = quantity("2 cups");
  expect(formatQuantity(q)).toBe("2 cups");
});

test("formatQuantity renders scaled values with fractions", () => {
  const q = quantity("1 cup");
  const scaled = scaleQuantity(q, 0.25);
  expect(formatQuantity(q, { scaled })).toBe("¼ cup");
  expect(formatQuantity(q, { scaled, targetUnit: "tbsp" })).toBe("4 tbsp");
});

test("formatQuantity handles ranges", () => {
  const q = quantity("1-2 tbsp");
  const scaled = scaleQuantity(q, 2);
  expect(formatQuantity(q, { scaled })).toBe("2-4 tbsp");
});

test("formatQuantity promotes units to tablespoons", () => {
  const q = quantity("1 cup");
  const scaled = scaleQuantity(q, 0.5);
  expect(formatQuantity(q, { scaled, targetUnit: "tbsp" })).toBe("8 tbsp");
  expect(formatQuantity(q, { scaled })).toBe("½ cup");
});

test("formatQuantity preserves unknown units", () => {
  const q = quantity("2 glugs");
  const scaled = scaleQuantity(q, 2);
  expect(formatQuantity(q, { scaled })).toBe("4 glugs");
});

test("formatQuantity can choose preferred unit automatically", () => {
  const q = quantity("12 tsp");
  const scaled = scaleQuantity(q, 5);
  expect(formatQuantity(q, { scaled, usePreferredUnit: true })).toBe("1¼ cup");
});

test("formatQuantity handles metric promotion", () => {
  const q = quantity("1500 g");
  const scaled = scaleQuantity(q, 1);
  expect(formatQuantity(q, { scaled })).toBe("1500 g");
  expect(formatQuantity(q, { scaled, targetUnit: "kg" })).toBe("1.5 kg");
});

test("formatQuantity preserves 1/3 cup with usePreferredUnit", () => {
  const q = quantity("1/3 cup");
  expect(formatQuantity(q, { usePreferredUnit: true })).toBe("⅓ cup");
});

test("formatQuantity normalizes spacing between number and unit", () => {
  const q = quantity("153g");
  expect(formatQuantity(q)).toBe("153 g");
  const q2 = quantity("2cups");
  expect(formatQuantity(q2)).toBe("2 cups");
  // Already-spaced is unchanged
  const q3 = quantity("2 cups");
  expect(formatQuantity(q3)).toBe("2 cups");
});

test("formatQuantity strips trailing zeros from scaled gram values", () => {
  const q = quantity("535 g");
  const scaled = scaleQuantity(q, 1);
  expect(formatQuantity(q, { scaled })).toBe("535 g");
});

test("formatQuantity shows decimal not fraction for metric units", () => {
  const q = quantity("1 g");
  const scaled = scaleQuantity(q, 0.5);
  expect(formatQuantity(q, { scaled })).toBe("0.5 g");
});

test("formatQuantity shows precision for small gram values", () => {
  const q = quantity("0.9 g");
  const scaled = scaleQuantity(q, 1);
  expect(formatQuantity(q, { scaled })).toBe("0.9 g");
});

test("formatQuantity preserves unit-only quantities without scaling", () => {
  const q = quantity("pinch");
  expect(formatQuantity(q)).toBe("pinch");
  expect(formatQuantity(q, {})).toBe("pinch");
});

// ── Compound quantities ─────────────────────────────────────────────

test("formatQuantity returns raw text for unscaled compound", () => {
  const q = quantity("1 cup + 3 tbsp");
  expect(formatQuantity(q)).toBe("1 cup + 3 tbsp");
});

test("formatQuantity formats scaled compound parts independently", () => {
  const q = quantity("1 cup + 3 tbsp");
  const scaled = scaleQuantity(q, 2);
  expect(formatQuantity(q, { scaled })).toBe("2 cup + 6 tbsp");
});

test("formatQuantity expands unit-only quantities when scaling", () => {
  const q = quantity("pinch");
  const scaled = scaleQuantity(q, 2);
  expect(formatQuantity(q, { scaled })).toBe("2 pinch");
});

test("formatQuantity caps precision for unknown units", () => {
  const q = quantity("2 glugs");
  const scaled = scaleQuantity(q, 1.017);
  // Without capping, this would be "2.0338983..." — should be 1 decimal place
  expect(formatQuantity(q, { scaled })).toBe("2 glugs");
});

test("formatQuantity shows 1 decimal for unknown units when needed", () => {
  const q = quantity("3 egg");
  const scaled = scaleQuantity(q, 1.4);
  expect(formatQuantity(q, { scaled })).toBe("4.2 egg");
});
