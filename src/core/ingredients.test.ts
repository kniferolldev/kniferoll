import { expect, test } from "bun:test";
import { parseDocument } from "./parser";
import type { IngredientsSection } from "./types";

const withRecipe = (lines: string[]) =>
  ["# Test Recipe", "## Ingredients", ...lines, "## Steps", "1. Do thing"].join("\n");

const getIngredientsSection = (input: string): {
  section: IngredientsSection;
  diagnostics: ReturnType<typeof parseDocument>["diagnostics"];
} => {
  const result = parseDocument(input);
  const recipe = result.recipes[0];
  if (!recipe) {
    throw new Error("Expected recipe to be parsed");
  }
  const section = recipe.sections.find(
    (candidate): candidate is IngredientsSection => candidate.kind === "ingredients",
  );
  if (!section) {
    throw new Error("Expected ingredients section");
  }
  return { section, diagnostics: result.diagnostics };
};

test("parses ingredient with quantity, modifiers, and attributes", () => {
  const { section, diagnostics } = getIngredientsSection(
    withRecipe([
      '- sugar - 1 cup, finely ground :: id=super-sugar also="200 g"',
    ]),
  );

  expect(diagnostics.map((diag) => diag.code)).toEqual([]);

  const [ingredient] = section.ingredients;
  expect(ingredient).toBeDefined();
  if (!ingredient) return;
  expect(ingredient.name).toBe("sugar");
  expect(ingredient.quantityText).toBe("1 cup");
  expect(ingredient.quantity?.kind).toBe("single");
  if (!ingredient.quantity || ingredient.quantity.kind !== "single") {
    throw new Error("expected single quantity");
  }
  expect(ingredient.quantity.value).toBeCloseTo(1);
  expect(ingredient.quantity.unit).toBe("cup");
  expect(ingredient.modifiers).toBe("finely ground");
  const idAttr = ingredient.attributes.find((attr) => attr.key === "id");
  expect(idAttr).toEqual({ key: "id", value: "super-sugar" });

  const alsoAttr = ingredient.attributes.find((attr) => attr.key === "also");
  expect(alsoAttr?.value).toBe("200 g");
  expect(alsoAttr?.quantity?.kind).toBe("single");
  if (!alsoAttr?.quantity || alsoAttr.quantity.kind !== "single") {
    throw new Error("expected single quantity for also");
  }
  expect(alsoAttr.quantity.value).toBeCloseTo(200);
  expect(alsoAttr.quantity.unit).toBe("g");
});

test("parses en dash delimiter between name and quantity", () => {
  const { section, diagnostics } = getIngredientsSection(
    withRecipe([
      "- red pepper flakes – pinch, optional",
    ]),
  );

  const ingredient = section.ingredients[0];
  expect(ingredient).toBeDefined();
  if (!ingredient) return;
  expect(ingredient.name).toBe("red pepper flakes");
  expect(ingredient.quantityText).toBe("pinch");
  expect(ingredient.quantity).toBeNull();
  expect(ingredient.modifiers).toBe("optional");
});

test("flags invalid ingredient syntax when line lacks bullet", () => {
  const input = withRecipe(["sugar - 1 cup"]);
  const { diagnostics, section } = getIngredientsSection(input);

  expect(section.ingredients).toHaveLength(0);
  expect(diagnostics.some((diag) => diag.code === "E0201")).toBe(true);
});

test("requires spaces around tail delimiter", () => {
  const input = withRecipe(["- milk - 1 cup:: also=240ml"]);
  const { diagnostics } = getIngredientsSection(input);

  expect(diagnostics.some((diag) => diag.code === "E0202")).toBe(true);
});

test("literal :: inside ingredient name is allowed", () => {
  const { section, diagnostics } = getIngredientsSection(
    withRecipe(["- salt::smoked"]),
  );

  expect(diagnostics).toHaveLength(0);
  expect(section.ingredients[0]?.name).toBe("salt::smoked");
});

test("unknown attributes error with E0203", () => {
  const input = withRecipe(["- salt :: foo=bar"]);
  const { diagnostics } = getIngredientsSection(input);

  const errors = diagnostics.filter((diag) => diag.code === "E0203");
  expect(errors).toHaveLength(1);
});

test("redundant id emits W0204", () => {
  const input = withRecipe(["- sugar - 1 cup :: id=sugar"]);
  const { diagnostics } = getIngredientsSection(input);

  expect(diagnostics.some((diag) => diag.code === "W0204")).toBe(true);
});

test("noscale without quantity triggers W0205", () => {
  const input = withRecipe(["- salt :: noscale"]);
  const { diagnostics, section } = getIngredientsSection(input);

  expect(diagnostics.some((diag) => diag.code === "W0205")).toBe(true);
  expect(section.ingredients[0]?.attributes).toEqual([
    { key: "noscale", value: null },
  ]);
});

test("invalid also quantity raises E0206", () => {
  const input = withRecipe(["- sugar - 1 cup :: also=maybe"]);
  const { diagnostics } = getIngredientsSection(input);

  expect(diagnostics.some((diag) => diag.code === "E0206")).toBe(true);
});

test("ignores blank ingredient lines", () => {
  const input = withRecipe(["", "- salt"]);
  const { section, diagnostics } = getIngredientsSection(input);

  expect(diagnostics.map((diag) => diag.code)).not.toContain("E0201");
  expect(section.ingredients).toHaveLength(1);
  expect(section.ingredients[0]?.name).toBe("salt");
});

test("errors when ingredient name missing", () => {
  const input = withRecipe(["-  , chopped"]);
  const { diagnostics, section } = getIngredientsSection(input);

  expect(section.ingredients).toHaveLength(0);
  expect(diagnostics.some((diag) => diag.message.includes("name is required"))).toBe(true);
});

test("errors when quantity is empty after dash", () => {
  const input = withRecipe(["- sugar -  , finely ground"]);
  const { diagnostics, section } = getIngredientsSection(input);

  expect(section.ingredients).toHaveLength(0);
  expect(diagnostics.some((diag) => diag.message.includes("quantity must not be empty"))).toBe(true);
});

test("attribute without value is an error", () => {
  const input = withRecipe(['- sugar :: id=']);
  const { diagnostics, section } = getIngredientsSection(input);

  expect(section.ingredients).toHaveLength(0);
  expect(diagnostics.some((diag) => diag.message.includes("missing a value"))).toBe(true);
});

test("attribute with unterminated quotes is an error", () => {
  const input = withRecipe(['- sugar :: id="sweet']);
  const { diagnostics, section } = getIngredientsSection(input);

  expect(section.ingredients).toHaveLength(0);
  expect(diagnostics.some((diag) => diag.message.includes("unterminated quotes"))).toBe(true);
});

test("noscale attribute with value is coerced to null", () => {
  const input = withRecipe(["- salt - 1 tsp :: noscale=true"]);
  const { diagnostics, section } = getIngredientsSection(input);

  expect(diagnostics).toHaveLength(0);
  const attr = section.ingredients[0]?.attributes.find(({ key }) => key === "noscale");
  expect(attr).toEqual({ key: "noscale", value: null });
});

test("unknown attribute without equals errors", () => {
  const input = withRecipe(["- sugar :: crunchy"]);
  const { diagnostics } = getIngredientsSection(input);

  expect(diagnostics.some((diag) => diag.code === "E0203")).toBe(true);
});

test("attribute delimiter without trailing value reports error", () => {
  const input = withRecipe(["- sugar ::   "]);
  const { diagnostics } = getIngredientsSection(input);

  expect(diagnostics.some((diag) => diag.code === "E0202")).toBe(true);
});
