import { expect, test } from "bun:test";
import { extractInlineValues, timerTokenToProse } from "./steps";

test("extractInlineValues parses temperatures", () => {
  const line = "Bake at {350F} for about 1 hour 15 minutes.";
  const { tokens, invalid } = extractInlineValues(line);

  expect(invalid.length).toBe(0);
  expect(tokens.length).toBe(1);

  expect(tokens[0]).toEqual(
    expect.objectContaining({
      kind: "temperature",
      value: 350,
      scale: "F",
    }),
  );
});

test("extractInlineValues parses Celsius temperatures", () => {
  const line = "Heat to {190C}.";
  const { tokens, invalid } = extractInlineValues(line);

  expect(invalid.length).toBe(0);
  expect(tokens.length).toBe(1);
  expect(tokens[0]).toEqual(
    expect.objectContaining({
      kind: "temperature",
      value: 190,
      scale: "C",
    }),
  );
});

test("extractInlineValues parses decimal temperatures", () => {
  const line = "Sous vide at {63.3C}.";
  const { tokens, invalid } = extractInlineValues(line);

  expect(invalid.length).toBe(0);
  expect(tokens.length).toBe(1);
  expect(tokens[0]).toEqual(
    expect.objectContaining({
      kind: "temperature",
      value: 63.3,
      scale: "C",
    }),
  );
});

test("extractInlineValues parses negative temperatures", () => {
  const line = "Freeze to {-18C}.";
  const { tokens, invalid } = extractInlineValues(line);

  expect(invalid.length).toBe(0);
  expect(tokens.length).toBe(1);
  expect(tokens[0]).toEqual(
    expect.objectContaining({
      kind: "temperature",
      value: -18,
      scale: "C",
    }),
  );
});

test("extractInlineValues parses quantity tokens", () => {
  const line = "This makes about {20} meatballs.";
  const { tokens, invalid } = extractInlineValues(line);

  expect(invalid.length).toBe(0);
  expect(tokens.length).toBe(1);
  expect(tokens[0]).toEqual(
    expect.objectContaining({
      kind: "quantity",
      quantity: expect.objectContaining({
        kind: "single",
        value: 20,
        unit: null,
      }),
    }),
  );
});

test("extractInlineValues parses quantity with unit", () => {
  const line = "You should have about {3 cups} of sauce.";
  const { tokens, invalid } = extractInlineValues(line);

  expect(invalid.length).toBe(0);
  expect(tokens.length).toBe(1);
  expect(tokens[0]).toEqual(
    expect.objectContaining({
      kind: "quantity",
      quantity: expect.objectContaining({
        kind: "single",
        value: 3,
        unit: "cups",
      }),
    }),
  );
});

test("extractInlineValues parses range quantities", () => {
  const line = "Divide into {2-3 oz} portions.";
  const { tokens, invalid } = extractInlineValues(line);

  expect(invalid.length).toBe(0);
  expect(tokens.length).toBe(1);
  expect(tokens[0]).toEqual(
    expect.objectContaining({
      kind: "quantity",
      quantity: expect.objectContaining({
        kind: "range",
        min: 2,
        max: 3,
        unit: "oz",
      }),
    }),
  );
});

test("extractInlineValues parses fraction quantities", () => {
  const line = "Add {1/2} of the remaining dough.";
  const { tokens, invalid } = extractInlineValues(line);

  expect(invalid.length).toBe(0);
  expect(tokens.length).toBe(1);
  expect(tokens[0]).toEqual(
    expect.objectContaining({
      kind: "quantity",
      quantity: expect.objectContaining({
        kind: "single",
        value: 0.5,
      }),
    }),
  );
});

test("extractInlineValues parses mixed fraction quantities", () => {
  const line = "You'll need about {1 1/2 cups} of broth.";
  const { tokens, invalid } = extractInlineValues(line);

  expect(invalid.length).toBe(0);
  expect(tokens.length).toBe(1);
  expect(tokens[0]).toEqual(
    expect.objectContaining({
      kind: "quantity",
      quantity: expect.objectContaining({
        kind: "single",
        value: 1.5,
        unit: "cups",
      }),
    }),
  );
});

