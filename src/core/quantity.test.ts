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

test("parses unit-only quantity as implied amount of 1", () => {
  const result = run("pinch");
  expect(result.diagnostics).toHaveLength(0);
  const quantity = result.quantity;
  if (!quantity || quantity.kind !== "single") {
    throw new Error("expected single quantity");
  }
  expect(quantity.value).toBe(1);
  expect(quantity.unit).toBe("pinch");
});

test("parses multi-word unit-only quantity", () => {
  const result = run("about a cup");
  expect(result.diagnostics).toHaveLength(0);
  const quantity = result.quantity;
  if (!quantity || quantity.kind !== "single") {
    throw new Error("expected single quantity");
  }
  expect(quantity.value).toBe(1);
  expect(quantity.unit).toBe("about a cup");
});

test("parses dash as unit-only quantity", () => {
  const result = run("dash");
  expect(result.diagnostics).toHaveLength(0);
  const quantity = result.quantity;
  if (!quantity || quantity.kind !== "single") {
    throw new Error("expected single quantity");
  }
  expect(quantity.value).toBe(1);
  expect(quantity.unit).toBe("dash");
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

test("parses range with 'to'", () => {
  const result = run("4 to 5 cups");
  expect(result.diagnostics).toHaveLength(0);
  const range = result.quantity;
  if (!range || range.kind !== "range") {
    throw new Error("expected range quantity");
  }
  expect(range.min).toBe(4);
  expect(range.max).toBe(5);
  expect(range.unit).toBe("cups");
});

test("parses range with 'to' without unit", () => {
  const result = run("2 to 3");
  expect(result.diagnostics).toHaveLength(0);
  const range = result.quantity;
  if (!range || range.kind !== "range") {
    throw new Error("expected range quantity");
  }
  expect(range.min).toBe(2);
  expect(range.max).toBe(3);
  expect(range.unit).toBeNull();
});

test("parses range with 'TO' (case insensitive)", () => {
  const result = run("3 TO 4 cups");
  expect(result.diagnostics).toHaveLength(0);
  const range = result.quantity;
  if (!range || range.kind !== "range") {
    throw new Error("expected range quantity");
  }
  expect(range.min).toBe(3);
  expect(range.max).toBe(4);
  expect(range.unit).toBe("cups");
});

// ── Compound quantities ─────────────────────────────────────────────

test("parses compound quantity '1 cup + 3 tbsp'", () => {
  const result = run("1 cup + 3 tbsp");
  expect(result.diagnostics).toHaveLength(0);
  const quantity = result.quantity;
  if (!quantity || quantity.kind !== "compound") {
    throw new Error("expected compound quantity");
  }
  expect(quantity.parts[0].value).toBe(1);
  expect(quantity.parts[0].unit).toBe("cup");
  expect(quantity.parts[1].value).toBe(3);
  expect(quantity.parts[1].unit).toBe("tbsp");
  expect(quantity.raw).toBe("1 cup + 3 tbsp");
});

test("compound requires spaces around +", () => {
  // "1 cup+3 tbsp" should not parse as compound
  const result = run("1 cup+3 tbsp");
  expect(result.quantity?.kind).not.toBe("compound");
});

test("compound with unitless part falls through to single", () => {
  // Both parts must have explicit units
  const result = run("1 + 3 tbsp");
  expect(result.quantity?.kind).not.toBe("compound");
});

test("compound with >2 parts falls through", () => {
  const result = run("1 cup + 2 tbsp + 1 tsp");
  expect(result.quantity?.kind).not.toBe("compound");
});

test("compound with range part falls through", () => {
  const result = run("1-2 cup + 3 tbsp");
  expect(result.quantity?.kind).not.toBe("compound");
});

test("parses compound with fractions", () => {
  const result = run("1/2 cup + 1 tbsp");
  expect(result.diagnostics).toHaveLength(0);
  const quantity = result.quantity;
  if (!quantity || quantity.kind !== "compound") {
    throw new Error("expected compound quantity");
  }
  expect(quantity.parts[0].value).toBeCloseTo(0.5);
  expect(quantity.parts[0].unit).toBe("cup");
  expect(quantity.parts[1].value).toBe(1);
  expect(quantity.parts[1].unit).toBe("tbsp");
});

test("does not treat 'to' in words as range separator", () => {
  // "potato" contains "to" but not as a standalone word between numbers
  const result1 = run("1 potato");
  expect(result1.diagnostics).toHaveLength(0);
  const quantity = result1.quantity;
  if (!quantity || quantity.kind !== "single") {
    throw new Error("expected single quantity");
  }
  expect(quantity.value).toBe(1);
  expect(quantity.unit).toBe("potato");

  // "to taste" contains "to" but not between numbers
  const result2 = run("pinch, to taste");
  expect(result2.diagnostics).toHaveLength(0);
});
