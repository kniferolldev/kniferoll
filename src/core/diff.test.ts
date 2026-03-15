import { describe, expect, test } from "bun:test";
import { diffRecipes, wordDiff, type DiffAnnotation } from "./diff";
import { parseDocument } from "./parser";

/** Parse a recipe markdown string and return the first recipe. */
function parse(md: string) {
  const result = parseDocument(md);
  if (result.recipes.length === 0) {
    throw new Error("No recipes found in markdown");
  }
  return result.recipes[0]!;
}

/** Helper: check annotation ignoring tokens (for status-only assertions). */
function hasAnnotation(
  annotations: DiffAnnotation[],
  section: DiffAnnotation["section"],
  key: string,
  status: DiffAnnotation["status"],
): boolean {
  return annotations.some(
    (a) => a.section === section && a.key === key && a.status === status,
  );
}

describe("wordDiff", () => {
  test("identical strings produce single equal token", () => {
    expect(wordDiff("hello world", "hello world")).toEqual([
      { kind: "equal", text: "hello world" },
    ]);
  });

  test("completely different strings", () => {
    expect(wordDiff("hello", "goodbye")).toEqual([
      { kind: "delete", text: "hello" },
      { kind: "insert", text: "goodbye" },
    ]);
  });

  test("added word at end", () => {
    expect(wordDiff("Mix the flour.", "Mix the flour and sugar.")).toEqual([
      { kind: "equal", text: "Mix the flour" },
      { kind: "insert", text: " and sugar" },
      { kind: "equal", text: "." },
    ]);
  });

  test("added reference markup", () => {
    const tokens = wordDiff("Mix the flour.", "Mix the [[flour]].");
    expect(tokens).toEqual([
      { kind: "equal", text: "Mix the " },
      { kind: "insert", text: "[[" },
      { kind: "equal", text: "flour" },
      { kind: "insert", text: "]]" },
      { kind: "equal", text: "." },
    ]);
  });

  test("added reference markup with comma", () => {
    const tokens = wordDiff("add broccolini, then", "add [[broccolini]], then");
    expect(tokens).toEqual([
      { kind: "equal", text: "add " },
      { kind: "insert", text: "[[" },
      { kind: "equal", text: "broccolini" },
      { kind: "insert", text: "]]" },
      { kind: "equal", text: ", then" },
    ]);
  });

  test("added scalable braces", () => {
    const tokens = wordDiff("Bake at 350F.", "Bake at {350F}.");
    expect(tokens).toEqual([
      { kind: "equal", text: "Bake at " },
      { kind: "insert", text: "{" },
      { kind: "equal", text: "350F" },
      { kind: "insert", text: "}" },
      { kind: "equal", text: "." },
    ]);
  });

  test("empty before", () => {
    expect(wordDiff("", "hello world")).toEqual([
      { kind: "insert", text: "hello world" },
    ]);
  });

  test("empty after", () => {
    expect(wordDiff("hello world", "")).toEqual([
      { kind: "delete", text: "hello world" },
    ]);
  });

  test("word replaced in middle", () => {
    const tokens = wordDiff("Cream the butter and sugar.", "Cream the [[butter]] and sugar.");
    expect(tokens).toEqual([
      { kind: "equal", text: "Cream the " },
      { kind: "insert", text: "[[" },
      { kind: "equal", text: "butter" },
      { kind: "insert", text: "]]" },
      { kind: "equal", text: " and sugar." },
    ]);
  });

  test("ingredient with added attribute", () => {
    const tokens = wordDiff("2 cups flour", "2 cups flour :: also=240g");
    expect(tokens).toEqual([
      { kind: "equal", text: "2 cups flour" },
      { kind: "insert", text: " :: also=240g" },
    ]);
  });
});

