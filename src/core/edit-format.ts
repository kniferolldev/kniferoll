/**
 * Pure formatting utilities for inline editing.
 * Reconstructs ingredient markdown lines from structured fields,
 * and splices line edits into markdown documents.
 */

/**
 * Reconstruct a markdown ingredient line from structured fields.
 *
 * Format: `- name - quantity, modifiers :: attributes`
 *
 * @param name - Ingredient name (required)
 * @param quantity - Quantity text like "2 cups" (optional)
 * @param modifiers - Modifier text like "sifted" (optional)
 * @param attributeTail - Raw attribute string like "id=rice also=12oz" (preserved verbatim, optional)
 */
export function reconstructIngredientLine(
  name: string,
  quantity: string | null,
  modifiers: string | null,
  attributeTail: string | null,
): string {
  let line = `- ${name}`;

  if (quantity) {
    line += ` - ${quantity}`;
    if (modifiers) {
      line += `, ${modifiers}`;
    }
  } else if (modifiers) {
    line += `, ${modifiers}`;
  }

  if (attributeTail) {
    line += ` :: ${attributeTail}`;
  }

  return line;
}

/**
 * Extract the `:: ...` attribute portion from an original ingredient line.
 * Returns null if no attribute tail is present.
 */
export function getAttributeTail(originalLineText: string): string | null {
  const trimmed = originalLineText.trim();
  // Match the :: delimiter with spaces on both sides
  const match = trimmed.match(/\s+::\s+(.*)$/);
  if (match) {
    return match[1]?.trim() || null;
  }
  return null;
}

/**
 * Splice line edits into a markdown string.
 *
 * @param markdown - The full markdown document
 * @param edits - Map of 1-based line number to new text (null to delete the line)
 * @returns The updated markdown string
 */
export function applyLineEdits(
  markdown: string,
  edits: Map<number, string | null>,
): string {
  if (edits.size === 0) {
    return markdown;
  }

  const lines = markdown.split("\n");
  const result: string[] = [];

  for (let i = 0; i < lines.length; i++) {
    const lineNumber = i + 1; // 1-based
    if (edits.has(lineNumber)) {
      const replacement = edits.get(lineNumber);
      if (replacement !== null) {
        result.push(replacement!);
      }
      // null means delete - don't push anything
    } else {
      result.push(lines[i]!);
    }
  }

  return result.join("\n");
}

/**
 * Get the raw text for a range of source lines from markdown.
 *
 * @param markdown - The full markdown document
 * @param startLine - 1-based start line (inclusive)
 * @param endLine - 1-based end line (inclusive)
 * @returns The raw text of those lines joined with newlines
 */
export function getSourceLines(
  markdown: string,
  startLine: number,
  endLine: number,
): string {
  const lines = markdown.split("\n");
  return lines.slice(startLine - 1, endLine).join("\n");
}

/**
 * Build an edits map that replaces a span of lines with a single new line.
 * The first line in the span gets the new text; subsequent lines are deleted.
 */
export function buildSpanEdit(
  startLine: number,
  endLine: number,
  newText: string,
): Map<number, string | null> {
  const edits = new Map<number, string | null>();
  edits.set(startLine, newText);
  for (let i = startLine + 1; i <= endLine; i++) {
    edits.set(i, null);
  }
  return edits;
}

/**
 * Join continuation lines into a single line of text.
 * Trims each line and joins with a single space, collapsing
 * any extra whitespace.
 */
export function unwrapText(raw: string): string {
  if (!raw) return "";
  return raw
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .join(" ")
    .replace(/  +/g, " ");
}

/**
 * Split a markdown line into its structural prefix and content.
 *
 * Recognized prefixes:
 * - Step numbers: "1. ", "12.  "
 * - Bullets: "- ", "* "
 * - Headers: "### ", "#### "
 *
 * Returns { prefix, content } where prefix is the matched portion
 * (including trailing space) and content is the rest.
 */
