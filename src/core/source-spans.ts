/**
 * Source span computation for inline editing.
 * Determines which source lines each parsed element occupies,
 * accounting for continuation lines in steps and ingredients.
 */

import type { DocumentParseResult } from "./types";

export interface SourceSpan {
  /** 1-based start line (inclusive) */
  startLine: number;
  /** 1-based end line (inclusive) */
  endLine: number;
}

/**
 * Compute the source span (range of lines) for each element in a parsed document.
 *
 * For elements with continuation lines (wrapped steps, multi-line ingredients),
 * the span covers all source lines until the next element or section boundary.
 *
 * @param markdownLines - Array of raw markdown lines
 * @param parseResult - The parsed document result
 * @returns Map keyed by element's 1-based start line number to its SourceSpan
 */
export function computeSourceSpans(
  markdownLines: string[],
  parseResult: DocumentParseResult,
): Map<number, SourceSpan> {
  const spans = new Map<number, SourceSpan>();

  // Collect all element start lines with their section context
  const elementLines: number[] = [];

  // Add recipe title lines
  for (const recipe of parseResult.recipes) {
    elementLines.push(recipe.line);

    // Add intro paragraph start lines
    if (recipe.intro) {
      const firstSectionLine =
        recipe.sections.length > 0 ? recipe.sections[0]!.line : undefined;
      const introEnd =
        firstSectionLine != null ? firstSectionLine - 1 : markdownLines.length;
      let inParagraph = false;
      for (let i = recipe.line + 1; i <= introEnd; i++) {
        const lineText = (markdownLines[i - 1] ?? "").trim();
        if (lineText === "") {
          inParagraph = false;
        } else if (!inParagraph) {
          elementLines.push(i);
          inParagraph = true;
        }
      }
    }

    for (const section of recipe.sections) {
      // Section heading
      elementLines.push(section.line);

      if (section.kind === "ingredients") {
        for (const ingredient of section.ingredients) {
          elementLines.push(ingredient.line);
        }
      } else if (section.kind === "notes") {
        // After unwrapping, each non-empty line is a logical block
        for (const line of section.lines) {
          if (line.text.trim() !== "") {
            elementLines.push(line.line);
          }
        }
      } else {
        for (const line of section.lines) {
          if (line.text.trim() !== "") {
            elementLines.push(line.line);
          }
        }
      }
    }
  }

  // Document title
  if (parseResult.documentTitle) {
    elementLines.push(parseResult.documentTitle.line);
  }

  // Sort and deduplicate
  const sortedLines = [...new Set(elementLines)].sort((a, b) => a - b);

  // For each element line, compute the span
  for (let i = 0; i < sortedLines.length; i++) {
    const startLine = sortedLines[i]!;
    const nextElementLine = sortedLines[i + 1];

    // The end line is determined by scanning forward from startLine
    // until we hit the next element, a heading, or a blank line that's
    // followed by non-continuation content
    let endLine = startLine;

    if (nextElementLine !== undefined) {
      // Span extends up to but not including the next element's line,
      // but skip trailing blank lines
      let candidate = nextElementLine - 1;
      while (candidate > startLine && isBlankLine(markdownLines, candidate)) {
        candidate--;
      }
      endLine = candidate;
    } else {
      // Last element: scan to end of content
      let candidate = startLine;
      while (candidate < markdownLines.length) {
        const nextIdx = candidate; // 0-based
        if (nextIdx >= markdownLines.length) break;
        const nextLine = markdownLines[nextIdx]!;
        // Stop at headings
        if (/^#{1,6}\s+/.test(nextLine.trim())) break;
        // If blank, check if there's more continuation content ahead
        if (nextLine.trim() === "") {
          // Look ahead for continuation (indented non-blank)
          let hasMore = false;
          for (let j = candidate + 1; j < markdownLines.length; j++) {
            const ahead = markdownLines[j]!;
            if (ahead.trim() === "") continue;
            if (/^#{1,6}\s+/.test(ahead.trim())) break;
            if (/^\s+\S/.test(ahead) || /^\d+\.\s+/.test(ahead.trim()) || /^-\s+/.test(ahead.trim())) {
              break;
            }
            hasMore = true;
            break;
          }
          if (!hasMore) break;
        }
        candidate++;
      }
      endLine = Math.max(startLine, candidate);
      // Trim trailing blank lines
      while (endLine > startLine && isBlankLine(markdownLines, endLine)) {
        endLine--;
      }
    }

    spans.set(startLine, { startLine, endLine });
  }

  return spans;
}

function isBlankLine(lines: string[], oneBasedLine: number): boolean {
  const idx = oneBasedLine - 1;
  if (idx < 0 || idx >= lines.length) return true;
  return lines[idx]!.trim() === "";
}
