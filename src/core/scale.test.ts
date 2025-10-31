import { expect, test } from "bun:test";
import { computeScaleFactor } from "./scale";
import { parseDocument } from "./parser";

const docFrom = (source: string) => parseDocument(source);

const baseRecipe = `
# Roast Chicken
## Ingredients
- chicken - 2
- salt - 10 g :: id=salt
- stock - 500 ml :: id=stock
## Steps
1. Season the chicken.
`.trim();

test("computeScaleFactor resolves preset by name", () => {
  const doc = docFrom(
    [
      "---",
      "version: 0.0.1",
      "scales:",
      "  - name: Half Batch",
      "    anchor: { id: salt, amount: 5, unit: g }",
      "  - name: Double Stock",
      "    anchor: { id: stock, amount: 1000, unit: ml }",
      "---",
      baseRecipe,
    ].join("\n"),
  );

  const result = computeScaleFactor(doc, { presetName: "Double Stock" });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.factor).toBeCloseTo(2);
    expect(result.source).toBe("preset");
    expect(result.preset).toEqual({ name: "Double Stock", index: 1 });
    expect(result.anchor).toEqual({ id: "stock", amount: 1000, unit: "ml" });
    expect(result.ingredient.quantity.value).toBe(500);
    expect(result.ingredient.recipeId).toBe("roast-chicken");
  }
});

test("computeScaleFactor resolves preset by index", () => {
  const doc = docFrom(
    [
      "---",
      "version: 0.0.1",
      "scales:",
      "  - name: Default",
      "    anchor: { id: salt, amount: 10, unit: g }",
      "---",
      baseRecipe,
    ].join("\n"),
  );

  const result = computeScaleFactor(doc, { presetIndex: 0 });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.factor).toBe(1);
    expect(result.ingredient.id).toBe("salt");
  }
});

test("computeScaleFactor supports manual anchor", () => {
  const doc = docFrom(baseRecipe);

  const result = computeScaleFactor(doc, {
    anchor: { id: "salt", amount: 20, unit: "g" },
  });

  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.source).toBe("manual");
    expect(result.factor).toBe(2);
  }
});

test("fails when ingredient lacks quantity", () => {
  const doc = docFrom(
    [
      "---",
      "version: 0.0.1",
      "scales:",
      "  - name: Invalid",
      "    anchor: { id: chicken, amount: 4, unit: count }",
      "---",
      "# Roast Chicken",
      "## Ingredients",
      "- chicken",
    ].join("\n"),
  );

  const result = computeScaleFactor(doc, { presetName: "Invalid" });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("ingredient-missing-quantity");
  }
});

test("fails when units mismatch", () => {
  const doc = docFrom(
    [
      "---",
      "version: 0.0.1",
      "scales:",
      "  - name: Bad",
      "    anchor: { id: salt, amount: 10, unit: teaspoons }",
      "---",
      baseRecipe,
    ].join("\n"),
  );

  const result = computeScaleFactor(doc, { presetName: "Bad" });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("unit-mismatch");
  }
});

test("fails when preset missing", () => {
  const doc = docFrom(
    [
      "---",
      "version: 0.0.1",
      "scales:",
      "  - name: Small",
      "    anchor: { id: salt, amount: 5, unit: g }",
      "---",
      baseRecipe,
    ].join("\n"),
  );

  const result = computeScaleFactor(doc, { presetName: "Nope" });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("preset-not-found");
  }
});
