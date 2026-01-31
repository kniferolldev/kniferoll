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
      "version: 1",
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
      "version: 1",
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
      "version: 1",
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
      "version: 1",
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
      "version: 1",
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

test("fails with invalid selection (null)", () => {
  const doc = docFrom(baseRecipe);

  const result = computeScaleFactor(doc, null as never);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("invalid-selection");
  }
});

test("fails when document has no frontmatter for preset selection", () => {
  const doc = docFrom(baseRecipe);

  const result = computeScaleFactor(doc, { presetName: "Test" });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("missing-frontmatter");
  }
});

test("fails when frontmatter has no scales defined", () => {
  const doc = docFrom(
    [
      "---",
      "version: 1",
      "---",
      baseRecipe,
    ].join("\n"),
  );

  const result = computeScaleFactor(doc, { presetName: "Test" });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("no-scales");
  }
});

test("fails when frontmatter has empty scales array", () => {
  const doc = docFrom(
    [
      "---",
      "version: 1",
      "scales: []",
      "---",
      baseRecipe,
    ].join("\n"),
  );

  const result = computeScaleFactor(doc, { presetName: "Test" });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("no-scales");
  }
});

test("fails when preset index is out of bounds", () => {
  const doc = docFrom(
    [
      "---",
      "version: 1",
      "scales:",
      "  - name: Only One",
      "    anchor: { id: salt, amount: 5, unit: g }",
      "---",
      baseRecipe,
    ].join("\n"),
  );

  const result = computeScaleFactor(doc, { presetIndex: 5 });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("preset-not-found");
  }
});

test("fails when anchor has no id", () => {
  const doc = docFrom(baseRecipe);

  const result = computeScaleFactor(doc, {
    anchor: { id: "", amount: 10, unit: "g" },
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("anchor-invalid");
  }
});

test("fails when anchor amount is NaN", () => {
  const doc = docFrom(baseRecipe);

  const result = computeScaleFactor(doc, {
    anchor: { id: "salt", amount: NaN, unit: "g" },
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("anchor-invalid");
  }
});

test("fails when anchor amount is negative", () => {
  const doc = docFrom(baseRecipe);

  const result = computeScaleFactor(doc, {
    anchor: { id: "salt", amount: -5, unit: "g" },
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("anchor-invalid");
  }
});

test("fails when anchor amount is zero", () => {
  const doc = docFrom(baseRecipe);

  const result = computeScaleFactor(doc, {
    anchor: { id: "salt", amount: 0, unit: "g" },
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("anchor-invalid");
  }
});

test("fails when ingredient not found", () => {
  const doc = docFrom(baseRecipe);

  const result = computeScaleFactor(doc, {
    anchor: { id: "nonexistent", amount: 10, unit: "g" },
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("ingredient-not-found");
  }
});

test("fails when ingredient has range quantity", () => {
  const doc = docFrom(
    [
      "---",
      "version: 1",
      "---",
      "# Test Recipe",
      "## Ingredients",
      "- salt - 5-10 g :: id=salt",
    ].join("\n"),
  );

  const result = computeScaleFactor(doc, {
    anchor: { id: "salt", amount: 7, unit: "g" },
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("ingredient-range-quantity");
  }
});

test("fails when ingredient has zero quantity", () => {
  const doc = docFrom(
    [
      "---",
      "version: 1",
      "---",
      "# Test Recipe",
      "## Ingredients",
      "- salt - 0 g :: id=salt",
    ].join("\n"),
  );

  const result = computeScaleFactor(doc, {
    anchor: { id: "salt", amount: 10, unit: "g" },
  });
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.reason).toBe("zero-quantity");
  }
});

test("matches units case-insensitively", () => {
  const doc = docFrom(
    [
      "---",
      "version: 1",
      "---",
      "# Test Recipe",
      "## Ingredients",
      "- salt - 10 G :: id=salt",
    ].join("\n"),
  );

  const result = computeScaleFactor(doc, {
    anchor: { id: "salt", amount: 20, unit: "g" },
  });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.factor).toBe(2);
  }
});

test("matches null units when anchor has no unit", () => {
  const doc = docFrom(
    [
      "---",
      "version: 1",
      "---",
      "# Test Recipe",
      "## Ingredients",
      "- eggs - 2 :: id=eggs",
    ].join("\n"),
  );

  const result = computeScaleFactor(doc, {
    anchor: { id: "eggs", amount: 4, unit: "" },
  });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.factor).toBe(2);
  }
});

test("resolves preset by name case-insensitively", () => {
  const doc = docFrom(
    [
      "---",
      "version: 1",
      "scales:",
      "  - name: Double Batch",
      "    anchor: { id: salt, amount: 20, unit: g }",
      "---",
      baseRecipe,
    ].join("\n"),
  );

  const result = computeScaleFactor(doc, { presetName: "double batch" });
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.factor).toBe(2);
  }
});
