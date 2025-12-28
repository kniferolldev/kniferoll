import { describe, expect, test } from "bun:test";
import { formatScalar, formatDetailed, formatJson } from "./format";
import type { ComparisonResult } from "./compare";

// Helper to create a minimal valid comparison result
function makeResult(overrides: Partial<ComparisonResult> = {}): ComparisonResult {
  return {
    parsed: true,
    score: 85,
    ingredientScore: 0.9,
    stepScore: 0.8,
    metadataScore: 1.0,
    structureScore: 1.0,
    recipes: [],
    missingRecipes: [],
    extraRecipes: [],
    metadata: {
      titleScore: 1.0,
    },
    issues: [],
    ...overrides,
  };
}

// Helper to create a recipe comparison
function makeRecipeComparison(overrides: Partial<ComparisonResult["recipes"][0]> = {}) {
  return {
    goldenId: "test-recipe",
    goldenTitle: "Test Recipe",
    actualId: "test-recipe",
    ingredientScore: 0.9,
    stepScore: 0.85,
    ingredients: {
      comparisons: [],
      missing: [],
      extra: [],
    },
    steps: {
      comparisons: [],
      missingCount: 0,
      extraCount: 0,
    },
    ...overrides,
  };
}

describe("formatScalar", () => {
  test("formats successful result as percentage", () => {
    const result = makeResult({ score: 95 });

    expect(formatScalar(result)).toBe("95%");
  });

  test("formats 100% score", () => {
    const result = makeResult({ score: 100 });

    expect(formatScalar(result)).toBe("100%");
  });

  test("formats 0% score", () => {
    const result = makeResult({ score: 0 });

    expect(formatScalar(result)).toBe("0%");
  });

  test("shows parse failed message", () => {
    const result = makeResult({ parsed: false, score: 0 });

    expect(formatScalar(result)).toBe("0% (parse failed)");
  });
});