test("extractInlineValues parses metric quantities", () => {
  const line = "Use about {500ml} of stock.";
  const { tokens, invalid } = extractInlineValues(line);

  expect(invalid.length).toBe(0);
  expect(tokens.length).toBe(1);
  expect(tokens[0]).toEqual(
    expect.objectContaining({
      kind: "quantity",
      quantity: expect.objectContaining({
        kind: "single",
        value: 500,
        unit: "ml",
      }),
    }),
  );
});

test("extractInlineValues disambiguates temperature vs quantity", () => {
  // {3C} is temperature (no space before C)
  const line1 = "Cool to {3C}.";
  const { tokens: t1 } = extractInlineValues(line1);
  expect(t1[0]).toEqual(expect.objectContaining({ kind: "temperature", value: 3, scale: "C" }));

  // {3 c} is 3 cups (space before unit)
  const line2 = "Add {3 c} of water.";
  const { tokens: t2 } = extractInlineValues(line2);
  expect(t2[0]).toEqual(
    expect.objectContaining({
      kind: "quantity",
      quantity: expect.objectContaining({ value: 3, unit: "c" }),
    }),
  );
});

test("extractInlineValues parses compound quantity in inline value", () => {
  const line = "You'll need {1 cup + 3 tbsp} of water.";
  const { tokens, invalid } = extractInlineValues(line);

  expect(invalid.length).toBe(0);
  expect(tokens.length).toBe(1);
  expect(tokens[0]).toEqual(
    expect.objectContaining({
      kind: "quantity",
      quantity: expect.objectContaining({
        kind: "compound",
        parts: [
          expect.objectContaining({ value: 1, unit: "cup" }),
          expect.objectContaining({ value: 3, unit: "tbsp" }),
        ],
      }),
    }),
  );
});

// ── Inline alternates ─────────────────────────────────────────────────

test("extractInlineValues parses simple alternate", () => {
  const line = "You'll need {1 cup | 240g} of water.";
  const { tokens, invalid } = extractInlineValues(line);

  expect(invalid.length).toBe(0);
  expect(tokens.length).toBe(1);
  expect(tokens[0]).toEqual(
    expect.objectContaining({
      kind: "quantity",
      quantity: expect.objectContaining({ kind: "single", value: 1, unit: "cup" }),
      alternates: [expect.objectContaining({ kind: "single", value: 240, unit: "g" })],
    }),
  );
});

test("extractInlineValues parses multiple alternates", () => {
  const line = "Add {1 cup | 240g | 236ml} of liquid.";
  const { tokens, invalid } = extractInlineValues(line);

  expect(invalid.length).toBe(0);
  expect(tokens.length).toBe(1);
  expect(tokens[0]).toEqual(
    expect.objectContaining({
      kind: "quantity",
      alternates: [
        expect.objectContaining({ value: 240, unit: "g" }),
        expect.objectContaining({ value: 236, unit: "ml" }),
      ],
    }),
  );
});

test("extractInlineValues parses compound native with alternate", () => {
  const line = "Add {1 cup + 3 tbsp | 285g} of broth.";
  const { tokens, invalid } = extractInlineValues(line);

  expect(invalid.length).toBe(0);
  expect(tokens.length).toBe(1);
  expect(tokens[0]).toEqual(
    expect.objectContaining({
      kind: "quantity",
      quantity: expect.objectContaining({
        kind: "compound",
        parts: [
          expect.objectContaining({ value: 1, unit: "cup" }),
          expect.objectContaining({ value: 3, unit: "tbsp" }),
        ],
      }),
      alternates: [expect.objectContaining({ value: 285, unit: "g" })],
    }),
  );
});

