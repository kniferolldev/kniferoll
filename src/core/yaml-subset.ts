/**
 * Minimal YAML parser for recipe.md frontmatter.
 *
 * Supports only the subset used by the frontmatter spec:
 * - key: value mappings (block style)
 * - Indentation-based nesting
 * - Inline flow objects: { key: val, key: val }
 * - Inline flow arrays: [item, item]
 * - Array items: - key: value
 * - Quoted strings ("...")
 * - Unquoted scalars: strings, numbers, booleans, null
 * - Comments (# ...)
 */

type YamlValue =
  | string
  | number
  | boolean
  | null
  | YamlValue[]
  | { [key: string]: YamlValue };

export function parseYamlSubset(input: string): YamlValue {
  const lines = input.split("\n");
  const result = parseBlock(lines, 0);
  return result.value;
}

interface ParseResult {
  value: YamlValue;
  nextLine: number;
}

function stripComment(line: string): string {
  // Strip trailing comments, but not inside quoted strings
  let inQuote = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      inQuote = !inQuote;
    } else if (line[i] === "#" && !inQuote && (i === 0 || line[i - 1] === " ")) {
      return line.slice(0, i).trimEnd();
    }
  }
  return line;
}

function getIndent(line: string): number {
  let indent = 0;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === " ") indent++;
    else break;
  }
  return indent;
}

function isBlankOrComment(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === "" || trimmed.startsWith("#");
}

