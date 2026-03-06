import { expect, test } from "bun:test";
import { parseDocument } from "./parser";

const byCode = (
  diagnostics: ReturnType<typeof parseDocument>["diagnostics"],
  code: string,
) => diagnostics.filter((diag) => diag.code === code);

test("parses single recipe without frontmatter and flags missing sections", () => {
  const input = "# Recipe\n\nContent";
  const result = parseDocument(input);

  expect(result.frontmatter).toBeNull();
  expect(result.body).toBe(input);
  expect(result.documentTitle).toBeNull();
  expect(result.recipes).toHaveLength(1);
  expect(byCode(result.diagnostics, "E0101")).toHaveLength(2);
});

test("parses frontmatter, overall title, and recipe sections", () => {
  const input = [
    "---",
    "version: 1",
    "---",
    "# Fancy Cake Collection",
    "",
    "# Chocolate Cake",
    "## ingredients",
    "## STEPS",
    "## Notes",
  ].join("\n");

  const result = parseDocument(input);
  expect(result.frontmatter?.version).toBe(1);
  expect(result.recipes).toHaveLength(1);
  expect(result.documentTitle?.text).toBe("Fancy Cake Collection");

  const recipe = result.recipes[0];
  expect(recipe).toBeDefined();
  if (!recipe) {
    throw new Error("Expected recipe to be parsed");
  }
  expect(recipe.title).toBe("Chocolate Cake");
  expect(recipe.sections.map((section) => section.kind)).toEqual([
    "ingredients",
    "steps",
    "notes",
  ]);
  expect(result.diagnostics).toHaveLength(0);
});

test("emits E0101 when recipe is missing required sections", () => {
  const input = [
    "# Soup",
    "## Ingredients",
    "",
    "# Pie",
    "## Steps",
  ].join("\n");

  const result = parseDocument(input);
  const errors = byCode(result.diagnostics, "E0101");

  expect(errors).toHaveLength(2);
  const messages = errors.map((error) => error.message);
  expect(messages.some((msg) => msg.includes("Soup") && msg.includes("Steps"))).toBe(true);
  expect(messages.some((msg) => msg.includes("Pie") && msg.includes("Ingredients"))).toBe(true);
});

test("emits E0103 when section appears before a recipe", () => {
  const input = [
    "## Ingredients",
    "# Recipe",
  ].join("\n");

  const result = parseDocument(input);
  const errors = byCode(result.diagnostics, "E0103");

  expect(errors).toHaveLength(1);
  const [first] = errors;
  expect(first).toBeDefined();
  if (!first) return;
  expect(first.line).toBe(1);
});

test("emits W0102 for unknown sections", () => {
  const input = [
    "# Bread",
    "## Extras",
  ].join("\n");

  const result = parseDocument(input);
  const warnings = byCode(result.diagnostics, "W0102");

  expect(warnings).toHaveLength(1);
  expect(result.recipes[0]?.sections[0]?.kind).toBe("unknown");
});

test("duplicate recipe titles are allowed (no longer used for references)", () => {
  const input = [
    "# Classic Bread",
    "## Ingredients",
    "- flour",
    "## Steps",
    "1. Bake.",
    "# Classic Bread",
    "## Ingredients",
    "- salt",
    "## Steps",
    "1. Season.",
  ].join("\n");

  const result = parseDocument(input);
  // Recipe titles no longer create IDs, so duplicate titles don't cause errors
  expect(byCode(result.diagnostics, "E0301").length).toBe(0);
});

test("duplicate ingredient ids emit E0301", () => {
  const input = [
    "# Soup",
    "## Ingredients",
    "- salt",
    "- salt",
    "## Steps",
    "1. Stir.",
  ].join("\n");

  const result = parseDocument(input);
  expect(byCode(result.diagnostics, "E0301").length).toBeGreaterThanOrEqual(1);
});

test("extracts references and resolves ids", () => {
  const input = [
    "# Salad",
    "## Ingredients",
    "- lettuce :: id=lettuce",
    "## Steps",
    "1. Toss [[lettuce]].",
  ].join("\n");

  const result = parseDocument(input);
  const ref = result.references[0];
  expect(ref).toBeDefined();
  if (!ref) {
    throw new Error("Expected reference to be collected");
  }
  expect(ref.target).toBe("lettuce");
  expect(byCode(result.diagnostics, "W0302").length).toBe(0);
});

