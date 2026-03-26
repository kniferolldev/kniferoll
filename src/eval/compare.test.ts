/**
 * Tests for structured comparison of Kniferoll Markdown documents
 */

import { describe, expect, it } from "bun:test";
import { compareDocuments } from "./compare";
import { parseDocument } from "../core";

// Helper to create a minimal valid recipe document
function makeDoc(content: string): string {
  return `---
version: 1
---

${content}`;
}

describe("compareDocuments", () => {
  describe("identical documents", () => {
    it("returns 100% for identical single-recipe documents", () => {
      const doc = makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup
- salt - 2 tsp

## Steps

1. Mix [[flour]] and [[salt]].
2. Stir well.
`);
      const golden = parseDocument(doc);
      const actual = parseDocument(doc);
      const result = compareDocuments(golden, actual);

      expect(result.score).toBe(100);
      expect(result.parsed).toBe(true);
      expect(result.ingredientScore).toBe(1);
      expect(result.stepScore).toBe(1);
    });

    it("returns 100% for identical multi-recipe documents", () => {
      const doc = makeDoc(`
# Main Dish

## Ingredients

- chicken - 1 lb

## Steps

1. Cook [[chicken]].

# Side Dish

## Ingredients

- rice - 2 cups

## Steps

1. Boil [[rice]].
`);
      const golden = parseDocument(doc);
      const actual = parseDocument(doc);
      const result = compareDocuments(golden, actual);

      expect(result.score).toBe(100);
      expect(result.recipes).toHaveLength(2);
    });
  });

  describe("parse failure", () => {
    it("returns 0% when actual fails to parse", () => {
      const doc = makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix.
`);
      const golden = parseDocument(doc);
      const result = compareDocuments(golden, null);

      expect(result.score).toBe(0);
      expect(result.parsed).toBe(false);
      expect(result.issues).toContain("actual failed to parse");
    });
  });

  describe("ingredient comparison", () => {
    it("penalizes missing ingredients heavily", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup
- salt - 2 tsp
- sugar - 1 tbsp

## Steps

1. Mix.
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix.
`));
      const result = compareDocuments(golden, actual);

      // 2 missing ingredients with default penalty of 1.0 each
      // Should result in very low ingredient score
      expect(result.ingredientScore).toBeLessThan(0.5);
      expect(result.recipes[0]?.ingredients.missing).toContain("salt");
      expect(result.recipes[0]?.ingredients.missing).toContain("sugar");
    });

    it("penalizes extra ingredients less than missing", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix.
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup
- salt - 2 tsp
- sugar - 1 tbsp

## Steps

1. Mix.
`));
      const result = compareDocuments(golden, actual);

      // Extra ingredients have lower penalty (0.3 default)
      // Should still be reasonably high score
      expect(result.ingredientScore).toBeGreaterThan(0.3);
      expect(result.recipes[0]?.ingredients.extra).toContain("salt");
      expect(result.recipes[0]?.ingredients.extra).toContain("sugar");
    });

    it("compares quantity text with levenshtein ratio", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup :: id=flour

## Steps

1. Mix.
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 2 cups :: id=flour

## Steps

1. Mix.
`));
      const result = compareDocuments(golden, actual);

      // Same ingredient ID but different quantity
      expect(result.recipes[0]?.ingredients.comparisons[0]?.actualId).toBe("flour");
      expect(result.recipes[0]?.ingredients.comparisons[0]?.quantityScore).toBeLessThan(1);
      expect(result.recipes[0]?.ingredients.comparisons[0]?.quantityScore).toBeGreaterThan(0);
    });

    it("compares ingredient names with levenshtein ratio", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- all-purpose flour - 1 cup

## Steps

1. Mix.
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- all purpose flour - 1 cup

## Steps

1. Mix.
`));
      const result = compareDocuments(golden, actual);

      // Similar names should match and show partial name score
      const comp = result.recipes[0]?.ingredients.comparisons[0];
      expect(comp?.nameScore).toBeLessThan(1);
      expect(comp?.nameScore).toBeGreaterThan(0.9); // Very similar names
    });

    it("compares modifiers with levenshtein ratio", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- butter - 2 tbsp, softened :: id=butter

## Steps

1. Mix.
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- butter - 2 tbsp, melted :: id=butter

## Steps

1. Mix.
`));
      const result = compareDocuments(golden, actual);

      const comp = result.recipes[0]?.ingredients.comparisons[0];
      expect(comp?.notesScore).toBeLessThan(1);
      expect(comp?.notesScore).toBeGreaterThan(0);
    });
  });

  describe("step comparison", () => {
    it("compares step text with levenshtein ratio", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix the flour gently.
2. Let it rest for 10 minutes.
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix flour gently.
2. Let rest for 10 minutes.
`));
      const result = compareDocuments(golden, actual);

      // Similar but not identical step text
      expect(result.stepScore).toBeGreaterThan(0.8);
      expect(result.stepScore).toBeLessThan(1);
    });

    it("tracks missing ingredient references", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup
- salt - 2 tsp

## Steps

1. Mix [[flour]] and [[salt]].
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup
- salt - 2 tsp

## Steps

1. Mix [[flour]].
`));
      const result = compareDocuments(golden, actual);

      expect(result.recipes[0]?.steps.comparisons[0]?.missingRefs).toContain("salt");
    });

    it("tracks extra ingredient references", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup
- salt - 2 tsp

## Steps

1. Mix [[flour]].
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup
- salt - 2 tsp

## Steps

1. Mix [[flour]] and [[salt]].
`));
      const result = compareDocuments(golden, actual);

      expect(result.recipes[0]?.steps.comparisons[0]?.extraRefs).toContain("salt");
    });

    it("penalizes missing steps", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix.
2. Rest.
3. Bake.
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix.
`));
      const result = compareDocuments(golden, actual);

      expect(result.recipes[0]?.steps.missingCount).toBe(2);
      expect(result.stepScore).toBeLessThan(0.5);
    });

    it("penalizes extra steps less than missing", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix.
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix.
2. Rest.
3. Bake.
`));
      const result = compareDocuments(golden, actual);

      expect(result.recipes[0]?.steps.extraCount).toBe(2);
      // Extra steps have lower penalty
      expect(result.stepScore).toBeGreaterThan(0.5);
    });
  });

  describe("recipe structure comparison", () => {
    it("detects missing recipes", () => {
      const golden = parseDocument(makeDoc(`
# Main Dish

## Ingredients

- chicken - 1 lb

## Steps

1. Cook.

# Side Dish

## Ingredients

- rice - 2 cups

## Steps

1. Boil.
`));
      const actual = parseDocument(makeDoc(`
# Main Dish

## Ingredients

- chicken - 1 lb

## Steps

1. Cook.
`));
      const result = compareDocuments(golden, actual);

      expect(result.missingRecipes).toContain("side-dish");
      expect(result.structureScore).toBeLessThan(1);
    });

    it("detects extra recipes", () => {
      const golden = parseDocument(makeDoc(`
# Main Dish

## Ingredients

- chicken - 1 lb

## Steps

1. Cook.
`));
      const actual = parseDocument(makeDoc(`
# Main Dish

## Ingredients

- chicken - 1 lb

## Steps

1. Cook.

# Side Dish

## Ingredients

- rice - 2 cups

## Steps

1. Boil.
`));
      const result = compareDocuments(golden, actual);

      expect(result.extraRecipes).toContain("side-dish");
      // Extra recipes penalized less than missing
      expect(result.structureScore).toBeGreaterThan(0.5);
    });
  });

  describe("metadata comparison", () => {
    it("compares document titles", () => {
      const golden = parseDocument(makeDoc(`
# My Amazing Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix.
`));
      const actual = parseDocument(makeDoc(`
# My Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix.
`));
      const result = compareDocuments(golden, actual);

      expect(result.metadata.titleScore).toBeLessThan(1);
      expect(result.metadata.titleScore).toBeGreaterThan(0.5);
    });
  });

  describe("custom weights", () => {
    it("allows overriding category weights", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup :: id=flour

## Steps

1. Mix.
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 2 cups :: id=flour

## Steps

1. Mix well and thoroughly.
`));

      // With ingredients weighted much higher
      const ingredientHeavy = compareDocuments(golden, actual, {
        ingredients: 10.0,
        steps: 1.0,
        metadata: 0.1,
        structure: 0.1,
      });

      // With steps weighted much higher
      const stepHeavy = compareDocuments(golden, actual, {
        ingredients: 1.0,
        steps: 10.0,
        metadata: 0.1,
        structure: 0.1,
      });

      // The weighted scores should differ based on category weights
      // Since ingredients have quantity mismatch and steps have text mismatch
      expect(ingredientHeavy.score).not.toBe(stepHeavy.score);
    });

    it("allows overriding penalty values", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup
- salt - 2 tsp

## Steps

1. Mix.
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix.
`));

      // With default penalty (1.0)
      const defaultResult = compareDocuments(golden, actual);

      // With zero penalty for missing ingredients
      const noPenalty = compareDocuments(golden, actual, {
        missingIngredientPenalty: 0,
      });

      // Zero penalty should give higher score
      expect(noPenalty.ingredientScore).toBeGreaterThan(defaultResult.ingredientScore);
    });
  });

  describe("edge cases", () => {
    it("handles empty ingredients section", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

## Steps

1. Just do it.
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

## Steps

1. Just do it.
`));
      const result = compareDocuments(golden, actual);

      expect(result.score).toBe(100);
    });

    it("handles empty steps section", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps
`));
      const result = compareDocuments(golden, actual);

      expect(result.score).toBe(100);
    });

    it("handles display name arrow syntax in references", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- all-purpose flour - 1 cup :: id=flour

## Steps

1. Add [[all-purpose flour -> flour]].
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- all-purpose flour - 1 cup :: id=flour

## Steps

1. Add [[flour]].
`));
      const result = compareDocuments(golden, actual);

      // Display text "all-purpose flour" should match resolved name "all-purpose flour"
      expect(result.recipes[0]?.steps.comparisons[0]?.missingRefs).toHaveLength(0);
      expect(result.recipes[0]?.steps.comparisons[0]?.extraRefs).toHaveLength(0);
    });
  });

  describe("nameSimilarityScore clamping", () => {
    it("does not return scores above 1.0 for short containment matches", () => {
      // "oil" contained in "olive oil" — containmentScore * 1.5 could exceed 1.0
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- oil - 1 tbsp

## Steps

1. Mix.
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- olive oil - 1 tbsp

## Steps

1. Mix.
`));
      const result = compareDocuments(golden, actual);

      // Ingredient should match and score should not exceed 100
      expect(result.ingredientScore).toBeLessThanOrEqual(1);
      expect(result.score).toBeLessThanOrEqual(100);
    });
  });

  describe("reference validity scoring", () => {
    it("scores 1.0 when all references resolve", () => {
      const doc = makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup
- salt - 2 tsp

## Steps

1. Mix [[flour]] and [[salt]].
`);
      const golden = parseDocument(doc);
      const actual = parseDocument(doc);
      const result = compareDocuments(golden, actual);

      expect(result.referenceScore).toBe(1);
      expect(result.references.brokenRefs).toBe(0);
    });

    it("penalizes broken references (target doesn't match any ingredient)", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- kosher salt - 1 tsp

## Steps

1. Add [[kosher salt]].
`));
      // Actual references a non-existent ingredient
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- kosher salt - 1 tsp

## Steps

1. Add [[fine salt]].
`));
      const result = compareDocuments(golden, actual);

      expect(result.referenceScore).toBeLessThan(1);
      expect(result.references.brokenRefs).toBeGreaterThan(0);
    });

    it("scores 1.0 when there are no references", () => {
      const doc = makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix well.
`);
      const golden = parseDocument(doc);
      const actual = parseDocument(doc);
      const result = compareDocuments(golden, actual);

      expect(result.referenceScore).toBe(1);
    });

    it("penalizes all-broken references heavily", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Add [[flour]].
`));
      // References to nonexistent ids
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Add [[nonexistent]].
`));
      const result = compareDocuments(golden, actual);

      expect(result.referenceScore).toBe(0);
      expect(result.references.brokenRefs).toBe(1);
    });
  });

  describe("step alignment", () => {
    it("handles step split (3 golden → 4 actual) without cascade", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix the dough thoroughly.
2. Let it rest for 30 minutes.
3. Bake at 350F for 25 minutes.
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix the dough.
2. Knead thoroughly until smooth.
3. Let it rest for 30 minutes.
4. Bake at 350F for 25 minutes.
`));
      const result = compareDocuments(golden, actual);

      // Steps 2 and 3 should still align well despite the split at step 1
      // "Let it rest for 30 minutes" and "Bake at 350F" should match
      expect(result.stepScore).toBeGreaterThan(0.6);
    });

    it("handles step merge (4 golden → 3 actual) without cascade", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix the dough.
2. Knead thoroughly.
3. Let it rest for 30 minutes.
4. Bake at 350F for 25 minutes.
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix the dough and knead thoroughly.
2. Let it rest for 30 minutes.
3. Bake at 350F for 25 minutes.
`));
      const result = compareDocuments(golden, actual);

      // 3 of 4 golden steps match (1 merged into another), 1 missing.
      // The key test: steps 3 and 4 still align correctly despite the merge.
      // Score should be moderate (merge = real editing work) but not terrible.
      expect(result.stepScore).toBeGreaterThan(0.3);
      // Verify later steps actually aligned (both should have high text scores)
      const stepComps = result.recipes[0]!.steps.comparisons;
      const lastTwo = stepComps.filter((s) => s.textScore > 0.9);
      expect(lastTwo.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("prose comparison", () => {
    it("scores 1.0 when intro and notes match", () => {
      const doc = makeDoc(`
# Test Recipe

A lovely recipe for testing.

## Ingredients

- flour - 1 cup

## Steps

1. Mix.

## Notes

Best served warm.
`);
      const golden = parseDocument(doc);
      const actual = parseDocument(doc);
      const result = compareDocuments(golden, actual);

      expect(result.proseScore).toBe(1);
    });

    it("penalizes missing intro", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

A lovely recipe for testing with a detailed headnote.

## Ingredients

- flour - 1 cup

## Steps

1. Mix.
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix.
`));
      const result = compareDocuments(golden, actual);

      expect(result.proseScore).toBeLessThan(1);
      expect(result.prose.introScore).toBe(0);
    });

    it("gives partial penalty for extra intro", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix.
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

This is an added intro paragraph.

## Ingredients

- flour - 1 cup

## Steps

1. Mix.
`));
      const result = compareDocuments(golden, actual);

      // Extra intro (actual has it, golden doesn't) should get 0.7 penalty
      expect(result.prose.introScore).toBeCloseTo(0.7, 1);
    });

    it("penalizes different notes content", () => {
      const golden = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix.

## Notes

Best served warm with butter.
`));
      const actual = parseDocument(makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix.

## Notes

This recipe was adapted from a classic cookbook.
`));
      const result = compareDocuments(golden, actual);

      expect(result.prose.notesScore).toBeLessThan(0.5);
    });
  });
});