describe("diffRecipes", () => {
  test("identical recipes produce no annotations", () => {
    const md = `# Pancakes

A simple recipe.

## Ingredients

- flour - 2 cups
- sugar - 1 tbsp

## Steps

1. Mix dry ingredients.
2. Add wet ingredients.

## Notes

Serve warm.`;

    const before = parse(md);
    const after = parse(md);
    expect(diffRecipes(before, after)).toEqual([]);
  });

  describe("intro", () => {
    test("added intro paragraph", () => {
      const before = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix.`);

      const after = parse(`# Pancakes

A delicious breakfast.

## Ingredients

- flour - 2 cups

## Steps

1. Mix.`);

      const annotations = diffRecipes(before, after);
      expect(hasAnnotation(annotations, "intro", "0", "added")).toBe(true);
    });

    test("changed intro paragraph has tokens", () => {
      const before = parse(`# Pancakes

A simple recipe.

## Ingredients

- flour - 2 cups

## Steps

1. Mix.`);

      const after = parse(`# Pancakes

A delicious recipe.

## Ingredients

- flour - 2 cups

## Steps

1. Mix.`);

      const annotations = diffRecipes(before, after);
      const intro = annotations.find((a) => a.section === "intro" && a.key === "0");
      expect(intro).toBeDefined();
      expect(intro!.status).toBe("changed");
      expect(intro!.tokens).toBeDefined();
      // Should contain delete "simple" and insert "delicious"
      expect(intro!.tokens).toContainEqual({ kind: "delete", text: "simple" });
      expect(intro!.tokens).toContainEqual({ kind: "insert", text: "delicious" });
    });

    test("removed intro paragraph", () => {
      const before = parse(`# Pancakes

A simple recipe.

## Ingredients

- flour - 2 cups

## Steps

1. Mix.`);

      const after = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix.`);

      const annotations = diffRecipes(before, after);
      expect(hasAnnotation(annotations, "intro", "0", "removed")).toBe(true);
    });
  });

  describe("ingredients", () => {
    test("added ingredient", () => {
      const before = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix.`);

      const after = parse(`# Pancakes

## Ingredients

- flour - 2 cups
- sugar - 1 tbsp

## Steps

1. Mix.`);

      const annotations = diffRecipes(before, after);
      expect(hasAnnotation(annotations, "ingredients", "sugar", "added")).toBe(true);
    });

    test("removed ingredient", () => {
      const before = parse(`# Pancakes

## Ingredients

- flour - 2 cups
- sugar - 1 tbsp

## Steps

1. Mix.`);

      const after = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix.`);

      const annotations = diffRecipes(before, after);
      expect(hasAnnotation(annotations, "ingredients", "sugar", "removed")).toBe(true);
    });

    test("changed ingredient quantity has tokens", () => {
      const before = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix.`);

      const after = parse(`# Pancakes

## Ingredients

- flour - 3 cups

## Steps

1. Mix.`);

      const annotations = diffRecipes(before, after);
      const flour = annotations.find((a) => a.key === "flour");
      expect(flour).toBeDefined();
      expect(flour!.status).toBe("changed");
      expect(flour!.tokens).toBeDefined();
      expect(flour!.tokens).toContainEqual({ kind: "delete", text: "2" });
      expect(flour!.tokens).toContainEqual({ kind: "insert", text: "3" });
    });

    test("added attribute uses attributeDiffs not tokens", () => {
      const before = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix.`);

      const after = parse(`# Pancakes

## Ingredients

- flour - 2 cups :: also=240g

## Steps

1. Mix.`);

      const annotations = diffRecipes(before, after);
      const flour = annotations.find((a) => a.key === "flour");
      expect(flour).toBeDefined();
      expect(flour!.status).toBe("changed");
      // Content unchanged → no tokens
      expect(flour!.tokens).toBeUndefined();
      // Attribute change captured in attributeDiffs
      expect(flour!.attributeDiffs).toContainEqual({ key: "also", status: "added" });
    });

    test("unchanged ingredient not annotated", () => {
      const before = parse(`# Pancakes

## Ingredients

- flour - 2 cups
- sugar - 1 tbsp

## Steps

1. Mix.`);

      const after = parse(`# Pancakes

## Ingredients

- flour - 2 cups
- sugar - 1 tbsp
- salt - 1 tsp

## Steps

1. Mix.`);

      const annotations = diffRecipes(before, after);
      expect(annotations.filter((a) => a.key === "flour")).toEqual([]);
      expect(annotations.filter((a) => a.key === "sugar")).toEqual([]);
      expect(hasAnnotation(annotations, "ingredients", "salt", "added")).toBe(true);
    });

    test("added attribute produces attributeDiffs", () => {
      const before = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix.`);

      const after = parse(`# Pancakes

## Ingredients

- flour - 2 cups :: also=240g

## Steps

1. Mix.`);

      const annotations = diffRecipes(before, after);
      const flour = annotations.find((a) => a.key === "flour");
      expect(flour).toBeDefined();
      expect(flour!.attributeDiffs).toBeDefined();
      expect(flour!.attributeDiffs).toContainEqual({ key: "also", status: "added" });
    });

    test("removed attribute produces attributeDiffs", () => {
      const before = parse(`# Pancakes

## Ingredients

- flour - 2 cups :: noscale

## Steps

1. Mix.`);

      const after = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix.`);

      const annotations = diffRecipes(before, after);
      const flour = annotations.find((a) => a.key === "flour");
      expect(flour).toBeDefined();
      expect(flour!.attributeDiffs).toContainEqual({ key: "noscale", status: "removed" });
    });

    test("multiple attribute changes", () => {
      const before = parse(`# Pancakes

## Ingredients

- flour - 2 cups :: noscale

## Steps

1. Mix.`);

      const after = parse(`# Pancakes

## Ingredients

- flour - 2 cups :: also=240g

## Steps

1. Mix.`);

      const annotations = diffRecipes(before, after);
      const flour = annotations.find((a) => a.key === "flour");
      expect(flour).toBeDefined();
      expect(flour!.attributeDiffs).toContainEqual({ key: "noscale", status: "removed" });
      expect(flour!.attributeDiffs).toContainEqual({ key: "also", status: "added" });
    });

    test("no attributeDiffs when only quantity changes", () => {
      const before = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix.`);

      const after = parse(`# Pancakes

## Ingredients

- flour - 3 cups

## Steps

1. Mix.`);

      const annotations = diffRecipes(before, after);
      const flour = annotations.find((a) => a.key === "flour");
      expect(flour).toBeDefined();
      expect(flour!.attributeDiffs).toBeUndefined();
    });

    test("no attributeDiffs when attributes unchanged but quantity changes", () => {
      const before = parse(`# Pancakes

## Ingredients

- flour - 2 cups :: also=240g

## Steps

1. Mix.`);

      const after = parse(`# Pancakes

## Ingredients

- flour - 3 cups :: also=240g

## Steps

1. Mix.`);

      const annotations = diffRecipes(before, after);
      const flour = annotations.find((a) => a.key === "flour");
      expect(flour).toBeDefined();
      expect(flour!.attributeDiffs).toBeUndefined();
    });
  });

  describe("steps", () => {
    test("added step", () => {
      const before = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix.`);

      const after = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix.
2. Cook.`);

      const annotations = diffRecipes(before, after);
      expect(hasAnnotation(annotations, "steps", "1", "added")).toBe(true);
    });

    test("changed step has tokens", () => {
      const before = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix dry ingredients.`);

      const after = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix dry ingredients together.`);

      const annotations = diffRecipes(before, after);
      const step = annotations.find((a) => a.section === "steps" && a.key === "0");
      expect(step).toBeDefined();
      expect(step!.status).toBe("changed");
      expect(step!.tokens).toBeDefined();
      expect(step!.tokens).toContainEqual({ kind: "insert", text: " together" });
    });

    test("removed step", () => {
      const before = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix.
2. Cook.`);

      const after = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix.`);

      const annotations = diffRecipes(before, after);
      expect(hasAnnotation(annotations, "steps", "1", "removed")).toBe(true);
    });

    test("added reference in step shows in tokens", () => {
      const before = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix the flour.`);

      const after = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix the [[flour]].`);

      const annotations = diffRecipes(before, after);
      const step = annotations.find((a) => a.section === "steps" && a.key === "0");
      expect(step).toBeDefined();
      expect(step!.tokens).toBeDefined();
      expect(step!.tokens).toContainEqual({ kind: "insert", text: "[[" });
      expect(step!.tokens).toContainEqual({ kind: "insert", text: "]]" });
    });
  });

  describe("notes", () => {
    test("added note", () => {
      const before = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix.`);

      const after = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix.