test("normalizes reference targets with spaces and casing", () => {
  const input = [
    "# Soup",
    "## Ingredients",
    "- dried porcini mushrooms - 1 oz",
    "- Extra Virgin Olive Oil - 2 tbsp",
    "## Steps",
    "1. Soak the [[dried porcini mushrooms]] in hot water.",
    "2. Heat the [[Extra Virgin Olive Oil]] over medium heat.",
    "3. You can also use [[DRIED PORCINI MUSHROOMS]] uppercase.",
  ].join("\n");

  const result = parseDocument(input);

  // All three references should be normalized and resolve successfully
  expect(result.references).toHaveLength(3);
  expect(result.references[0]?.target).toBe("dried-porcini-mushrooms");
  expect(result.references[1]?.target).toBe("extra-virgin-olive-oil");
  expect(result.references[2]?.target).toBe("dried-porcini-mushrooms");

  // No warnings about unresolved references
  expect(byCode(result.diagnostics, "W0302").length).toBe(0);
});

test("normalizes reference targets in display->id syntax", () => {
  const input = [
    "# Recipe",
    "## Ingredients",
    "- all-purpose flour - 200 g",
    "## Steps",
    "1. Mix [[flour -> all purpose flour]].",
  ].join("\n");

  const result = parseDocument(input);
  const ref = result.references[0];
  expect(ref).toBeDefined();
  if (!ref) {
    throw new Error("Expected reference to be collected");
  }
  expect(ref.display).toBe("flour");
  expect(ref.target).toBe("all-purpose-flour");
  expect(byCode(result.diagnostics, "W0302").length).toBe(0);
});

test("missing reference target emits W0302", () => {
  const input = [
    "# Pasta",
    "## Ingredients",
    "- noodles",
    "## Steps",
    "1. Plate [[sauce]].",
  ].join("\n");

  const result = parseDocument(input);
  expect(byCode(result.diagnostics, "W0302").length).toBe(1);
});

test("malformed reference emits W0303", () => {
  const input = [
    "# Cake",
    "## Ingredients",
    "- sugar",
    "## Steps",
    "1. Mix [[ -> sugar]].",
  ].join("\n");

  const result = parseDocument(input);
  expect(byCode(result.diagnostics, "W0303").length).toBe(1);
});

test("non-numbered steps emit W0401", () => {
  const input = [
    "# Smoothie",
    "## Ingredients",
    "- fruit",
    "## Steps",
    "Blend everything.",
  ].join("\n");

  const result = parseDocument(input);
  expect(byCode(result.diagnostics, "W0401").length).toBe(1);
});

test("numbered steps with indented continuation lines pass", () => {
  const input = [
    "# Granola",
    "## Ingredients",
    "- oats",
    "## Steps",
    "1. Combine dry ingredients in a bowl,",
    "   then stir gently to mix.",
    "2. Bake @300F for @40m.",
  ].join("\n");

  const result = parseDocument(input);
  expect(byCode(result.diagnostics, "W0401").length).toBe(0);
});

test("step continuation lines are unwrapped and joined", () => {
  const input = [
    "# Recipe",
    "## Ingredients",
    "- salt",
    "## Steps",
    "1. First step with continuation",
    "   on the next line.",
    "2. Second step.",
  ].join("\n");

  const result = parseDocument(input);
  const recipe = result.recipes[0];
  const stepsSection = recipe?.sections.find((s) => s.kind === "steps");

  expect(stepsSection).toBeDefined();
  if (stepsSection?.kind === "steps") {
    // Should have 2 lines (2 steps), not 3 (the continuation should be joined)
    expect(stepsSection.lines.length).toBe(2);
    // First step should contain the joined text
    expect(stepsSection.lines[0]?.text).toContain("continuation on the next line");
  }
});

test("invalid timer token emits W0402", () => {
  const input = [
    "# Roast",
    "## Ingredients",
    "- chicken",
    "## Steps",
    "1. Rest @10mm before slicing.",
  ].join("\n");

  const result = parseDocument(input);
  expect(byCode(result.diagnostics, "W0402").length).toBe(1);
});

