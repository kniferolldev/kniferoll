import { describe, test, expect } from "bun:test";
import { generateExplorerHtml } from "./explorer";
import type { Baseline } from "./types";
import { join } from "path";

function makeBaseline(overrides: Partial<Baseline> = {}): Baseline {
  return {
    timestamp: "2026-03-25T12:00:00Z",
    metadata: { importerModel: "google/gemini-3-flash-preview" },
    results: {},
    summary: { parseRate: 100, avgScore: 100 },
    ...overrides,
  };
}

const EVALS_DIR = join(import.meta.dir, "../../evals");

describe("generateExplorerHtml", () => {
  test("produces valid HTML with empty baseline", async () => {
    const html = await generateExplorerHtml(makeBaseline(), EVALS_DIR);
    expect(html).toStartWith("<!DOCTYPE html>");
    expect(html).toContain("<title>Eval Explorer</title>");
    expect(html).toContain("0 cases");
    expect(html).toContain("avg <strong>100%</strong>");
  });

  test("includes test case IDs in output", async () => {
    const html = await generateExplorerHtml(
      makeBaseline({
        results: {
          "test-recipe": {
            id: "test-recipe",
            parsed: true,
            errorCount: 0,
            warningCount: 0,
            score: 85,
            actual: "# Test Recipe\n\n## Ingredients\n\n- flour - 1 cup\n\n## Steps\n\n1. Mix.",
            comparison: {
              score: 85,
              parsed: true,
              ingredientScore: 0.8,
              stepScore: 0.9,
              referenceScore: 1,
              proseScore: 1,
              metadataScore: 1,
              structureScore: 1,
              recipes: [{
                goldenTitle: "Test Recipe",
                actualTitle: "Test Recipe",
                ingredientScore: 0.8,
                stepScore: 0.9,
                ingredients: {
                  comparisons: [{
                    goldenId: "flour",
                    goldenName: "flour",
                    actualId: "flour",
                    actualName: "flour",
                    goldenLine: 5,
                    actualLine: 5,
                    nameScore: 1,
                    quantityScore: 0.8,
                    notesScore: 1,
                    attrsScore: 1,
                    totalScore: 0.9,
                    issues: ["qty: \"1 cup\" vs \"2 cups\""],
                  }],
                  missing: [],
                  extra: [],
                },
                steps: {
                  comparisons: [{
                    index: 1,
                    goldenLine: 9,
                    actualLine: 9,
                    textScore: 0.9,
                    refsScore: 1,
                    totalScore: 0.93,
                    missingRefs: [],
                    extraRefs: [],
                  }],
                  missingCount: 0,
                  extraCount: 0,
                },
              }],
              metadata: { titleScore: 1, sourceScore: 1, overallScore: 1, issues: [] },
              references: { totalRefs: 0, brokenRefs: 0, score: 1, issues: [] },
              prose: { introScore: 1, notesScore: 1, overallScore: 1, issues: [] },
              missingRecipes: [],
              extraRecipes: [],
              issues: [],
            },
          },
        },
        summary: { parseRate: 100, avgScore: 85 },
      }),
      EVALS_DIR,
    );

    expect(html).toContain("test-recipe");
    expect(html).toContain("85%");
    expect(html).toContain("1 cases");
    expect(html).toContain("Ingredients");
    expect(html).toContain("Steps");
  });

  test("handles parse failure case", async () => {
    const html = await generateExplorerHtml(
      makeBaseline({
        results: {
          "broken-recipe": {
            id: "broken-recipe",
            parsed: false,
            errorCount: 3,
            warningCount: 0,
            score: 0,
            actual: "not valid markdown",
          },
        },
        summary: { parseRate: 0, avgScore: 0 },
      }),
      EVALS_DIR,
    );

    expect(html).toContain("broken-recipe");
    expect(html).toContain("parse failed");
  });

  test("works with real baseline.json", async () => {
    const baselineFile = Bun.file(join(EVALS_DIR, "baseline.json"));
    if (!(await baselineFile.exists())) return; // skip if no baseline

    const baseline: Baseline = await baselineFile.json();
    const html = await generateExplorerHtml(baseline, EVALS_DIR);

    expect(html).toContain("<!DOCTYPE html>");
    // Should contain all test case IDs
    for (const id of Object.keys(baseline.results)) {
      expect(html).toContain(id);
    }
    // Should contain category labels
    expect(html).toContain("Ingredients");
    expect(html).toContain("Steps");
    expect(html).toContain("References");
  });
});