## Notes

Serve warm.`);

      const annotations = diffRecipes(before, after);
      expect(hasAnnotation(annotations, "notes", "0", "added")).toBe(true);
    });

    test("changed note has tokens", () => {
      const before = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix.

## Notes

Serve warm.`);

      const after = parse(`# Pancakes

## Ingredients

- flour - 2 cups

## Steps

1. Mix.

## Notes

Serve cold.`);

      const annotations = diffRecipes(before, after);
      const note = annotations.find((a) => a.section === "notes");
      expect(note).toBeDefined();
      expect(note!.status).toBe("changed");
      expect(note!.tokens).toContainEqual({ kind: "delete", text: "warm" });
      expect(note!.tokens).toContainEqual({ kind: "insert", text: "cold" });
    });
  });

  describe("typical doctor changes", () => {
    test("doctor adds also= attributes and references", () => {
      const before = parse(`# Chocolate Chip Cookies

## Ingredients

- flour - 2 cups
- butter - 1 cup
- chocolate chips - 1 cup

## Steps

1. Cream the butter and sugar.
2. Add flour and mix.
3. Fold in chocolate chips.
4. Bake at {350F} for {12 minutes}.`);

      const after = parse(`# Chocolate Chip Cookies

## Ingredients

- flour - 2 cups :: also=240g
- butter - 1 cup :: also=227g
- chocolate chips - 1 cup :: also=170g

## Steps

1. Cream the [[butter]] and sugar.
2. Add [[flour]] and mix.
3. Fold in [[chocolate chips|chocolate-chips]].
4. Bake at {350F} for {12 minutes}.`);

      const annotations = diffRecipes(before, after);

      // All three ingredients should be changed (attribute-only changes)
      expect(hasAnnotation(annotations, "ingredients", "flour", "changed")).toBe(true);
      expect(hasAnnotation(annotations, "ingredients", "butter", "changed")).toBe(true);
      expect(hasAnnotation(annotations, "ingredients", "chocolate-chips", "changed")).toBe(true);

      // Ingredient changes are attribute-only → no content tokens, attributeDiffs present
      const flour = annotations.find((a) => a.key === "flour")!;
      expect(flour.tokens).toBeUndefined();
      expect(flour.attributeDiffs).toContainEqual({ key: "also", status: "added" });

      // Steps 0-2 should be changed
      expect(hasAnnotation(annotations, "steps", "0", "changed")).toBe(true);
      expect(hasAnnotation(annotations, "steps", "1", "changed")).toBe(true);
      expect(hasAnnotation(annotations, "steps", "2", "changed")).toBe(true);

      // Step 3 unchanged
      expect(annotations.filter((a) => a.section === "steps" && a.key === "3")).toEqual([]);

      // Verify step tokens show the reference changes
      const step0 = annotations.find((a) => a.section === "steps" && a.key === "0")!;
      expect(step0.tokens).toContainEqual({ kind: "insert", text: "[[" });
      expect(step0.tokens).toContainEqual({ kind: "insert", text: "]]" });
    });
  });
});