test("valid timer forms are accepted", () => {
  const input = [
    "# Roast",
    "## Ingredients",
    "- chicken",
    "## Steps",
    "1. Rest @10min before slicing.",
    "2. Cook @1h15min until tender.",
  ].join("\n");

  const result = parseDocument(input);
  expect(byCode(result.diagnostics, "W0402").length).toBe(0);
});

test("step tokens capture timers and temperatures", () => {
  const input = [
    "# Roast",
    "## Ingredients",
    "- chicken",
    "## Steps",
    "1. Preheat to @375F.",
    "2. Cook for @1h10m–@1h20m until done.",
  ].join("\n");

  const result = parseDocument(input);
  expect(result.stepTokens.length).toBe(3);

  const temp = result.stepTokens.find((token) => token.kind === "temperature");
  expect(temp).toBeTruthy();
  expect(temp).toEqual(
    expect.objectContaining({
      value: 375,
      scale: "F",
      line: 5,
      recipeId: "roast",
      recipeTitle: "Roast",
    }),
  );

  const timers = result.stepTokens.filter((token) => token.kind === "timer");
  expect(timers.length).toBe(2);
  expect(timers[0]).toEqual(
    expect.objectContaining({
      start: expect.objectContaining({ hours: 1, minutes: 10 }),
      line: 6,
    }),
  );
  expect(timers[1]).toEqual(
    expect.objectContaining({
      start: expect.objectContaining({ hours: 1, minutes: 20 }),
      line: 6,
    }),
  );
});

test("same ingredient name in different recipes does not conflict", () => {
  const input = [
    "# Collection",
    "",
    "# Recipe A",
    "## Ingredients",
    "- salt - 1 tsp",
    "- cornstarch - 1 tbsp",
    "## Steps",
    "1. Add [[salt]] and [[cornstarch]].",
    "",
    "# Recipe B",
    "## Ingredients",
    "- salt - 2 tsp",
    "- cornstarch - 2 tbsp",
    "## Steps",
    "1. Mix [[salt]] with [[cornstarch]].",
  ].join("\n");

  const result = parseDocument(input);

  // No duplicate ID errors
  const duplicateErrors = byCode(result.diagnostics, "E0301");
  expect(duplicateErrors).toHaveLength(0);

  // All references should resolve (no W0302 warnings)
  const unresolvedWarnings = byCode(result.diagnostics, "W0302");
  expect(unresolvedWarnings).toHaveLength(0);

  // Both recipes parsed
  expect(result.recipes).toHaveLength(2);
});

test("references resolve to ingredients in the same recipe", () => {
  const input = [
    "# Main",
    "",
    "# Marinade",
    "## Ingredients",
    "- soy sauce - 1 tbsp",
    "## Steps",
    "1. Use [[soy-sauce]].",
    "",
    "# Sauce",
    "## Ingredients",
    "- soy sauce - 2 tbsp",
    "## Steps",
    "1. Add [[soy-sauce]].",
  ].join("\n");

  const result = parseDocument(input);

  // W0502 orphan warning for Sauce (index 1, not referenced)
  // Marinade is index 0 (Main is the document title), so no orphan warning
  expect(byCode(result.diagnostics, "W0502")).toHaveLength(1);
  // No other diagnostics
  expect(result.diagnostics.filter((d) => d.code !== "W0502")).toHaveLength(0);

  // References should have recipeId set
  expect(result.references).toHaveLength(2);
  expect(result.references[0]?.recipeId).toBe("marinade");
  expect(result.references[0]?.resolvedTarget).toBe("marinade/soy-sauce");
  expect(result.references[1]?.recipeId).toBe("sauce");
  expect(result.references[1]?.resolvedTarget).toBe("sauce/soy-sauce");
});

test("recipe titles do not create referenceable IDs", () => {
  const input = [
    "# Main",
    "",
    "# Main Dish",
    "## Ingredients",
    "- chicken - 1 lb",
    "- sauce - 1/2 cup",
    "## Steps",
    "1. Prepare the [[sauce]].",
    "2. Cook [[chicken]] with sauce.",
    "",
    "# Sauce",
    "## Ingredients",
    "- soy sauce - 2 tbsp",
    "## Steps",
    "1. Mix [[soy-sauce]].",
  ].join("\n");

  const result = parseDocument(input);

  // No errors or warnings - the [[sauce]] reference resolves to the ingredient, not the recipe
  expect(result.diagnostics).toHaveLength(0);

  // Find the [[sauce]] reference - it resolves to the ingredient in Main Dish
  const sauceRef = result.references.find(
    (r) => r.target === "sauce" && r.recipeId === "main-dish",
  );
  expect(sauceRef).toBeDefined();
  expect(sauceRef?.resolvedTarget).toBe("main-dish/sauce"); // Scoped to ingredient
});

