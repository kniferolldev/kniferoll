import { expect, test } from "bun:test";
import { postprocessMarkdown } from "./postprocess";

test("strips code fences", () => {
  const input = "```markdown\n---\nversion: 1\n---\n# Recipe\n```";
  const result = postprocessMarkdown(input);
  expect(result).toStartWith("---\nversion: 1\n---");
  expect(result).not.toContain("```");
});

test("injects version when frontmatter exists but missing version", () => {
  const input = "---\nyield: 4 servings\n---\n\n# Recipe";
  const result = postprocessMarkdown(input);
  expect(result).toStartWith("---\nversion: 1\nyield: 4 servings\n---");
});

test("prepends frontmatter when none exists", () => {
  const input = "# Recipe\n\n## Ingredients\n";
  const result = postprocessMarkdown(input);
  expect(result).toStartWith("---\nversion: 1\n---\n\n# Recipe");
});

test("leaves version alone when already present", () => {
  const input = "---\nversion: 1\nyield: 6\n---\n\n# Recipe";
  const result = postprocessMarkdown(input);
  expect(result).toBe(input);
});

test("expands inline source object to block style", () => {
  const input = '---\nversion: 1\nsource: { url: "https://example.com", title: "My Recipe" }\n---\n\n# Recipe';
  const result = postprocessMarkdown(input);
  expect(result).toContain("source:\n  url: \"https://example.com\"\n  title: \"My Recipe\"");
  expect(result).not.toContain("{ url:");
});

test("expands nested cookbook object to block style", () => {
  const input = '---\nversion: 1\nsource: { cookbook: { title: "The Book", author: "Chef" } }\n---\n\n# Recipe';
  const result = postprocessMarkdown(input);
  expect(result).toContain("source:\n  cookbook:\n    title: \"The Book\"\n    author: \"Chef\"");
});

test("leaves block-style frontmatter unchanged", () => {
  const input = "---\nversion: 1\nsource:\n  cookbook:\n    title: The Book\n---\n\n# Recipe";
  const result = postprocessMarkdown(input);
  expect(result).toBe(input);
});

test("handles all three fixes together", () => {
  const input = '```markdown\n---\nsource: { cookbook: { title: "Book" } }\nyield: 4\n---\n\n# Recipe\n```';
  const result = postprocessMarkdown(input);
  expect(result).not.toContain("```");
  expect(result).toContain("version: 1");
  expect(result).toContain("source:\n  cookbook:\n    title: \"Book\"");
});

test("preserves body content after frontmatter", () => {
  const input = "---\nyield: 4\n---\n\n# My Recipe\n\n## Ingredients\n\n- flour - 2 cups";
  const result = postprocessMarkdown(input);
  expect(result).toContain("# My Recipe\n\n## Ingredients\n\n- flour - 2 cups");
});
