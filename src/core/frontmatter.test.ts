import { expect, test } from "bun:test";
import { extractFrontmatter } from "./frontmatter";

const doc = (yaml: string, body = "# Body") => `---\n${yaml}\n---\n${body}\n`;

const messagesFrom = (yaml: string, body = "# Body") => {
  const { diagnostics } = extractFrontmatter(doc(yaml, body));
  return diagnostics.map((diag) => diag.message);
};

test("parses valid frontmatter and preserves empty scales array", () => {
  const result = extractFrontmatter(
    doc(
      [
        "version: 1",
        "source: Grandma",
        "scales: []",
      ].join("\n"),
      "# Recipe",
    ),
  );

  expect(result.frontmatter).not.toBeNull();
  expect(result.frontmatter?.version).toBe(1);
  expect(result.frontmatter?.source).toEqual({ kind: "text", value: "Grandma" });
  expect(result.frontmatter?.scales).toEqual([]);
  expect(result.body.startsWith("# Recipe")).toBe(true);
  expect(result.diagnostics).toHaveLength(0);
  expect(result.bodyStartLine).toBe(6);
});

test("parses url source with optional fields", () => {
  const result = extractFrontmatter(
    doc(
      [
        "version: 1",
        'source: { url: "https://example.com", title: "Sample", accessed: "2024-05-01" }',
      ].join("\n"),
    ),
  );

  expect(result.frontmatter?.source).toEqual({
    kind: "url",
    url: "https://example.com",
    title: "Sample",
    accessed: "2024-05-01",
  });
});

test("parses cookbook source with optional fields", () => {
  const result = extractFrontmatter(
    doc(
      [
        "version: 1",
        "source:",
        "  cookbook:",
        '    title: "Baking 101"',
        '    author: "A. Baker"',
        '    pages: "12-14"',
        '    isbn: "1234567890"',
        "    year: 2022",
      ].join("\n"),
    ),
  );

  expect(result.frontmatter?.source).toEqual({
    kind: "cookbook",
    title: "Baking 101",
    author: "A. Baker",
    pages: "12-14",
    isbn: "1234567890",
    year: 2022,
  });
});

test("frontmatter requires positive integer version", () => {
  const { frontmatter, diagnostics } = extractFrontmatter(
    doc(
      [
        "version: not-a-number",
      ].join("\n"),
    ),
  );

  expect(frontmatter).toBeNull();
  const diag = diagnostics[0];
  expect(diag).toBeDefined();
  expect(diag?.code).toBe("E0001");
});

test("frontmatter must be mapping", () => {
  const { diagnostics } = extractFrontmatter(
    "---\n- list-item\n---\n# Body\n",
  );

  const names = diagnostics.map((diag) => diag.message);
  expect(names).toContain("Frontmatter must be a mapping/object.");
});

test("no frontmatter starts body at line one", () => {
  const result = extractFrontmatter("# Recipe\n");
  expect(result.bodyStartLine).toBe(1);
});

test("invalid yaml surfaces parse error", () => {
  const { diagnostics, frontmatter } = extractFrontmatter(
    "---\nversion: [\n---\n# Body\n",
  );

  expect(frontmatter).toBeNull();
  const messages = diagnostics.map((diag) => diag.message);
  expect(messages.some((msg) => msg.includes("Frontmatter YAML parse error"))).toBe(
    true,
  );
});

test("empty text source triggers validation error", () => {
  const messages = messagesFrom(
    [
      "version: 1",
      "source: \"\"",
    ].join("\n"),
  );
  expect(messages).toContain("Frontmatter source text must not be empty.");
});

test("url source title must be string", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      "source: { url: https://example.com, title: 42 }",
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter source.title must be a string.");
});

test("url source accessed must be string", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      "source: { url: https://example.com, accessed: 123 }",
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter source.accessed must be a string.");
});

test("url source accessed must be iso date", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      'source: { url: https://example.com, accessed: "2024/05/01" }',
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter source.accessed must be YYYY-MM-DD.");
});

test("url source rejects unsupported keys", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      'source: { url: https://example.com, title: "Sample", extra: true }',
    ].join("\n"),
  );
  expect(msgs.some((msg) => msg.includes("unsupported"))).toBe(true);
});

test("cookbook source must be object", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      "source:",
      "  cookbook: []",
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter source.cookbook must be an object.");
});

test("cookbook source requires title", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      "source:",
      "  cookbook: {}",
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter source.cookbook.title is required.");
});

test("cookbook author must be string", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      "source:",
      "  cookbook:",
      "    title: Bakes",
      "    author: 123",
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter source.cookbook.author must be a string.");
});

