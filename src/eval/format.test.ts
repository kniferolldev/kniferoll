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
    referenceScore: 1.0,
    proseScore: 1.0,
    metadataScore: 1.0,
    structureScore: 1.0,
    recipes: [],
    missingRecipes: [],
    extraRecipes: [],
    metadata: {
      titleScore: 1.0,
      sourceScore: 1.0,
      overallScore: 1.0,
      issues: [],
    },
    references: {
      totalRefs: 0,
      brokenRefs: 0,
      score: 1.0,
      issues: [],
    },
    prose: {
      introScore: 1.0,
      notesScore: 1.0,
      overallScore: 1.0,
      issues: [],
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
    actualTitle: "Test Recipe",
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
      referenceScore: 0.75,
      proseScore: 0.6,
      metadataScore: 0.95,
      structureScore: 1.0,
    });
    const lines = formatDetailed(result);

    // Always shown
    expect(lines).toContain("Ingredients: 90%");
    expect(lines).toContain("Steps: 80%");
    expect(lines).toContain("References: 75%");
    // Only shown when < 100%
    expect(lines).toContain("Prose: 60%");
    expect(lines).toContain("Metadata: 95%");
    // Structure rounds to 100% so it should be hidden
    expect(lines.some((l) => l.startsWith("Structure:"))).toBe(false);
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
                goldenName: "flour",
                actualId: "flour",
                actualName: "flour",
                goldenLine: 5,
                actualLine: 5,
                nameScore: 1.0,
                quantityScore: 0.8,
                notesScore: 1.0,
                attrsScore: 1.0,
                totalScore: 0.9,
                issues: [],
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
                goldenName: "flour",
                actualId: "flour",
                actualName: "flour",
                goldenLine: 5,
                actualLine: 5,
                nameScore: 0.7,
                quantityScore: 0.6,
                notesScore: 0.5,
                attrsScore: 1.0,
                totalScore: 0.6,
                issues: [],
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
                goldenLine: 10,
                actualLine: 10,
                textScore: 0.7,
                refsScore: 1.0,
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

  test("shows broken references", () => {
    const result = makeResult({
      references: {
        totalRefs: 6,
        brokenRefs: 4,
        score: 1 / 3,
        issues: [
          "broken reference: [[kosher salt -> salt]]",
          "broken reference: [[olive oil -> oil]]",
        ],
      },
    });
    const lines = formatDetailed(result);

    expect(lines.some((l) => l.includes("Broken references: 4/6"))).toBe(true);
    expect(lines.some((l) => l.includes("broken reference: [[kosher salt -> salt]]"))).toBe(true);
  });

  test("shows prose issues", () => {
    const result = makeResult({
      prose: {
        introScore: 0.5,
        notesScore: 0.3,
        overallScore: 0.4,
        issues: ["Test Recipe: intro differs", "Test Recipe: notes differ"],
      },
    });
    const lines = formatDetailed(result);

    expect(lines.some((l) => l.includes("Test Recipe: intro differs"))).toBe(true);
    expect(lines.some((l) => l.includes("Test Recipe: notes differ"))).toBe(true);
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