function parseScalar(value: string): YamlValue {
  if (value === "" || value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;

  // Quoted string
  if (value.startsWith('"') && value.endsWith('"')) {
    return value
      .slice(1, -1)
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  if (value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }

  // Number
  if (/^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)) {
    const num = Number(value);
    if (!Number.isNaN(num)) return num;
  }

  // Everything else is a string
  return value;
}

function parseFlowValue(input: string, pos: number): { value: YamlValue; end: number } {
  // Skip whitespace
  while (pos < input.length && input[pos] === " ") pos++;

  if (pos >= input.length) return { value: null, end: pos };

  if (input[pos] === "{") return parseFlowObject(input, pos);
  if (input[pos] === "[") return parseFlowArray(input, pos);

  // Scalar value - read until , or } or ]
  if (input[pos] === '"') {
    // Quoted string
    let end = pos + 1;
    while (end < input.length && input[end] !== '"') {
      if (input[end] === "\\") end++; // skip escaped char
      end++;
    }
    end++; // past closing quote
    const raw = input.slice(pos, end);
    return { value: parseScalar(raw), end };
  }

  // Unquoted scalar in flow context
  let end = pos;
  while (end < input.length && input[end] !== "," && input[end] !== "}" && input[end] !== "]") {
    end++;
  }
  const raw = input.slice(pos, end).trim();
  return { value: parseScalar(raw), end };
}

function parseFlowObject(input: string, pos: number): { value: YamlValue; end: number } {
  const obj: Record<string, YamlValue> = {};
  pos++; // skip {

  while (pos < input.length) {
    // Skip whitespace
    while (pos < input.length && input[pos] === " ") pos++;
    if (input[pos] === "}") return { value: obj, end: pos + 1 };

    // Read key
    let keyEnd = pos;
    while (keyEnd < input.length && input[keyEnd] !== ":") keyEnd++;
    const key = input.slice(pos, keyEnd).trim();
    pos = keyEnd + 1; // skip :

    // Skip space after colon
    while (pos < input.length && input[pos] === " ") pos++;

    // Read value
    const { value, end } = parseFlowValue(input, pos);
    obj[key] = value;
    pos = end;

    // Skip whitespace and comma
    while (pos < input.length && input[pos] === " ") pos++;
    if (input[pos] === ",") pos++;
  }

  throw new Error("Unterminated flow object (missing closing '}')")
}

function parseFlowArray(input: string, pos: number): { value: YamlValue; end: number } {
  const arr: YamlValue[] = [];
  pos++; // skip [

  while (pos < input.length) {
    while (pos < input.length && input[pos] === " ") pos++;
    if (input[pos] === "]") return { value: arr, end: pos + 1 };

    const { value, end } = parseFlowValue(input, pos);
    arr.push(value);
    pos = end;

    while (pos < input.length && input[pos] === " ") pos++;
    if (input[pos] === ",") pos++;
  }

  throw new Error("Unterminated flow array (missing closing ']')");
}

function parseBlock(lines: string[], startLine: number): ParseResult {
  // Determine what kind of block this is by looking at the first non-blank line
  let firstContentLine = startLine;
  while (firstContentLine < lines.length && isBlankOrComment(lines[firstContentLine]!)) {
    firstContentLine++;
  }

  if (firstContentLine >= lines.length) {
    return { value: null, nextLine: firstContentLine };
  }

  const firstLine = lines[firstContentLine]!;
  const trimmed = firstLine.trimStart();

  // Array item
  if (trimmed.startsWith("- ") || trimmed === "-") {
    return parseBlockArray(lines, firstContentLine, getIndent(firstLine));
  }

  // Mapping (key: value)
  if (trimmed.includes(":")) {
    return parseBlockMapping(lines, firstContentLine);
  }

  // Plain scalar
  return { value: parseScalar(stripComment(trimmed)), nextLine: firstContentLine + 1 };
}

function parseBlockMapping(lines: string[], startLine: number): ParseResult {
  const obj: Record<string, YamlValue> = {};
  let lineIdx = startLine;
  let mappingIndent = -1;

  while (lineIdx < lines.length) {
    const line = lines[lineIdx]!;

    if (isBlankOrComment(line)) {
      lineIdx++;
      continue;
    }

    const indent = getIndent(line);
    if (mappingIndent === -1) {
      mappingIndent = indent;
    }

    if (indent < mappingIndent) break;
    if (indent > mappingIndent) break; // belongs to a parent or child

    const stripped = stripComment(line).trimStart();

    // Must be key: value
    const colonIdx = findKeyColon(stripped);
    if (colonIdx === -1) {
      lineIdx++;
      continue;
    }

    const key = stripped.slice(0, colonIdx).trim();
    const valueStr = stripped.slice(colonIdx + 1).trim();

    if (valueStr === "" || valueStr === "|" || valueStr === ">") {
      // Value is on subsequent indented lines (block child)
      lineIdx++;
      const childResult = parseBlock(lines, lineIdx);
      obj[key] = childResult.value;
      lineIdx = childResult.nextLine;
    } else if (valueStr.startsWith("{")) {
      // Inline flow object
      const { value } = parseFlowObject(valueStr, 0);
      obj[key] = value;
      lineIdx++;
    } else if (valueStr.startsWith("[")) {
      // Inline flow array
      const { value } = parseFlowArray(valueStr, 0);
      obj[key] = value;
      lineIdx++;
    } else {
      // Simple scalar value
      obj[key] = parseScalar(valueStr);
      lineIdx++;
    }
  }

  return { value: obj, nextLine: lineIdx };
}

function parseBlockArray(lines: string[], startLine: number, arrayIndent: number): ParseResult {
  const arr: YamlValue[] = [];
  let lineIdx = startLine;

  while (lineIdx < lines.length) {
    const line = lines[lineIdx]!;

    if (isBlankOrComment(line)) {
      lineIdx++;
      continue;
    }

    const indent = getIndent(line);
    if (indent < arrayIndent) break;
    if (indent > arrayIndent) break;

    const stripped = stripComment(line).trimStart();
    if (!stripped.startsWith("- ") && stripped !== "-") break;

    const itemContent = stripped.slice(2).trim();

    if (itemContent === "" || itemContent === "|" || itemContent === ">") {
      // Empty array item or block content
      lineIdx++;
      const childResult = parseBlock(lines, lineIdx);
      arr.push(childResult.value);
      lineIdx = childResult.nextLine;
    } else if (itemContent.startsWith("{")) {
      const { value } = parseFlowObject(itemContent, 0);
      arr.push(value);
      lineIdx++;
    } else if (itemContent.startsWith("[")) {
      const { value } = parseFlowArray(itemContent, 0);
      arr.push(value);
      lineIdx++;
    } else {
      // Could be "- key: value" starting a mapping
      const colonIdx = findKeyColon(itemContent);
      if (colonIdx !== -1) {
        // This is an array item that starts a mapping
        // Collect the first key:value, then continue with indented lines
        const key = itemContent.slice(0, colonIdx).trim();
        const valueStr = itemContent.slice(colonIdx + 1).trim();

        const itemObj: Record<string, YamlValue> = {};

        if (valueStr === "") {
          lineIdx++;
          const childResult = parseBlock(lines, lineIdx);
          itemObj[key] = childResult.value;
          lineIdx = childResult.nextLine;
        } else if (valueStr.startsWith("{")) {
          const { value } = parseFlowObject(valueStr, 0);
          itemObj[key] = value;
          lineIdx++;
        } else if (valueStr.startsWith("[")) {
          const { value } = parseFlowArray(valueStr, 0);
          itemObj[key] = value;
          lineIdx++;
        } else {
          itemObj[key] = parseScalar(valueStr);
          lineIdx++;
        }

        // Read remaining keys at indent + 2 or greater
        const itemIndent = indent + 2;
        while (lineIdx < lines.length) {
          const nextLine = lines[lineIdx]!;
          if (isBlankOrComment(nextLine)) {
            lineIdx++;
            continue;
          }
          const nextIndent = getIndent(nextLine);
          if (nextIndent < itemIndent) break;

          const nextStripped = stripComment(nextLine).trimStart();
          const nextColon = findKeyColon(nextStripped);
          if (nextColon === -1 || nextIndent !== itemIndent) break;

          const nextKey = nextStripped.slice(0, nextColon).trim();
          const nextValueStr = nextStripped.slice(nextColon + 1).trim();

          if (nextValueStr === "") {
            lineIdx++;
            const childResult = parseBlock(lines, lineIdx);
            itemObj[nextKey] = childResult.value;
            lineIdx = childResult.nextLine;
          } else if (nextValueStr.startsWith("{")) {
            const { value } = parseFlowObject(nextValueStr, 0);
            itemObj[nextKey] = value;
            lineIdx++;
          } else if (nextValueStr.startsWith("[")) {
            const { value } = parseFlowArray(nextValueStr, 0);
            itemObj[nextKey] = value;
            lineIdx++;
          } else {
            itemObj[nextKey] = parseScalar(nextValueStr);
            lineIdx++;
          }
        }

        arr.push(itemObj);
      } else {
        // Plain scalar array item
        arr.push(parseScalar(itemContent));
        lineIdx++;
      }
    }
  }

  return { value: arr, nextLine: lineIdx };
}

/** Find the colon that separates key from value (not inside quotes). */
function findKeyColon(s: string): number {
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '"') inQuote = !inQuote;
    else if (s[i] === ":" && !inQuote && (i + 1 >= s.length || s[i + 1] === " ")) {
      return i;
    }
  }
  return -1;
}