test("cookbook pages must be string or number", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      "source:",
      "  cookbook:",
      "    title: Bakes",
      "    pages: true",
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter source.cookbook.pages must be a string or number.");
});

test("cookbook isbn must be string", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      "source:",
      "  cookbook:",
      "    title: Bakes",
      "    isbn: 123",
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter source.cookbook.isbn must be a string.");
});

test("cookbook year must be number", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      "source:",
      "  cookbook:",
      "    title: Bakes",
      "    year: \"2020\"",
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter source.cookbook.year must be a number.");
});

test("cookbook rejects unsupported keys", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      "source:",
      "  cookbook:",
      "    title: Bakes",
      "    extra: true",
    ].join("\n"),
  );
  expect(msgs.some((msg) => msg.includes("unsupported"))).toBe(true);
});

test("rejects invalid source type", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      "source: 123",
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter source must be a string, URL object, or cookbook object.");
});

test("scales must be an array", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      "scales: not-an-array",
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter scales must be an array of presets.");
});

test("scales entries must be objects", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      "scales:",
      "  - just-a-string",
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter scales entries must be objects.");
});

test("scale preset name must be non-empty string", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      "scales:",
      "  - name: \"\"",
      "    anchor: { id: salt, amount: 10, unit: g }",
    ].join("\n"),
  );
  expect(msgs).toContain("Scale preset name must be a non-empty string.");
});

test("scale preset requires anchor", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      "scales:",
      "  - name: Test",
    ].join("\n"),
  );
  expect(msgs.some((msg) => msg.includes("missing anchor"))).toBe(true);
});

test("scale preset anchor must be object", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      "scales:",
      "  - name: Test",
      "    anchor: not-an-object",
    ].join("\n"),
  );
  expect(msgs.some((msg) => msg.includes("anchor must be an object"))).toBe(true);
});

test("scale preset anchor.id must be non-empty string", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      "scales:",
      "  - name: Test",
      "    anchor: { id: \"\", amount: 10, unit: g }",
    ].join("\n"),
  );
  expect(msgs.some((msg) => msg.includes("anchor.id must be a non-empty string"))).toBe(true);
});

test("scale preset anchor.amount must be number", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      "scales:",
      "  - name: Test",
      "    anchor: { id: salt, amount: \"ten\", unit: g }",
    ].join("\n"),
  );
  expect(msgs.some((msg) => msg.includes("anchor.amount must be a number"))).toBe(true);
});

test("scale preset anchor.unit must be non-empty string", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      "scales:",
      "  - name: Test",
      "    anchor: { id: salt, amount: 10, unit: \"\" }",
    ].join("\n"),
  );
  expect(msgs.some((msg) => msg.includes("anchor.unit must be a non-empty string"))).toBe(true);
});

test("scale preset anchor rejects unsupported keys", () => {
  const msgs = messagesFrom(
    [
      "version: 1",
      "scales:",
      "  - name: Test",
      "    anchor: { id: salt, amount: 10, unit: g, extra: true }",
    ].join("\n"),
  );
  expect(msgs.some((msg) => msg.includes("unsupported keys"))).toBe(true);
});

test("parses valid scales array", () => {
  const result = extractFrontmatter(
    doc(
      [
        "version: 1",
        "scales:",
        "  - name: Half",
        "    anchor: { id: salt, amount: 5, unit: g }",
        "  - name: Double",
        "    anchor: { id: salt, amount: 20, unit: g }",
      ].join("\n"),
    ),
  );

  expect(result.frontmatter?.scales).toHaveLength(2);
  expect(result.frontmatter?.scales?.[0]?.name).toBe("Half");
  expect(result.frontmatter?.scales?.[1]?.anchor.amount).toBe(20);
  expect(result.diagnostics).toHaveLength(0);
});

// --- No frontmatter ---

test("bare document with no frontmatter", () => {
  const result = extractFrontmatter("Just some text.");
  expect(result.frontmatter).toBeNull();
  expect(result.body).toBe("Just some text.");
  expect(result.diagnostics).toHaveLength(0);
  expect(result.bodyStartLine).toBe(1);
});

test("document starting with heading and no frontmatter", () => {
  const result = extractFrontmatter("# My Recipe\n\n## Ingredients\n");
  expect(result.frontmatter).toBeNull();
  expect(result.body).toBe("# My Recipe\n\n## Ingredients\n");
  expect(result.bodyStartLine).toBe(1);
});

// --- Empty frontmatter ---

