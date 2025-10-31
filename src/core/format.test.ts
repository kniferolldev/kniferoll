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
  expect(formatQuantity(q, { scaled })).toBe("1/4 cup");
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
  expect(formatQuantity(q, { scaled })).toBe("1/2 cup");
});

test("formatQuantity preserves unknown units", () => {
  const q = quantity("2 glugs");
  const scaled = scaleQuantity(q, 2);
  expect(formatQuantity(q, { scaled })).toBe("4 glugs");
});

test("formatQuantity can choose preferred unit automatically", () => {
  const q = quantity("12 tsp");
  const scaled = scaleQuantity(q, 5);
  expect(formatQuantity(q, { scaled, usePreferredUnit: true })).toBe("1.25 cup");
});

test("formatQuantity handles metric promotion", () => {
  const q = quantity("1500 g");
  const scaled = scaleQuantity(q, 1);
  expect(formatQuantity(q, { scaled })).toBe("1500 g");
  expect(formatQuantity(q, { scaled, targetUnit: "kg" })).toBe("1.5 kg");
});