test("unresolved reference in recipe with same-named ingredient elsewhere warns", () => {
  const input = [
    "# Main",
    "",
    "# Recipe A",
    "## Ingredients",
    "- salt - 1 tsp",
    "## Steps",
    "1. Add [[pepper]].",
    "",
    "# Recipe B",
    "## Ingredients",
    "- pepper - 1 tsp",
    "## Steps",
    "1. Use [[pepper]].",
  ].join("\n");

  const result = parseDocument(input);

  // Recipe A's [[pepper]] should warn (pepper is in Recipe B, not A)
  const unresolvedWarnings = byCode(result.diagnostics, "W0302");
  expect(unresolvedWarnings).toHaveLength(1);
  expect(unresolvedWarnings[0]?.message).toContain("pepper");
});

test("captures intro text between recipe title and first section", () => {
  const input = [
    "# Chocolate Cake",
    "",
    "A rich and decadent cake perfect for celebrations.",
    "This recipe has been passed down for generations.",
    "",
    "## Ingredients",
    "- flour - 2 cups",
    "## Steps",
    "1. Mix.",
  ].join("\n");

  const result = parseDocument(input);
  const recipe = result.recipes[0];

  expect(recipe).toBeDefined();
  expect(recipe?.intro).toBeDefined();
  expect(recipe?.intro).toBe(
    "A rich and decadent cake perfect for celebrations.\nThis recipe has been passed down for generations.",
  );
});

test("recipe without intro has undefined intro field", () => {
  const input = [
    "# Simple Recipe",
    "## Ingredients",
    "- salt",
    "## Steps",
    "1. Cook.",
  ].join("\n");

  const result = parseDocument(input);
  expect(result.recipes[0]?.intro).toBeUndefined();
});

test("intro with only whitespace is not captured", () => {
  const input = [
    "# Recipe",
    "",
    "   ",
    "",
    "## Ingredients",
    "- salt",
    "## Steps",
    "1. Mix.",
  ].join("\n");

  const result = parseDocument(input);
  expect(result.recipes[0]?.intro).toBeUndefined();
});

test("notes continuation lines are unwrapped and joined for bullets", () => {
  const input = [
    "# Recipe",
    "## Ingredients",
    "- salt",
    "## Steps",
    "1. Cook.",
    "## Notes",
    "- **Storage:** Store leftover pizza in the refrigerator for",
    "  up to 5 days. Reheat until warm.",
    "- **Tip:** Pizza sauce is thicker than tomato sauce, and it",
    "  helps prevent the crust from becoming soggy.",
  ].join("\n");

  const result = parseDocument(input);
  const recipe = result.recipes[0];
  const notesSection = recipe?.sections.find((s) => s.kind === "notes");

  expect(notesSection).toBeDefined();
  if (notesSection?.kind === "notes") {
    const nonEmpty = notesSection.lines.filter((l) => l.text.trim() !== "");
    // Should have 2 lines (2 bullets), not 4
    expect(nonEmpty).toHaveLength(2);
    expect(nonEmpty[0]?.text).toContain("up to 5 days");
    expect(nonEmpty[1]?.text).toContain("helps prevent");
  }
});

test("notes paragraph continuation lines are joined", () => {
  const input = [
    "# Recipe",
    "## Ingredients",
    "- salt",
    "## Steps",
    "1. Cook.",
    "## Notes",
    "",
    "This is a long paragraph that wraps",
    "across multiple lines in the source.",
    "",
    "This is a second paragraph.",
  ].join("\n");

  const result = parseDocument(input);
  const recipe = result.recipes[0];
  const notesSection = recipe?.sections.find((s) => s.kind === "notes");

  expect(notesSection).toBeDefined();
  if (notesSection?.kind === "notes") {
    const nonEmpty = notesSection.lines.filter((l) => l.text.trim() !== "");
    expect(nonEmpty).toHaveLength(2);
    expect(nonEmpty[0]?.text).toBe(
      "This is a long paragraph that wraps across multiple lines in the source.",
    );
    expect(nonEmpty[1]?.text).toBe("This is a second paragraph.");
  }
});