export function splitPrefix(text: string): { prefix: string; content: string } {
  if (!text) return { prefix: "", content: "" };

  // Step number: digits, dot, one or more spaces
  const stepMatch = text.match(/^(\d+\.\s+)/);
  if (stepMatch) {
    return { prefix: stepMatch[1]!, content: text.slice(stepMatch[1]!.length) };
  }

  // Header: 3-6 hash marks followed by space
  const headerMatch = text.match(/^(#{3,6}\s+)/);
  if (headerMatch) {
    return {
      prefix: headerMatch[1]!,
      content: text.slice(headerMatch[1]!.length),
    };
  }

  // Bullet: - or * followed by space
  const bulletMatch = text.match(/^([-*]\s+)/);
  if (bulletMatch) {
    return {
      prefix: bulletMatch[1]!,
      content: text.slice(bulletMatch[1]!.length),
    };
  }

  return { prefix: "", content: text };
}

/**
 * Rewrap an entire markdown document to a consistent line width.
 *
 * Steps, bullets, paragraphs, and sub-headers are unwrapped and re-wrapped
 * with proper continuation-line indentation. Frontmatter, recipe titles (#),
 * section headers (##), ingredient sections, and blank lines pass through
 * unchanged.
 */
export function rewrapMarkdown(markdown: string, maxWidth = 80): string {
  const lines = markdown.split("\n");
  const result: string[] = [];
  let inFrontmatter = false;
  let seenFrontmatterOpen = false;
  let inIngredients = false;
  let blockLines: string[] = [];

  const flushBlock = () => {
    if (blockLines.length === 0) return;
    const joined = blockLines.map((l) => l.trim()).join(" ");
    const { prefix } = splitPrefix(joined);
    result.push(wrapLine(joined, prefix.length, maxWidth));
    blockLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    // Frontmatter delimiters
    if (trimmed === "---") {
      flushBlock();
      if (!seenFrontmatterOpen) {
        seenFrontmatterOpen = true;
        inFrontmatter = true;
      } else if (inFrontmatter) {
        inFrontmatter = false;
      }
      result.push(line);
      continue;
    }
    if (inFrontmatter) {
      result.push(line);
      continue;
    }

    // Section headers (##) — track ingredient sections
    if (/^##\s+/.test(trimmed)) {
      flushBlock();
      inIngredients = /^##\s+ingredients\s*$/i.test(trimmed);
      result.push(line);
      continue;
    }

    // Recipe titles (#) — reset section tracking
    if (/^#\s+/.test(trimmed) && !/^##/.test(trimmed)) {
      flushBlock();
      inIngredients = false;
      result.push(line);
      continue;
    }

    // Ingredient sections pass through unchanged
    if (inIngredients) {
      result.push(line);
      continue;
    }

    // Blank lines end current block
    if (trimmed === "") {
      flushBlock();
      result.push(line);
      continue;
    }

    // Detect block starters
    const isStep = /^\d+\.\s+/.test(trimmed);
    const isBullet = /^[-*]\s+/.test(trimmed);
    const isSubHeader = /^#{3,6}\s+/.test(trimmed);

    if (isStep || isBullet || isSubHeader) {
      flushBlock();
      if (isSubHeader) {
        // Headers don't accept continuations — emit immediately
        const { prefix } = splitPrefix(trimmed);
        result.push(wrapLine(trimmed, prefix.length, maxWidth));
      } else {
        blockLines = [trimmed];
      }
    } else if (blockLines.length > 0) {
      // Continuation of current block
      blockLines.push(trimmed);
    } else {
      // Start new paragraph
      blockLines = [trimmed];
    }
  }

  flushBlock();

  return result.join("\n");
}

/**
 * Wrap text to a maximum line width, indenting continuation lines.
 *
 * The first line is kept as-is up to maxWidth. Continuation lines
 * are indented by `continuationIndent` spaces. Words are never broken.
 *
 * @param text - The full text including any prefix (e.g. "1. Step text")
 * @param continuationIndent - Number of spaces to indent continuation lines
 * @param maxWidth - Maximum line width (default 80)
 */
export function wrapLine(
  text: string,
  continuationIndent: number,
  maxWidth = 80,
): string {
  if (!text || text.length <= maxWidth) return text;

  const indent = " ".repeat(continuationIndent);
  const words = text.split(/\s+/).filter((w) => w);
  if (words.length === 0) return text;

  const lines: string[] = [];
  let currentLine = words[0]!;

  for (let i = 1; i < words.length; i++) {
    const word = words[i]!;
    const candidate = currentLine + " " + word;
    // First line: check against maxWidth directly
    // Continuation lines: check content against maxWidth - indent
    const limit =
      lines.length === 0 ? maxWidth : maxWidth - continuationIndent;
    if (candidate.length <= limit) {
      currentLine = candidate;
    } else if (!currentLine.includes(" ")) {
      // Don't orphan a single token (e.g. "1." or "-") on its own line
      currentLine = candidate;
    } else {
      lines.push(currentLine);
      currentLine = word;
    }
  }
  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.map((line, i) => (i === 0 ? line : indent + line)).join("\n");
}