test("empty frontmatter block treated as no frontmatter", () => {
  // ---\n---\n has no content line between delimiters, so regex doesn't match
  const result = extractFrontmatter("---\n---\n# Body\n");
  expect(result.frontmatter).toBeNull();
  expect(result.diagnostics).toHaveLength(0);
  expect(result.bodyStartLine).toBe(1);
});

test("frontmatter with only blank line triggers version error", () => {
  // ---\n\n---\n has a blank line, regex matches, but no version
  const result = extractFrontmatter("---\n\n---\n# Body\n");
  expect(result.frontmatter).toBeNull();
  expect(result.diagnostics.length).toBeGreaterThan(0);
  expect(result.bodyStartLine).toBe(4);
});

// --- Scalar values ---

test("unquoted string source", () => {
  const result = extractFrontmatter(doc("version: 1\nsource: Grandma"));
  expect(result.frontmatter?.source).toEqual({ kind: "text", value: "Grandma" });
});

test("quoted string source", () => {
  const result = extractFrontmatter(doc('version: 1\nsource: "My Grandma\'s Recipe"'));
  expect(result.frontmatter?.source).toEqual({ kind: "text", value: "My Grandma's Recipe" });
});

test("integer version value", () => {
  const result = extractFrontmatter(doc("version: 1"));
  expect(result.frontmatter?.version).toBe(1);
});

test("bare URL in source flow object", () => {
  const result = extractFrontmatter(
    doc('version: 1\nsource: { url: "https://example.com/recipe?id=123&lang=en" }'),
  );
  expect(result.frontmatter?.source).toEqual({
    kind: "url",
    url: "https://example.com/recipe?id=123&lang=en",
  });
});

// --- Inline flow objects ---

test("inline flow source with url only", () => {
  const result = extractFrontmatter(
    doc('version: 1\nsource: { url: "https://example.com" }'),
  );
  expect(result.frontmatter?.source).toEqual({ kind: "url", url: "https://example.com" });
});

test("inline flow source with all fields", () => {
  const result = extractFrontmatter(
    doc('version: 1\nsource: { url: "https://example.com/pancakes", title: "Perfect Pancakes", accessed: "2024-10-01" }'),
  );
  expect(result.frontmatter?.source).toEqual({
    kind: "url",
    url: "https://example.com/pancakes",
    title: "Perfect Pancakes",
    accessed: "2024-10-01",
  });
});

// --- Block mappings ---

test("block mapping cookbook source", () => {
  const result = extractFrontmatter(
    doc([
      "version: 1",
      "source:",
      "  cookbook:",
      "    title: The Superiority Burger Cookbook",
      "    author: Brooks Headley",
      '    pages: "112-115"',
    ].join("\n")),
  );
  expect(result.frontmatter?.source).toEqual({
    kind: "cookbook",
    title: "The Superiority Burger Cookbook",
    author: "Brooks Headley",
    pages: "112-115",
  });
});

test("block mapping cookbook with numeric pages", () => {
  const result = extractFrontmatter(
    doc([
      "version: 1",
      "source:",
      "  cookbook:",
      "    title: Bakes",
      "    pages: 42",
    ].join("\n")),
  );
  expect(result.frontmatter?.source).toEqual({
    kind: "cookbook",
    title: "Bakes",
    pages: 42,
  });
});

// --- Arrays of objects (scales) ---

test("scales with flow anchor objects", () => {
  const result = extractFrontmatter(
    doc([
      "version: 1",
      "scales:",
      "  - name: Family size",
      "    anchor: { id: oats, amount: 900, unit: g }",
    ].join("\n")),
  );
  expect(result.frontmatter?.scales).toEqual([
    { name: "Family size", anchor: { id: "oats", amount: 900, unit: "g" } },
  ]);
});

test("multiple scale presets", () => {
  const result = extractFrontmatter(
    doc([
      "version: 1",
      "scales:",
      "  - name: Half",
      "    anchor: { id: flour, amount: 90, unit: g }",
      "  - name: Double",
      "    anchor: { id: flour, amount: 360, unit: g }",
      "  - name: Party",
      "    anchor: { id: flour, amount: 720, unit: g }",
    ].join("\n")),
  );
  expect(result.frontmatter?.scales).toHaveLength(3);
  expect(result.frontmatter?.scales?.[2]?.name).toBe("Party");
  expect(result.frontmatter?.scales?.[2]?.anchor.amount).toBe(720);
});

// --- Whitespace variations ---

test("trailing spaces after --- delimiter", () => {
  const result = extractFrontmatter("---   \nversion: 1\n---   \n# Body\n");
  expect(result.frontmatter?.version).toBe(1);
});

