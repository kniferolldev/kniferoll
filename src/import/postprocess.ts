/**
 * Post-processing for LLM-generated Kniferoll Markdown.
 *
 * Deterministic fixups applied after the LLM produces output.
 * Defense-in-depth: the prompt asks for correct output, but
 * post-processing guarantees it.
 */

const FRONTMATTER_RE = /^---[ \t]*\n([\s\S]*?)\n---[ \t]*(?:\n|$)/;

/**
 * Strip markdown code fences that LLMs sometimes wrap around output.
 */
function stripCodeFences(text: string): string {
  let result = text.trim();
  result = result.replace(/^```(?:markdown|md|yaml|json|JSON)?\s*\n?/, "");
  result = result.replace(/\n?```\s*$/, "");
  return result.trim();
}

/**
 * Ensure frontmatter contains `version: 1`. If no frontmatter block exists,
 * prepend one. If frontmatter exists but is missing version, inject it as
 * the first field.
 */
function ensureVersion(text: string): string {
  const match = FRONTMATTER_RE.exec(text);

  if (!match) {
    // No frontmatter at all — prepend a minimal block
    return `---\nversion: 1\n---\n\n${text}`;
  }

  const yaml = match[1]!;
  if (/^version\s*:/m.test(yaml)) {
    return text; // Already has version
  }

  // Insert version as the first field
  const newYaml = `version: 1\n${yaml}`;
  return text.slice(0, match.index) + `---\n${newYaml}\n---\n` + text.slice(match.index + match[0].length);
}

/**
 * Expand inline flow objects in frontmatter to block style for readability.
 *
 * Converts:
 *   source: { cookbook: { title: "Book", author: "Author" } }
 * To:
 *   source:
 *     cookbook:
 *       title: Book
 *       author: Author
 */
function expandFrontmatterObjects(text: string): string {
  const match = FRONTMATTER_RE.exec(text);
  if (!match) return text;

  const yaml = match[1]!;
  const expanded = expandYamlLines(yaml);
  if (expanded === yaml) return text;

  return text.slice(0, match.index) + `---\n${expanded}\n---\n` + text.slice(match.index + match[0].length);
}

/**
 * Process YAML lines, expanding any inline flow objects to block style.
 */
function expandYamlLines(yaml: string): string {
  const lines = yaml.split("\n");
  const result: string[] = [];

  for (const line of lines) {
    const expanded = tryExpandLine(line);
    result.push(...expanded);
  }

  return result.join("\n");
}

/**
 * Try to expand a single YAML line containing an inline flow object.
 * Returns the original line (as array) if no expansion is needed.
 */
function tryExpandLine(line: string): string[] {
  // Find the key: {value} pattern
  const indent = line.match(/^(\s*)/)?.[1] ?? "";
  const content = line.slice(indent.length);

  // Match key: { ... }
  const keyMatch = content.match(/^([^:]+):\s*(\{.+\})\s*$/);
  if (!keyMatch) return [line];

  const key = keyMatch[1]!;
  const flowObj = keyMatch[2]!;

  // Parse the flow object
  const parsed = parseFlowObject(flowObj);
  if (!parsed) return [line];

  // Serialize as block style
  return serializeBlock(key, parsed, indent);
}

type FlowValue = {
  kind: "scalar";
  value: string;
} | {
  kind: "object";
  entries: [string, FlowValue][];
};

/**
 * Parse a YAML flow object like { key: val, key: { nested: val } }.
 */
function parseFlowObject(input: string): FlowValue | null {
  const result = parseFlowValueAt(input, 0);
  if (!result || result.value.kind !== "object") return null;
  return result.value;
}

function parseFlowValueAt(input: string, pos: number): { value: FlowValue; end: number } | null {
  pos = skipSpaces(input, pos);
  if (pos >= input.length) return null;

  if (input[pos] === "{") return parseFlowObjAt(input, pos);

  // Scalar — read until , or } or end
  let end = pos;
  let inQuote = false;
  while (end < input.length) {
    if (input[end] === '"') inQuote = !inQuote;
    if (!inQuote && (input[end] === "," || input[end] === "}")) break;
    end++;
  }
  const raw = input.slice(pos, end).trim();
  return { value: { kind: "scalar", value: raw }, end };
}

function parseFlowObjAt(input: string, pos: number): { value: FlowValue; end: number } | null {
  if (input[pos] !== "{") return null;
  pos++; // skip {

  const entries: [string, FlowValue][] = [];

  while (pos < input.length) {
    pos = skipSpaces(input, pos);
    if (input[pos] === "}") return { value: { kind: "object", entries }, end: pos + 1 };

    // Read key
    let keyEnd = pos;
    while (keyEnd < input.length && input[keyEnd] !== ":") keyEnd++;
    const key = input.slice(pos, keyEnd).trim();
    pos = keyEnd + 1; // skip :
    pos = skipSpaces(input, pos);

    // Read value
    const valResult = parseFlowValueAt(input, pos);
    if (!valResult) return null;
    entries.push([key, valResult.value]);
    pos = valResult.end;

    pos = skipSpaces(input, pos);
    if (input[pos] === ",") pos++;
  }

  return null; // unterminated
}

function skipSpaces(s: string, pos: number): number {
  while (pos < s.length && s[pos] === " ") pos++;
  return pos;
}

/**
 * Serialize a parsed flow value as block-style YAML lines.
 */
function serializeBlock(key: string, value: FlowValue, indent: string): string[] {
  if (value.kind === "scalar") {
    return [`${indent}${key}: ${value.value}`];
  }

  const lines: string[] = [`${indent}${key}:`];
  const childIndent = indent + "  ";
  for (const [k, v] of value.entries) {
    lines.push(...serializeBlock(k, v, childIndent));
  }
  return lines;
}

/**
 * Post-process LLM-generated Kniferoll Markdown.
 *
 * Applied to output from both standard and agent pipelines:
 * 1. Strip code fences (defense-in-depth — prompt also asks for no fences)
 * 2. Ensure frontmatter has version: 1
 * 3. Expand inline YAML objects to block style for readability
 */
export function postprocessMarkdown(markdown: string): string {
  let result = stripCodeFences(markdown);
  result = ensureVersion(result);
  result = expandFrontmatterObjects(result);
  return result;
}
