import { expect, test } from "bun:test";
import { parseQuantity } from "./quantity";

const run = (value: string) =>
  parseQuantity(value, {
    line: 1,
    invalid: {
      code: "E",
      message: "invalid",
    },
  });

test("parses single quantity with unit", () => {
  const result = run("240g");
  expect(result.diagnostics).toHaveLength(0);
  const quantity = result.quantity;
  if (!quantity || quantity.kind !== "single") {
    throw new Error("expected single quantity");
  }
  expect(quantity.value).toBe(240);
  expect(quantity.unit).toBe("g");
});

test("parses mixed fraction", () => {
  const result = run("1 1/2 cups");
  const quantity = result.quantity;
  if (!quantity || quantity.kind !== "single") {
    throw new Error("expected single quantity");
  }
  expect(quantity.value).toBeCloseTo(1.5);
  expect(quantity.unit).toBe("cups");
});

test("parses vulgar fraction", () => {
  const result = run("½ tsp");
  const quantity = result.quantity;
  if (!quantity || quantity.kind !== "single") {
    throw new Error("expected single quantity");
  }
  expect(quantity.value).toBeCloseTo(0.5);
  expect(quantity.unit).toBe("tsp");
});

test("parses range with hyphen", () => {
  const result = run("3-4 pieces");
  const range = result.quantity;
  if (!range || range.kind !== "range") {
    throw new Error("expected range quantity");
  }
  expect(range.min).toBe(3);
  expect(range.max).toBe(4);
  expect(range.unit).toBe("pieces");
});

test("parses range with en dash", () => {
  const result = run("3–4 cups");
  const range = result.quantity;
  if (!range || range.kind !== "range") {
    throw new Error("expected range quantity");
  }
  expect(range.min).toBe(3);
  expect(range.max).toBe(4);
  expect(range.unit).toBe("cups");
});

test("reports invalid quantity", () => {
  const result = run("about a cup");
  expect(result.quantity).toBeNull();
  expect(result.diagnostics.some((diag) => diag.code === "E")).toBe(true);
});

test("rejects blank quantity text", () => {
  const result = run("   ");
  expect(result.quantity).toBeNull();
  expect(result.diagnostics.some((diag) => diag.message === "invalid")).toBe(true);
});

test("parses single quantity without unit", () => {
  const result = run("42");
  const quantity = result.quantity;
  if (!quantity || quantity.kind !== "single") {
    throw new Error("expected single quantity");
  }
  expect(quantity.unit).toBeNull();
  expect(quantity.value).toBe(42);
});

test("normalizes descending ranges", () => {
  const result = run("4-3 cups");
  const range = result.quantity;
  if (!range || range.kind !== "range") {
    throw new Error("expected range quantity");
  }
  expect(range.min).toBe(3);
  expect(range.max).toBe(4);
});

test("rejects fractions with zero denominator", () => {
  const result = run("1/0 cups");
  expect(result.quantity).toBeNull();
  expect(result.diagnostics.some((diag) => diag.message === "invalid")).toBe(true);
});

test("rejects ranges when upper bound invalid", () => {
  const result = run("1- 1/0 cups");
  expect(result.quantity).toBeNull();
  expect(result.diagnostics.some((diag) => diag.message === "invalid")).toBe(true);
});

test("parses simple fraction without whole number", () => {
  const result = run("3/4 cup");
  const quantity = result.quantity;
  if (!quantity || quantity.kind !== "single") {
    throw new Error("expected single quantity");
  }
  expect(quantity.value).toBeCloseTo(0.75);
  expect(quantity.unit).toBe("cup");
});
