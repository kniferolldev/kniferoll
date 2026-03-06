import { describe, it, expect } from "bun:test";
import { computeSourceSpans } from "./source-spans";
import { parseDocument } from "./parser";

describe("computeSourceSpans", () => {
  it("computes spans for a simple recipe", () => {
    const md = [
      "# Simple Recipe",
      "",
      "## Ingredients",
      "",
      "- flour - 2 cups",
      "- sugar - 1 cup",
      "",
      "## Steps",
      "",
      "1. Mix everything",
    ].join("\n");

    const lines = md.split("\n");
    const result = parseDocument(md);
    const spans = computeSourceSpans(lines, result);

    // Recipe title on line 1
    expect(spans.get(1)).toEqual({ startLine: 1, endLine: 1 });
    // flour on line 5
    expect(spans.get(5)).toEqual({ startLine: 5, endLine: 5 });
    // sugar on line 6
    expect(spans.get(6)).toEqual({ startLine: 6, endLine: 6 });
    // step on line 10
    expect(spans.get(10)).toEqual({ startLine: 10, endLine: 10 });
  });

  it("handles continuation lines in steps", () => {
    const md = [
      "# Recipe",
      "",
      "## Ingredients",
      "",
      "- flour - 2 cups",
      "",
      "## Steps",
      "",
      "1. Mix everything together until",
      "   well combined.",
      "",
      "2. Bake at 350F.",
    ].join("\n");

    const lines = md.split("\n");
    const result = parseDocument(md);
    const spans = computeSourceSpans(lines, result);

    // The step parser joins continuation lines, so line 9 is the start
    // and the parsed step only records line 9.
    // The span for line 9 should cover lines 9-10
    const stepSpan = spans.get(9);
    expect(stepSpan).toBeDefined();
    expect(stepSpan!.startLine).toBe(9);
    expect(stepSpan!.endLine).toBe(10);
  });

  it("computes spans for intro paragraphs", () => {
    const md = [
      "# Recipe with Intro",          // 1
      "",                              // 2
      "This is the first paragraph",   // 3
      "of the intro.",                 // 4
      "",                              // 5
      "This is the second paragraph.", // 6
      "",                              // 7
      "## Ingredients",                // 8
      "",                              // 9
      "- flour - 2 cups",             // 10
    ].join("\n");

    const lines = md.split("\n");
    const result = parseDocument(md);
    const spans = computeSourceSpans(lines, result);

    // First intro paragraph starts at line 3, ends at line 4
    expect(spans.get(3)).toEqual({ startLine: 3, endLine: 4 });
    // Second intro paragraph at line 6
    expect(spans.get(6)).toEqual({ startLine: 6, endLine: 6 });
  });

  it("computes spans for single-line intro", () => {
    const md = [
      "# Recipe",                      // 1
      "",                              // 2
      "A short intro.",                // 3
      "",                              // 4
      "## Ingredients",                // 5
      "",                              // 6
      "- flour - 2 cups",             // 7
    ].join("\n");

    const lines = md.split("\n");
    const result = parseDocument(md);
    const spans = computeSourceSpans(lines, result);

    expect(spans.get(3)).toEqual({ startLine: 3, endLine: 3 });
  });

  it("handles ingredients with attributes", () => {
    const md = [
      "# Recipe",
      "",
      "## Ingredients",
      "",
      "- rice - 2 cups :: id=rice also=12oz",
      "- water - 4 cups",
      "",
      "## Steps",
      "",
      "1. Cook the rice.",
    ].join("\n");

    const lines = md.split("\n");
    const result = parseDocument(md);
    const spans = computeSourceSpans(lines, result);

    expect(spans.get(5)).toEqual({ startLine: 5, endLine: 5 });
    expect(spans.get(6)).toEqual({ startLine: 6, endLine: 6 });
  });

  it("handles continuation lines in notes bullets", () => {
    const md = [
      "# Recipe",              // 1
      "",                      // 2
      "## Ingredients",        // 3
      "",                      // 4
      "- salt",                // 5
      "",                      // 6
      "## Steps",              // 7
      "",                      // 8
      "1. Cook.",              // 9
      "",                      // 10
      "## Notes",              // 11
      "",                      // 12
      "- **Storage:** Keep in the fridge for", // 13
      "  up to 5 days.",       // 14
      "- **Tip:** Use fresh ingredients",      // 15
      "  for best results.",   // 16
    ].join("\n");

    const lines = md.split("\n");
    const result = parseDocument(md);
    const spans = computeSourceSpans(lines, result);

    // First bullet starts at line 13, spans to line 14
    const firstSpan = spans.get(13);
    expect(firstSpan).toBeDefined();
    expect(firstSpan!.startLine).toBe(13);
    expect(firstSpan!.endLine).toBe(14);

    // Second bullet starts at line 15, spans to line 16
    const secondSpan = spans.get(15);
    expect(secondSpan).toBeDefined();
    expect(secondSpan!.startLine).toBe(15);
    expect(secondSpan!.endLine).toBe(16);
  });
});