describe("weight normalization", () => {
  it("category weights are relative (only ratios matter)", () => {
    const doc = makeDoc(`
# Test Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix.
`);
    const golden = parseDocument(doc);
    const actual = parseDocument(doc);

    // These should produce identical results since ratios are the same
    const result1 = compareDocuments(golden, actual, {
      ingredients: 3,
      steps: 2,
      references: 1.5,
      metadata: 0.5,
      structure: 0.5,
      prose: 0.5,
    });

    const result2 = compareDocuments(golden, actual, {
      ingredients: 6,
      steps: 4,
      references: 3,
      metadata: 1,
      structure: 1,
      prose: 1,
    });

    expect(result1.score).toBe(result2.score);
  });
});

describe("typographic normalization", () => {
  it("treats en-dashes and hyphens as equivalent in quantities", () => {
    const golden = parseDocument(
      makeDoc(`
# Recipe

## Ingredients

- pork butt - 8\u201310 lb

## Steps

1. Cook the [[pork butt]].
`),
    );
    const actual = parseDocument(
      makeDoc(`
# Recipe

## Ingredients

- pork butt - 8-10 lb

## Steps

1. Cook the [[pork butt]].
`),
    );

    const result = compareDocuments(golden, actual);
    expect(result.score).toBe(100);
    expect(result.recipes[0]!.ingredients.comparisons[0]!.quantityScore).toBe(1);
  });

  it("treats curly and straight quotes as equivalent", () => {
    const golden = parseDocument(
      makeDoc(`
# Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix until \u201csmooth\u201d.
`),
    );
    const actual = parseDocument(
      makeDoc(`
# Recipe

## Ingredients

- flour - 1 cup

## Steps

1. Mix until "smooth".
`),
    );

    const result = compareDocuments(golden, actual);
    expect(result.stepScore).toBe(1);
  });
});
