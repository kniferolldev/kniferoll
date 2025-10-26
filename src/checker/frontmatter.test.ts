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
        "version: 0.1.0",
        "source: Grandma",
        "scales: []",
      ].join("\n"),
      "# Recipe",
    ),
  );

  expect(result.frontmatter).not.toBeNull();
  expect(result.frontmatter?.version).toBe("0.1.0");
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
        "version: 1.2.3",
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
        "version: 0.1.0",
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

test("frontmatter requires semantic version", () => {
  const { frontmatter, diagnostics } = extractFrontmatter(
    doc(
      [
        "version: not-a-semver",
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
      "version: 0.1.0",
      "source: \"\"",
    ].join("\n"),
  );
  expect(messages).toContain("Frontmatter source text must not be empty.");
});

test("url source title must be string", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      "source: { url: https://example.com, title: 42 }",
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter source.title must be a string.");
});

test("url source accessed must be string", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      "source: { url: https://example.com, accessed: 123 }",
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter source.accessed must be a string.");
});

test("url source accessed must be iso date", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      'source: { url: https://example.com, accessed: "2024/05/01" }',
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter source.accessed must be YYYY-MM-DD.");
});

test("url source rejects unsupported keys", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      "source: { url: https://example.com, extra: true }",
    ].join("\n"),
  );
  expect(
    msgs.some((msg) =>
      msg.startsWith("Frontmatter source contains unsupported keys"),
    ),
  ).toBe(true);
});

test("cookbook source must be object", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      "source: { cookbook: 42 }",
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter source.cookbook must be an object.");
});

test("cookbook source requires title", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      "source:",
      "  cookbook:",
      "    author: Someone",
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter source.cookbook.title is required.");
});

test("cookbook author must be string", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      "source:",
      "  cookbook:",
      "    title: Sample",
      "    author: 12",
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter source.cookbook.author must be a string.");
});

test("cookbook pages must be string or number", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      "source:",
      "  cookbook:",
      "    title: Sample",
      "    pages: true",
    ].join("\n"),
  );
  expect(
    msgs,
  ).toContain("Frontmatter source.cookbook.pages must be a string or number.");
});

test("cookbook isbn must be string", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      "source:",
      "  cookbook:",
      "    title: Sample",
      "    isbn: 123456",
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter source.cookbook.isbn must be a string.");
});

test("cookbook year must be number", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      "source:",
      "  cookbook:",
      "    title: Sample",
      "    year: \"2023\"",
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter source.cookbook.year must be a number.");
});

test("cookbook rejects unsupported keys", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      "source:",
      "  cookbook:",
      "    title: Sample",
      "    edition: 2",
    ].join("\n"),
  );
  expect(
    msgs.some((msg) =>
      msg.startsWith("Frontmatter source.cookbook contains unsupported keys"),
    ),
  ).toBe(true);
});

test("fallback source validation error for unsupported type", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      "source: 42",
    ].join("\n"),
  );
  expect(
    msgs,
  ).toContain(
    "Frontmatter source must be a string, URL object, or cookbook object.",
  );
});

test("scales must be array", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      "scales: 5",
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter scales must be an array of presets.");
});

test("scale entries must be objects", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      "scales: [1]",
    ].join("\n"),
  );
  expect(msgs).toContain("Frontmatter scales entries must be objects.");
});

test("scale name must be non-empty string", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      "scales:",
      "  - anchor: { id: milk, amount: 480, unit: ml }",
    ].join("\n"),
  );
  expect(msgs).toContain("Scale preset name must be a non-empty string.");
});

test("scale preset requires anchor", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      "scales:",
      "  - name: Batch",
    ].join("\n"),
  );
  expect(msgs).toContain('Scale preset "Batch" is missing anchor.');
});

test("scale anchor must be object", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      "scales:",
      "  - name: Batch",
      "    anchor: 5",
    ].join("\n"),
  );
  expect(msgs).toContain('Scale preset "Batch" anchor must be an object.');
});

test("scale anchor id required", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      "scales:",
      "  - name: Batch",
      "    anchor: { id: \"\", amount: 1, unit: g }",
    ].join("\n"),
  );
  expect(
    msgs,
  ).toContain('Scale preset "Batch" anchor.id must be a non-empty string.');
});

test("scale anchor amount must be number", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      "scales:",
      "  - name: Batch",
      '    anchor: { id: milk, amount: "a lot", unit: ml }',
    ].join("\n"),
  );
  expect(
    msgs,
  ).toContain('Scale preset "Batch" anchor.amount must be a number.');
});

test("scale anchor unit required", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      "scales:",
      "  - name: Batch",
      "    anchor: { id: milk, amount: 10, unit: \"\" }",
    ].join("\n"),
  );
  expect(
    msgs,
  ).toContain('Scale preset "Batch" anchor.unit must be a non-empty string.');
});

test("scale anchor id must match known ids when provided", () => {
  const result = extractFrontmatter(
    doc(
      [
        "version: 0.1.0",
        "scales:",
        "  - name: Batch",
        "    anchor: { id: milk, amount: 10, unit: ml }",
      ].join("\n"),
    ),
    { knownIds: ["flour"] },
  );

  const msgs = result.diagnostics.map((diag) => diag.message);
  expect(
    msgs,
  ).toContain(
    'Scale preset "Batch" anchor.id "milk" does not match any known ingredient.',
  );
});

test("scale anchor rejects unsupported keys", () => {
  const msgs = messagesFrom(
    [
      "version: 0.1.0",
      "scales:",
      "  - name: Batch",
      "    anchor: { id: milk, amount: 10, unit: ml, extra: yes }",
    ].join("\n"),
  );
  expect(
    msgs.some((msg) =>
      msg.startsWith('Scale preset "Batch" anchor contains unsupported keys'),
    ),
  ).toBe(true);
});