test("extractInlineValues treats temperature with pipe as temperature (no alternates)", () => {
  const line = "Heat to {350F | 180C}.";
  const { tokens, invalid } = extractInlineValues(line);

  expect(invalid.length).toBe(0);
  expect(tokens.length).toBe(1);
  expect(tokens[0]).toEqual(
    expect.objectContaining({
      kind: "temperature",
      value: 350,
      scale: "F",
    }),
  );
});

test("extractInlineValues without pipe has no alternates", () => {
  const line = "Add {3 cups} of water.";
  const { tokens } = extractInlineValues(line);

  expect(tokens.length).toBe(1);
  expect(tokens[0]).toEqual(
    expect.objectContaining({
      kind: "quantity",
    }),
  );
  expect((tokens[0] as any).alternates).toBeUndefined();
});

test("extractInlineValues skips invalid alternates", () => {
  const line = "Add {1 cup | ???} of water.";
  const { tokens, invalid } = extractInlineValues(line);

  expect(invalid.length).toBe(0);
  expect(tokens.length).toBe(1);
  expect(tokens[0]).toEqual(
    expect.objectContaining({
      kind: "quantity",
      quantity: expect.objectContaining({ value: 1, unit: "cup" }),
    }),
  );
  expect((tokens[0] as any).alternates).toBeUndefined();
});

test("extractInlineValues handles multiple tokens", () => {
  const line = "Heat oven to {350F}. Makes about {12} muffins.";
  const { tokens, invalid } = extractInlineValues(line);

  expect(invalid.length).toBe(0);
  expect(tokens.length).toBe(2);
  expect(tokens[0]).toEqual(expect.objectContaining({ kind: "temperature" }));
  expect(tokens[1]).toEqual(expect.objectContaining({ kind: "quantity" }));
});

test("extractInlineValues reports invalid tokens", () => {
  const line = "Use about {???} of it.";
  const { tokens, invalid } = extractInlineValues(line);

  expect(tokens.length).toBe(0);
  expect(invalid).toEqual([
    expect.objectContaining({
      raw: "{???}",
    }),
  ]);
});

test("extractInlineValues captures raw and index", () => {
  const line = "Preheat to {375F}.";
  const { tokens } = extractInlineValues(line);

  expect(tokens[0]).toEqual(
    expect.objectContaining({
      raw: "{375F}",
      index: 11,
    }),
  );
});

// ── timerTokenToProse ────────────────────────────────────────────────

test("timerTokenToProse converts simple minutes", () => {
  expect(timerTokenToProse("@30m")).toBe("30 minutes");
  expect(timerTokenToProse("@1m")).toBe("1 minute");
});

test("timerTokenToProse converts simple hours", () => {
  expect(timerTokenToProse("@1h")).toBe("1 hour");
  expect(timerTokenToProse("@2h")).toBe("2 hours");
});

test("timerTokenToProse converts compound durations", () => {
  expect(timerTokenToProse("@1h15m")).toBe("1 hour and 15 minutes");
  expect(timerTokenToProse("@2h30m")).toBe("2 hours and 30 minutes");
});

test("timerTokenToProse converts seconds", () => {
  expect(timerTokenToProse("@30s")).toBe("30 seconds");
  expect(timerTokenToProse("@1s")).toBe("1 second");
});

test("timerTokenToProse converts full compound", () => {
  expect(timerTokenToProse("@1h15m30s")).toBe("1 hour, 15 minutes and 30 seconds");
});

test("timerTokenToProse returns null for temperatures", () => {
  expect(timerTokenToProse("@350F")).toBeNull();
  expect(timerTokenToProse("@190C")).toBeNull();
});

test("timerTokenToProse returns null for invalid tokens", () => {
  expect(timerTokenToProse("@10-15m")).toBeNull();
  expect(timerTokenToProse("@abc")).toBeNull();
});

test("timerTokenToProse works without @ prefix", () => {
  expect(timerTokenToProse("30m")).toBe("30 minutes");
  expect(timerTokenToProse("1h30m")).toBe("1 hour and 30 minutes");
});