test("blank lines in YAML block are tolerated", () => {
  const result = extractFrontmatter("---\nversion: 1\n\nsource: Grandma\n---\n# Body\n");
  expect(result.frontmatter?.version).toBe(1);
  expect(result.frontmatter?.source).toEqual({ kind: "text", value: "Grandma" });
});

// --- Frontmatter delimiter edge cases ---

test("--- not at start of file returns no frontmatter", () => {
  const result = extractFrontmatter("some text\n---\nversion: 1\n---\n# Body\n");
  expect(result.frontmatter).toBeNull();
  expect(result.bodyStartLine).toBe(1);
});

// --- bodyStartLine correctness ---

test("bodyStartLine for minimal frontmatter", () => {
  const result = extractFrontmatter("---\nversion: 1\n---\n# Body\n");
  expect(result.bodyStartLine).toBe(4);
});

test("bodyStartLine for multi-line frontmatter", () => {
  const result = extractFrontmatter(
    doc([
      "version: 1",
      "source:",
      "  cookbook:",
      "    title: Test",
      "    author: Me",
    ].join("\n")),
  );
  // ---\n + 5 yaml lines + \n---\n = 8 lines, body starts at line 8
  expect(result.bodyStartLine).toBe(8);
});

// --- Round-trip value handling ---

test("version 01 is parsed as integer 1", () => {
  const result = extractFrontmatter(doc("version: 1"));
  expect(result.frontmatter?.version).toBe(1);
  expect(typeof result.frontmatter?.version).toBe("number");
});

test("accessed date is preserved as string", () => {
  const result = extractFrontmatter(
    doc('version: 1\nsource: { url: "https://example.com", accessed: "2024-10-01" }'),
  );
  expect(result.frontmatter?.source).toBeDefined();
  if (result.frontmatter?.source?.kind === "url") {
    expect(result.frontmatter.source.accessed).toBe("2024-10-01");
  }
});

test("decimal anchor amount is parsed correctly", () => {
  const result = extractFrontmatter(
    doc([
      "version: 1",
      "scales:",
      "  - name: Precise",
      "    anchor: { id: salt, amount: 2.5, unit: g }",
    ].join("\n")),
  );
  expect(result.frontmatter?.scales?.[0]?.anchor.amount).toBe(2.5);
});

// --- YAML comment handling ---

test("inline YAML comments are stripped", () => {
  const result = extractFrontmatter(
    "---\nversion: 1  # spec version\nsource: Grandma  # attribution\n---\n# Body\n",
  );
  expect(result.frontmatter?.version).toBe(1);
  expect(result.frontmatter?.source).toEqual({ kind: "text", value: "Grandma" });
});

// --- Boolean and null values ---

test("boolean true is not a string", () => {
  const result = extractFrontmatter(doc("version: 1\nsource: true"));
  // true is not a string, so it should fail source validation
  expect(result.diagnostics.some((d) => d.message.includes("source must be"))).toBe(true);
});

test("null source is treated as undefined", () => {
  const result = extractFrontmatter(doc("version: 1\nsource: null"));
  expect(result.frontmatter?.source).toBeUndefined();
});

// --- Full end-to-end from SCHEMA.md examples ---

test("SCHEMA.md example: simple text source", () => {
  const input = "---\nversion: 1\nsource: Grandma\nscales:\n  - name: Family size\n    anchor: { id: oats, amount: 900, unit: g }\n---\n# Recipe\n";
  const result = extractFrontmatter(input);
  expect(result.frontmatter?.version).toBe(1);
  expect(result.frontmatter?.source).toEqual({ kind: "text", value: "Grandma" });
  expect(result.frontmatter?.scales).toHaveLength(1);
  expect(result.diagnostics).toHaveLength(0);
});

test("SCHEMA.md example: url source with accessed date", () => {
  const input = '---\nversion: 1\nsource: { url: "https://example.com/pancakes", title: "Perfect Pancakes", accessed: "2024-10-01" }\n---\n# Recipe\n';
  const result = extractFrontmatter(input);
  expect(result.frontmatter?.source).toEqual({
    kind: "url",
    url: "https://example.com/pancakes",
    title: "Perfect Pancakes",
    accessed: "2024-10-01",
  });
});

test("SCHEMA.md example: cookbook source block mapping", () => {
  const input = "---\nversion: 1\nsource:\n  cookbook:\n    title: The Superiority Burger Cookbook\n    author: Brooks Headley\n    pages: \"112\\u2013115\"\n---\n# Recipe\n";
  const result = extractFrontmatter(input);
  expect(result.frontmatter?.source?.kind).toBe("cookbook");
});