test("notes double line break creates separate paragraphs", () => {
  const input = [
    "# Recipe",
    "## Ingredients",
    "- salt",
    "## Steps",
    "1. Cook.",
    "## Notes",
    "",
    "First paragraph.",
    "",
    "Second paragraph.",
  ].join("\n");

  const result = parseDocument(input);
  const recipe = result.recipes[0];
  const notesSection = recipe?.sections.find((s) => s.kind === "notes");

  expect(notesSection).toBeDefined();
  if (notesSection?.kind === "notes") {
    const nonEmpty = notesSection.lines.filter((l) => l.text.trim() !== "");
    expect(nonEmpty).toHaveLength(2);
    expect(nonEmpty[0]?.text).toBe("First paragraph.");
    expect(nonEmpty[1]?.text).toBe("Second paragraph.");
  }
});

// ── Compound recipe linking ──────────────────────────────────────────

test("ingredient matching another recipe title gets linkedRecipeId", () => {
  const input = [
    "# Detroit-Style Pizza",
    "",
    "# Dough",
    "## Ingredients",
    "- flour - 500 g",
    "## Steps",
    "1. Mix.",
    "",
    "# Sauce",
    "## Ingredients",
    "- tomatoes - 1 can",
    "## Steps",
    "1. Blend.",
    "",
    "# Assembly",
    "## Ingredients",
    "- Dough - 1 recipe",
    "- Sauce - 1 cup",
    "- cheese - 200 g",
    "## Steps",
    "1. Assemble.",
  ].join("\n");

  const result = parseDocument(input);
  const assembly = result.recipes.find((r) => r.id === "assembly");
  const ingSection = assembly?.sections.find((s) => s.kind === "ingredients");
  if (ingSection?.kind !== "ingredients") throw new Error("missing ingredients");

  const doughIng = ingSection.ingredients.find((i) => i.id === "dough");
  const sauceIng = ingSection.ingredients.find((i) => i.id === "sauce");
  const cheeseIng = ingSection.ingredients.find((i) => i.id === "cheese");

  expect(doughIng?.linkedRecipeId).toBe("dough");
  expect(sauceIng?.linkedRecipeId).toBe("sauce");
  expect(cheeseIng?.linkedRecipeId).toBeUndefined();

  // recipeLinks should have both entries
  expect(result.recipeLinks).toHaveLength(2);
  expect(result.recipeLinks).toContainEqual({
    fromRecipeId: "assembly",
    ingredientId: "dough",
    toRecipeId: "dough",
  });
  expect(result.recipeLinks).toContainEqual({
    fromRecipeId: "assembly",
    ingredientId: "sauce",
    toRecipeId: "sauce",
  });
});

test("ingredient matching its own recipe title does not self-link", () => {
  const input = [
    "# Sauce",
    "## Ingredients",
    "- sauce - 1 cup",
    "## Steps",
    "1. Cook.",
  ].join("\n");

  const result = parseDocument(input);
  const ing = result.recipes[0]?.sections.find((s) => s.kind === "ingredients");
  if (ing?.kind !== "ingredients") throw new Error("missing ingredients");

  expect(ing.ingredients[0]?.linkedRecipeId).toBeUndefined();
  expect(result.recipeLinks).toHaveLength(0);
});

test("recipe linking is case-insensitive via slug", () => {
  const input = [
    "# Detroit-Style Dough",
    "## Ingredients",
    "- flour - 500 g",
    "## Steps",
    "1. Mix.",
    "",
    "# Pizza",
    "## Ingredients",
    "- detroit-style dough - 1 recipe",
    "## Steps",
    "1. Assemble.",
  ].join("\n");

  const result = parseDocument(input);
  const pizza = result.recipes.find((r) => r.id === "pizza");
  const ing = pizza?.sections.find((s) => s.kind === "ingredients");
  if (ing?.kind !== "ingredients") throw new Error("missing ingredients");

  expect(ing.ingredients[0]?.linkedRecipeId).toBe("detroit-style-dough");
});