describe("formatDetailed", () => {
  test("shows parse failed for unparsed result", () => {
    const result = makeResult({ parsed: false });
    const lines = formatDetailed(result);

    expect(lines).toContain("Parse failed");
    expect(lines).toHaveLength(1);
  });

  test("includes score header", () => {
    const result = makeResult({ score: 85 });
    const lines = formatDetailed(result);

    expect(lines[0]).toBe("Score: 85%");
  });

  test("includes category scores", () => {
    const result = makeResult({
      ingredientScore: 0.9,
      stepScore: 0.8,
      metadataScore: 0.95,
      structureScore: 1.0,
    });
    const lines = formatDetailed(result);

    expect(lines).toContain("Ingredients: 90%");
    expect(lines).toContain("Steps: 80%");
    expect(lines).toContain("Metadata: 95%");
    expect(lines).toContain("Structure: 100%");
  });

  test("shows recipe details", () => {
    const result = makeResult({
      recipes: [
        makeRecipeComparison({
          goldenTitle: "Chocolate Cake",
          ingredientScore: 0.8,
          stepScore: 0.9,
          ingredients: {
            comparisons: [
              {
                goldenId: "flour",
                actualId: "flour",
                nameScore: 1.0,
                quantityScore: 0.8,
                notesScore: 1.0,
                totalScore: 0.9,
              },
            ],
            missing: [],
            extra: [],
          },
          steps: {
            comparisons: [],
            missingCount: 0,
            extraCount: 0,
          },
        }),
      ],
    });
    const lines = formatDetailed(result);

    expect(lines.some((l) => l.includes("Recipe: Chocolate Cake"))).toBe(true);
    expect(lines.some((l) => l.includes("Ingredients: 80%"))).toBe(true);
  });

  test("shows missing ingredients", () => {
    const result = makeResult({
      recipes: [
        makeRecipeComparison({
          ingredients: {
            comparisons: [],
            missing: ["salt", "pepper"],
            extra: [],
          },
        }),
      ],
    });
    const lines = formatDetailed(result);

    expect(lines.some((l) => l.includes("missing: salt"))).toBe(true);
    expect(lines.some((l) => l.includes("missing: pepper"))).toBe(true);
  });

  test("shows extra ingredients", () => {
    const result = makeResult({
      recipes: [
        makeRecipeComparison({
          ingredients: {
            comparisons: [],
            missing: [],
            extra: ["sugar", "vanilla"],
          },
        }),
      ],
    });
    const lines = formatDetailed(result);

    expect(lines.some((l) => l.includes("extra: sugar"))).toBe(true);
    expect(lines.some((l) => l.includes("extra: vanilla"))).toBe(true);
  });

  test("shows ingredient comparison details for low scores", () => {
    const result = makeResult({
      recipes: [
        makeRecipeComparison({
          ingredients: {
            comparisons: [
              {
                goldenId: "flour",
                actualId: "flour",
                nameScore: 0.7,
                quantityScore: 0.6,
                notesScore: 0.5,
                totalScore: 0.6,
              },
            ],
            missing: [],
            extra: [],
          },
        }),
      ],
    });
    const lines = formatDetailed(result);

    expect(lines.some((l) => l.includes("flour") && l.includes("name=70%"))).toBe(true);
    expect(lines.some((l) => l.includes("qty=60%"))).toBe(true);
    expect(lines.some((l) => l.includes("notes=50%"))).toBe(true);
  });

  test("shows step details with missing and extra counts", () => {
    const result = makeResult({
      recipes: [
        makeRecipeComparison({
          steps: {
            comparisons: [],
            missingCount: 2,
            extraCount: 1,
          },
        }),
      ],
    });
    const lines = formatDetailed(result);

    expect(lines.some((l) => l.includes("2 missing"))).toBe(true);
    expect(lines.some((l) => l.includes("1 extra"))).toBe(true);
  });

  test("shows step comparison details for low scores", () => {
    const result = makeResult({
      recipes: [
        makeRecipeComparison({
          steps: {
            comparisons: [
              {
                index: 1,
                textScore: 0.7,
                refScore: 1.0,
                missingRefs: ["salt"],
                extraRefs: ["pepper"],
                totalScore: 0.8,
              },
            ],
            missingCount: 0,
            extraCount: 0,
          },
        }),
      ],
    });
    const lines = formatDetailed(result);

    expect(lines.some((l) => l.includes("step 1") && l.includes("text=70%"))).toBe(true);
    expect(lines.some((l) => l.includes("missing refs: salt"))).toBe(true);
    expect(lines.some((l) => l.includes("extra refs: pepper"))).toBe(true);
  });

  test("shows missing recipes", () => {
    const result = makeResult({
      missingRecipes: ["dessert", "sauce"],
    });
    const lines = formatDetailed(result);

    expect(lines.some((l) => l.includes("Missing recipes: dessert, sauce"))).toBe(true);
  });

  test("shows extra recipes", () => {
    const result = makeResult({
      extraRecipes: ["appetizer"],
    });
    const lines = formatDetailed(result);

    expect(lines.some((l) => l.includes("Extra recipes: appetizer"))).toBe(true);
  });
});

describe("formatJson", () => {
  test("returns valid JSON string", () => {
    const result = makeResult({ score: 75 });
    const json = formatJson(result);

    expect(() => JSON.parse(json)).not.toThrow();
  });

  test("includes all result fields", () => {
    const result = makeResult({
      score: 80,
      ingredientScore: 0.85,
      stepScore: 0.75,
    });
    const json = formatJson(result);
    const parsed = JSON.parse(json);

    expect(parsed.score).toBe(80);
    expect(parsed.ingredientScore).toBe(0.85);
    expect(parsed.stepScore).toBe(0.75);
  });

  test("is formatted with indentation", () => {
    const result = makeResult();
    const json = formatJson(result);

    expect(json).toContain("\n");
    expect(json).toContain("  ");
  });
});
