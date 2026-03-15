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
  return { section: recipe.ingredients, diagnostics: result.diagnostics };
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
  expect(ingredient.quantity?.kind).toBe("single");
  if (ingredient.quantity?.kind === "single") {
    expect(ingredient.quantity.value).toBe(1);
    expect(ingredient.quantity.unit).toBe("pinch");
  }
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

test("also quantity with unit-only value parses correctly", () => {
  const input = withRecipe(["- sugar - 1 cup :: also=maybe"]);
  const { diagnostics, section } = getIngredientsSection(input);

  // "maybe" is technically valid as a unit-only quantity (1 maybe)
  // even though it's semantically meaningless
  expect(diagnostics.map((diag) => diag.code)).toEqual([]);
  const ingredient = section.ingredients[0];
  expect(ingredient).toBeDefined();
  if (!ingredient) return;

  const alsoAttr = ingredient.attributes.find((attr) => attr.key === "also");
  expect(alsoAttr?.value).toBe("maybe");
  expect(alsoAttr?.quantity?.kind).toBe("single");
  if (alsoAttr?.quantity?.kind === "single") {
    expect(alsoAttr.quantity.value).toBe(1);
    expect(alsoAttr.quantity.unit).toBe("maybe");
  }
});

// ── Compound quantities ─────────────────────────────────────────────

test("parses compound quantity on ingredient line", () => {
  const { section, diagnostics } = getIngredientsSection(
    withRecipe(["- water - 1 cup + 3 tbsp"]),
  );

  expect(diagnostics.filter((d) => d.severity === "error")).toEqual([]);
  const ingredient = section.ingredients[0];
  expect(ingredient?.quantity?.kind).toBe("compound");
  if (ingredient?.quantity?.kind === "compound") {
    expect(ingredient.quantity.parts[0].value).toBe(1);
    expect(ingredient.quantity.parts[0].unit).toBe("cup");
    expect(ingredient.quantity.parts[1].value).toBe(3);
    expect(ingredient.quantity.parts[1].unit).toBe("tbsp");
  }
});

test("compound with incompatible base units emits E0207", () => {
  const { diagnostics } = getIngredientsSection(
    withRecipe(["- mystery - 1 cup + 3 g"]),
  );

  expect(diagnostics.some((d) => d.code === "E0207")).toBe(true);
});

test("compound with same base unit does not emit E0207", () => {
  const { diagnostics } = getIngredientsSection(
    withRecipe(["- water - 1 cup + 3 tbsp"]),
  );

  expect(diagnostics.some((d) => d.code === "E0207")).toBe(false);
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

test("line-wrapped tail attributes are merged and parsed correctly", () => {
  const { section, diagnostics } = getIngredientsSection(
    withRecipe([
      "- sweet Italian sausage - 6 oz, removed from casing :: id=sausage",
      "  also=170g also=\"2 links\"",
    ]),
  );

  expect(diagnostics.map((diag) => diag.code)).toEqual([]);
  const ingredient = section.ingredients[0];
  expect(ingredient).toBeDefined();
  if (!ingredient) return;

  expect(ingredient.name).toBe("sweet Italian sausage");
  expect(ingredient.quantityText).toBe("6 oz");
  expect(ingredient.modifiers).toBe("removed from casing");

  // Check id attribute
  const idAttr = ingredient.attributes.find((attr) => attr.key === "id");
  expect(idAttr?.value).toBe("sausage");

  // Check also attributes (should have two)
  const alsoAttrs = ingredient.attributes.filter((attr) => attr.key === "also");
  expect(alsoAttrs).toHaveLength(2);
  expect(alsoAttrs[0]?.value).toBe("170g");
  expect(alsoAttrs[1]?.value).toBe("2 links");
});

test("multiple continuation lines are supported", () => {
  const { section, diagnostics } = getIngredientsSection(
    withRecipe([
      "- flour - 2 cups ::",
      "  id=flour",
      "  also=240g",
      "  noscale",
    ]),
  );

  expect(diagnostics.filter((diag) => diag.severity === "error")).toEqual([]);
  const ingredient = section.ingredients[0];
  expect(ingredient).toBeDefined();
  if (!ingredient) return;

  expect(ingredient.name).toBe("flour");
  expect(ingredient.attributes.some((attr) => attr.key === "id" && attr.value === "flour")).toBe(true);
  expect(ingredient.attributes.some((attr) => attr.key === "also" && attr.value === "240g")).toBe(true);
  expect(ingredient.attributes.some((attr) => attr.key === "noscale")).toBe(true);
});

test("continuation lines do not affect subsequent ingredients", () => {
  const { section, diagnostics } = getIngredientsSection(
    withRecipe([
      "- sugar - 1 cup :: id=white-sugar",
      "  also=200g",
      "- salt",
    ]),
  );

  expect(diagnostics.map((diag) => diag.code)).toEqual([]);
  expect(section.ingredients).toHaveLength(2);

  const [sugar, salt] = section.ingredients;
  expect(sugar?.name).toBe("sugar");
  expect(sugar?.attributes.some((attr) => attr.key === "also" && attr.value === "200g")).toBe(true);
  expect(salt?.name).toBe("salt");
  expect(salt?.attributes).toEqual([]);
});

test("parses unit-only quantities with implied amount of 1", () => {
  const { section, diagnostics } = getIngredientsSection(
    withRecipe([
      "- red pepper flakes – pinch, optional",
      "- salt - dash",
    ]),
  );

  expect(diagnostics.map((diag) => diag.code)).toEqual([]);
  expect(section.ingredients).toHaveLength(2);

  const [pepperFlakes, salt] = section.ingredients;

  expect(pepperFlakes?.name).toBe("red pepper flakes");
  expect(pepperFlakes?.quantity?.kind).toBe("single");
  if (pepperFlakes?.quantity?.kind === "single") {
    expect(pepperFlakes.quantity.value).toBe(1);
    expect(pepperFlakes.quantity.unit).toBe("pinch");
  }
  expect(pepperFlakes?.modifiers).toBe("optional");

  expect(salt?.name).toBe("salt");
  expect(salt?.quantity?.kind).toBe("single");
  if (salt?.quantity?.kind === "single") {
    expect(salt.quantity.value).toBe(1);
    expect(salt.quantity.unit).toBe("dash");
  }
});

// ── also= duplicate system validation ────────────────────────────────

test("also= with duplicate metric units emits E0208", () => {
  const input = withRecipe(["- flour - 2 cups :: also=240g also=480g"]);
  const { diagnostics } = getIngredientsSection(input);
  expect(diagnostics.some((d) => d.code === "E0208")).toBe(true);
});

test("also= with different systems does not emit E0208", () => {
  const input = withRecipe(['- flour - 2 cups :: also=240g also="1 cup"']);
  const { diagnostics } = getIngredientsSection(input);
  expect(diagnostics.some((d) => d.code === "E0208")).toBe(false);
});