test("bidirectional recipe linking", () => {
  const input = [
    "# Sauce",
    "## Ingredients",
    "- pasta - 1 recipe",
    "## Steps",
    "1. Cook.",
    "",
    "# Pasta",
    "## Ingredients",
    "- sauce - 1 recipe",
    "## Steps",
    "1. Boil.",
  ].join("\n");

  const result = parseDocument(input);
  expect(result.recipeLinks).toHaveLength(2);
  expect(result.recipeLinks).toContainEqual({
    fromRecipeId: "sauce",
    ingredientId: "pasta",
    toRecipeId: "pasta",
  });
  expect(result.recipeLinks).toContainEqual({
    fromRecipeId: "pasta",
    ingredientId: "sauce",
    toRecipeId: "sauce",
  });
});

test("custom id= override on ingredient prevents auto-linking", () => {
  const input = [
    "# Sauce",
    "## Ingredients",
    "- tomatoes - 1 can",
    "## Steps",
    "1. Blend.",
    "",
    "# Assembly",
    "## Ingredients",
    "- Sauce - 1 cup :: id=red-sauce",
    "## Steps",
    "1. Pour.",
  ].join("\n");

  const result = parseDocument(input);
  const assembly = result.recipes.find((r) => r.id === "assembly");
  const ing = assembly?.sections.find((s) => s.kind === "ingredients");
  if (ing?.kind !== "ingredients") throw new Error("missing ingredients");

  // Custom id "red-sauce" doesn't match recipe id "sauce", so no link
  expect(ing.ingredients[0]?.linkedRecipeId).toBeUndefined();
  expect(result.recipeLinks).toHaveLength(0);
});

// ── W0501 / W0502 linter warnings ───────────────────────────────────

test("W0501: ingredient with unit recipe/batch but no matching recipe warns", () => {
  const input = [
    "# Pizza",
    "## Ingredients",
    "- magic dough - 1 recipe",
    "- secret sauce - 2 batches",
    "## Steps",
    "1. Assemble.",
  ].join("\n");

  const result = parseDocument(input);
  const warnings = byCode(result.diagnostics, "W0501");
  expect(warnings).toHaveLength(2);
  expect(warnings[0]?.message).toContain("magic dough");
  expect(warnings[1]?.message).toContain("secret sauce");
});

test("W0501 negative: ingredient with unit recipe + matching recipe is fine", () => {
  const input = [
    "# Dough",
    "## Ingredients",
    "- flour - 500 g",
    "## Steps",
    "1. Mix.",
    "",
    "# Pizza",
    "## Ingredients",
    "- Dough - 1 recipe",
    "## Steps",
    "1. Assemble.",
  ].join("\n");

  const result = parseDocument(input);
  expect(byCode(result.diagnostics, "W0501")).toHaveLength(0);
});

test("W0502: orphan recipe at index > 0 not referenced by any ingredient warns", () => {
  const input = [
    "# Pizza",
    "## Ingredients",
    "- cheese - 200 g",
    "## Steps",
    "1. Top.",
    "",
    "# Forgotten Sauce",
    "## Ingredients",
    "- tomatoes - 1 can",
    "## Steps",
    "1. Blend.",
  ].join("\n");

  const result = parseDocument(input);
  const warnings = byCode(result.diagnostics, "W0502");
  expect(warnings).toHaveLength(1);
  expect(warnings[0]?.message).toContain("Forgotten Sauce");
});

test("W0502 negative: first recipe never triggers orphan warning", () => {
  const input = [
    "# Solo Recipe",
    "## Ingredients",
    "- salt - 1 tsp",
    "## Steps",
    "1. Season.",
  ].join("\n");

  const result = parseDocument(input);
  expect(byCode(result.diagnostics, "W0502")).toHaveLength(0);
});

test("W0502 negative: referenced recipe does not trigger orphan warning", () => {
  const input = [
    "# Dough",
    "## Ingredients",
    "- flour - 500 g",
    "## Steps",
    "1. Mix.",
    "",
    "# Pizza",
    "## Ingredients",
    "- Dough - 1 recipe",
    "## Steps",
    "1. Assemble.",
  ].join("\n");

  const result = parseDocument(input);
  expect(byCode(result.diagnostics, "W0502")).toHaveLength(0);
});
