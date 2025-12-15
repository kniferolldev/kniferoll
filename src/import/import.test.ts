import { expect, test } from "bun:test";
import type { RecipeImporter, ImportInput } from "./types";

test("ImportInput type - text input", () => {
  const input: ImportInput = {
    text: "Some recipe text",
  };

  expect(input.text).toBe("Some recipe text");
});

test("ImportInput type - image input", () => {
  const blob = new Blob(["test"], { type: "image/jpeg" });
  const input: ImportInput = {
    images: [blob],
  };

  expect(input.images).toBeDefined();
  expect(input.images?.length).toBe(1);
});

test("ImportInput type - url input", () => {
  const input: ImportInput = {
    url: "https://example.com/recipe",
  };

  expect(input.url).toBe("https://example.com/recipe");
});

test("RecipeImporter type signature", async () => {
  // Mock implementation to verify the type works
  const mockImporter: RecipeImporter = async (input: ImportInput) => {
    if (input.text) {
      return `# Recipe\n## Ingredients\n- test - 1 cup\n## Steps\n1. Mix.`;
    }
    return "# Empty Recipe";
  };

  const result = await mockImporter({ text: "test" });
  expect(result).toContain("# Recipe");
});
