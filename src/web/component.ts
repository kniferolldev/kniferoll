/// <reference lib="dom" />

import { parseDocument } from "../core/parser";
import { computeScaleFactor } from "../core/scale";
import { scaleQuantity } from "../core/scale-quantity";
import { formatQuantity, numberToFractionText } from "../core/format";
import { isMetric as isMetricSystem, lookupUnit } from "../core/units";
import { readNumber } from "../core/quantity";
import { slug } from "../core/slug";
import { computeSourceSpans } from "../core/source-spans";
import { applyLineEdits } from "../core/edit-format";
import { setupEditInteractions } from "./edit";
import BASE_STYLE from "./styles.css" with { type: "text" };
import type {
  Diagnostic,
  DocumentParseResult,
  DocumentInlineTemperatureValue,
  DocumentInlineQuantityValue,
  DocumentInlineValueAny,
  Ingredient,
  IngredientAttribute,
  IngredientsSection,
  Quantity,
  Recipe,
  TextBlock,
  UnitDimension,
  ScalePreset,
  ScaleSelection,
  SectionLine,
  Source,
  StepsSection,
} from "../core/types";
import type { DiffAnnotation, AttributeDiff, InlineDiffToken } from "../core/diff";

const TAG_NAME = "kr-recipe";

// No separate icon — the scale toggle is a chip showing the current scale label

const CAUTION_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
const ANCHOR_ICON_SVG = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="22"/><path d="M5 12H2a10 10 0 0020 0h-3"/></svg>';
const ANCHOR_ICON_SMALL_SVG = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="3"/><line x1="12" y1="8" x2="12" y2="22"/><path d="M5 12H2a10 10 0 0020 0h-3"/></svg>';


const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const escapeAttr = (value: string): string => escapeHtml(value);

const renderMarkdownInline = (text: string): string => {
  const tokens: { start: number; end: number; html: string }[] = [];

  // Bold: **text**
  for (const match of text.matchAll(/\*\*([^*]+)\*\*/g)) {
    tokens.push({
      start: match.index!,
      end: match.index! + match[0].length,
      html: `<strong>${escapeHtml(match[1]!)}</strong>`,
    });
  }

  // Italic: *text* (but not inside **)
  for (const match of text.matchAll(/(?<!\*)\*([^*]+)\*(?!\*)/g)) {
    const overlaps = tokens.some(
      (t) => match.index! >= t.start && match.index! < t.end,
    );
    if (!overlaps) {
      tokens.push({
        start: match.index!,
        end: match.index! + match[0].length,
        html: `<em>${escapeHtml(match[1]!)}</em>`,
      });
    }
  }

  // Links: [text](url)
  for (const match of text.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g)) {
    tokens.push({
      start: match.index!,
      end: match.index! + match[0].length,
      html: `<a href="${escapeAttr(match[2]!)}" target="_blank" rel="noopener noreferrer">${escapeHtml(match[1]!)}</a>`,
    });
  }

  tokens.sort((a, b) => a.start - b.start);
  const parts: string[] = [];
  let cursor = 0;
  for (const token of tokens) {
    if (token.start < cursor) continue;
    parts.push(escapeHtml(text.slice(cursor, token.start)));
    parts.push(token.html);
    cursor = token.end;
  }
  parts.push(escapeHtml(text.slice(cursor)));
  return parts.join("");
};

/**
 * Collect tokens from multiple source lines that have been joined into a single
 * string (with space separators), adjusting token indices to match positions in
 * the joined text. Used for multi-line paragraphs in both intro and notes.
 */
const gatherTokensForJoinedLines = (
  lines: SectionLine[],
  inlineValuesByLine: Map<number, DocumentInlineValueAny[]>,
): DocumentInlineValueAny[] => {
  const tokens: DocumentInlineValueAny[] = [];
  let offset = 0;
  for (const line of lines) {
    const lineTokens = inlineValuesByLine.get(line.line) ?? [];
    for (const token of lineTokens) {
      tokens.push({ ...token, index: token.index + offset });
    }
    offset += line.content.trim().length + 1; // +1 for the space joiner
  }
  return tokens;
};

const renderIntro = (
  introLines: SectionLine[],
  options: RenderOptions,
  inlineValuesByLine: Map<number, DocumentInlineValueAny[]>,
  targetMeta?: Map<string, TargetInfo>,
  recipeId?: string,
): string => {
  // Group lines into paragraphs separated by blank lines
  const paragraphs: { text: string; line: number; lines: SectionLine[] }[] = [];
  let currentLines: SectionLine[] = [];

  for (const sl of introLines) {
    if (sl.content.trim() === "") {
      if (currentLines.length > 0) {
        paragraphs.push({
          text: currentLines.map((l) => l.content.trim()).join(" "),
          line: currentLines[0]!.line,
          lines: currentLines,
        });
        currentLines = [];
      }
    } else {
      currentLines.push(sl);
    }
  }
  if (currentLines.length > 0) {
    paragraphs.push({
      text: currentLines.map((l) => l.content.trim()).join(" "),
      line: currentLines[0]!.line,
      lines: currentLines,
    });
  }

  const html = paragraphs
    .map((p, index) => {
      // Use diff tokens for redline if available
      const ann = getDiffAnnotation(options.diffMap, "intro", String(index));
      const content = ann?.status === "changed" && ann.tokens
        ? renderDiffTokens(ann.tokens)
        : renderNotesInline(p.text, gatherTokensForJoinedLines(p.lines, inlineValuesByLine), options, targetMeta, recipeId);
      return `<p class="kr-intro__p" data-kr-line="${p.line}">${content}</p>`;
    })
    .join("");
  return `<div class="kr-intro">${html}</div>`;
};

interface TextBlockClassNames {
  paragraph: string;
  header: string;
  listItem: string;
  list: string;
  listUnordered: string;
  listOrdered: string;
}

const NOTES_CLASSES: TextBlockClassNames = {
  paragraph: "kr-notes__paragraph",
  header: "kr-notes__header",
  listItem: "kr-notes__list-item",
  list: "kr-notes__list",
  listUnordered: "kr-notes__list--unordered",
  listOrdered: "kr-notes__list--ordered",
};

/**
 * Render an array of TextBlocks into HTML.
 * Used for both intro and notes sections.
 */
const renderTextBlocks = (
  blocks: TextBlock[],
  cls: TextBlockClassNames,
  inlineValuesByLine?: Map<number, DocumentInlineValueAny[]>,
  options?: RenderOptions,
  targetMeta?: Map<string, TargetInfo>,
  diffSection?: "intro" | "notes",
  recipeId?: string,
): string => {
  const renderInlineDiag = (lineNum: number, lineSpans?: [number, number][]) => {
    if (!options || options.diagnosticsMode !== "inline" || !options.diagnosticsMap) {
      return null;
    }
    // Collect diagnostics from all lines the block spans
    const allDiagnostics: Diagnostic[] = [];
    const baseDiags = options.diagnosticsMap.get(lineNum);
    if (baseDiags) allDiagnostics.push(...baseDiags);
    if (lineSpans) {
      for (const [, spanLine] of lineSpans) {
        if (spanLine === lineNum) continue;
        const spanDiags = options.diagnosticsMap.get(spanLine);
        if (spanDiags) allDiagnostics.push(...spanDiags);
      }
    }
    if (allDiagnostics.length === 0) return null;
    const severity = allDiagnostics.some((d) => d.code.startsWith("E"))
      ? "error"
      : "warning";
    const controlsId = options.nextDiagnosticId?.() ?? `diag-${lineNum}`;
    const popover = `<span class="kr-diagnostic-popover" id="${escapeAttr(controlsId)}" role="status" hidden>${allDiagnostics
      .map(
        (d) =>
          `<span class="kr-diagnostic-popover__item kr-diagnostic-popover__item--${d.code.startsWith("E") ? "error" : "warning"}">${escapeHtml(d.message)}</span>`,
      )
      .join("")}</span>`;
    return { severity, controlsId, popover };
  };

  const renderInline = (block: TextBlock): string => {
    if (inlineValuesByLine && options) {
      const lineTokens: DocumentInlineValueAny[] = [];
      if (block.lineSpans) {
        // Gather tokens from all spanned lines
        const seen = new Set<number>();
        for (const [, spanLine] of block.lineSpans) {
          if (seen.has(spanLine)) continue;
          seen.add(spanLine);
          const tokens = inlineValuesByLine.get(spanLine);
          if (tokens) lineTokens.push(...tokens);
        }
      } else {
        const tokens = inlineValuesByLine.get(block.line);
        if (tokens) lineTokens.push(...tokens);
      }
      return renderNotesInline(block.content, lineTokens, options, targetMeta, recipeId);
    }
    return renderMarkdownInline(block.content);
  };

  const diagAttrs = (lineNum: number, lineSpans?: [number, number][]) => {
    const diag = renderInlineDiag(lineNum, lineSpans);
    if (!diag) return { cls: "", attr: "", content: "" };
    return {
      cls: " kr-diagnostic-target",
      attr: ` data-kr-diagnostic-severity="${diag.severity}" role="button" aria-expanded="false" aria-controls="${escapeAttr(diag.controlsId)}" tabindex="0"`,
      content: diag.popover,
    };
  };

  const dm = diffSection ? options?.diffMap : undefined;

  /** Render block content — uses diff tokens for redline if available. */
  const renderBlockContent = (block: TextBlock, index: number): string => {
    if (diffSection) {
      const ann = getDiffAnnotation(dm, diffSection, String(index));
      if (ann?.status === "changed" && ann.tokens) {
        return renderDiffTokens(ann.tokens);
      }
    }
    return renderInline(block);
  };

  const parts: string[] = [];
  let i = 0;

  while (i < blocks.length) {
    const block = blocks[i]!;

    if (block.kind === "header") {
      const tag = block.level === 4 ? "h5" : "h4";
      const content = renderBlockContent(block, i);
      parts.push(`<${tag} class="${cls.header}" data-kr-line="${block.line}">${content}</${tag}>`);
      i++;
      continue;
    }

    if (block.kind === "ul-item" || block.kind === "ol-item") {
      const listTag = block.kind === "ul-item" ? "ul" : "ol";
      const listModifier = block.kind === "ul-item" ? cls.listUnordered : cls.listOrdered;
      const items: string[] = [];
      while (i < blocks.length && blocks[i]!.kind === block.kind) {
        const item = blocks[i]!;
        const d = diagAttrs(item.line, item.lineSpans);
        const content = renderBlockContent(item, i);
        items.push(`<li class="${cls.listItem}${d.cls}" data-kr-line="${item.line}"${d.attr}>${d.content}${content}</li>`);
        i++;
      }
      parts.push(`<${listTag} class="${cls.list} ${listModifier}">${items.join("")}</${listTag}>`);
      continue;
    }

    // paragraph
    const d = diagAttrs(block.line, block.lineSpans);
    const content = renderBlockContent(block, i);
    parts.push(`<p class="${cls.paragraph}${d.cls}" data-kr-line="${block.line}"${d.attr}>${d.content}${content}</p>`);
    i++;
  }

  return parts.join("");
};

// Notes section rendering now uses pre-parsed TextBlock[] from the parser

const renderNotesInline = (
  text: string,
  tokens: DocumentInlineValueAny[],
  options: RenderOptions,
  targetMeta?: Map<string, TargetInfo>,
  recipeId?: string,
): string => {
  type InlineToken = { start: number; end: number; html: string };
  const inlineTokens: InlineToken[] = [];

  for (const token of tokens) {
    const start = token.index;
    const end = token.index + token.raw.length;
    if (token.kind === "temperature") {
      inlineTokens.push({
        start,
        end,
        html: renderTemperatureToken(token, options.temperatureDisplay),
      });
    } else if (token.kind === "quantity") {
      inlineTokens.push({
        start,
        end,
        html: renderQuantityToken(token, options.scaleFactor, options.quantityDisplay),
      });
    }
  }

  if (targetMeta) {
    REFERENCE_PATTERN.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = REFERENCE_PATTERN.exec(text)) !== null) {
      const full = match[0];
      if (!full) continue;
      const start = typeof match.index === "number" ? match.index : text.indexOf(full);
      const end = start + full.length;

      const innerRaw = match[1]?.trim() ?? "";
      let display = innerRaw;
      let target = innerRaw;

      let targets: string[];
      const arrowIndex = innerRaw.indexOf("->");
      if (arrowIndex !== -1) {
        const displayPart = innerRaw.slice(0, arrowIndex).trim();
        const rhs = innerRaw.slice(arrowIndex + 2).trim();
        const rawTargets = rhs.split(",").map((s) => slug(s.trim())).filter(Boolean);
        targets = rawTargets.map((t) => {
          if (recipeId) {
            const qualified = `${recipeId}/${t}`;
            if (targetMeta.has(qualified)) return qualified;
          }
          return t;
        });
        if (displayPart) display = displayPart;
        if (!display && targets.length === 1) {
          const fallback = targetMeta.get(targets[0]!)?.name;
          if (fallback) display = fallback;
        }
      } else {
        target = slug(innerRaw);
        if (target) {
          if (recipeId) {
            const qualified = `${recipeId}/${target}`;
            targets = [targetMeta.has(qualified) ? qualified : target];
          } else {
            targets = [target];
          }
        } else {
          targets = [];
        }
        const fallback = targets.length > 0 ? targetMeta.get(targets[0]!)?.name : undefined;
        if (fallback) display = fallback;
      }

      if (targets.length === 0) {
        inlineTokens.push({ start, end, html: escapeHtml(full) });
        continue;
      }

      const targetAttr = targets.join(" ");
      const controlsIds = targets
        .map((t) => {
          const meta = targetMeta.get(t);
          return meta
            ? meta.type === "ingredient"
              ? `kr-ingredient-${t}`
              : `kr-recipe-${t}`
            : null;
        })
        .filter(Boolean)
        .join(" ");

      const buttonHtml = `<span role="button" tabindex="0" class="kr-ref" data-kr-target="${escapeAttr(
        targetAttr,
      )}" data-kr-display="${escapeAttr(display)}"${controlsIds ? ` aria-controls="${escapeAttr(
        controlsIds,
      )}"` : ""}>${escapeHtml(display)}</span>`;

      const trailingPunct = text.slice(end).match(/^[.,;:!?)]+/);
      if (trailingPunct) {
        inlineTokens.push({
          start,
          end: end + trailingPunct[0].length,
          html: `<span class="kr-ref-wrap">${buttonHtml}${escapeHtml(trailingPunct[0])}</span>`,
        });
      } else {
        inlineTokens.push({ start, end, html: buttonHtml });
      }
    }
  }

  if (inlineTokens.length === 0) {
    return renderMarkdownInline(text);
  }

  inlineTokens.sort((a, b) => a.start - b.start);

  const parts: string[] = [];
  let cursor = 0;
  for (const tok of inlineTokens) {
    if (tok.start < cursor) continue;
    const prefix = text.slice(cursor, tok.start);
    if (prefix) parts.push(renderMarkdownInline(prefix));
    parts.push(tok.html);
    cursor = tok.end;
  }
  const remainder = text.slice(cursor);
  if (remainder) parts.push(renderMarkdownInline(remainder));
  return parts.join("");
};


type QuantityDisplayMode = "native" | "metric" | "imperial";
type TemperatureDisplayMode = "F" | "C" | null;
type LayoutPreset =
  | "stacked"
  | "two-column"
  | "steps-left"
  | "ingredients-left"
  | "print-compact";

type DiagnosticsMode = "off" | "summary" | "panel" | "inline";

type TargetInfo = { name: string; type: "ingredient" | "recipe" };

interface RenderOptions {
  scaleFactor: number;
  quantityDisplay: QuantityDisplayMode;
  temperatureDisplay: TemperatureDisplayMode;
  layout: LayoutPreset;
  diagnosticsMode: DiagnosticsMode;
  diagnosticsMap?: Map<number, Diagnostic[]>;
  nextDiagnosticId?: () => string;
  sourceLines?: string[];
  hideScale?: boolean;
  showAttributes?: boolean;
  /** Diff annotations to highlight added/changed/removed elements. */
  annotations?: DiffAnnotation[];
  /** Resolved diff lookup map (built from annotations). */
  diffMap?: Map<string, DiffAnnotation>;
}

const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  scaleFactor: 1,
  quantityDisplay: "native",
  temperatureDisplay: null,
  layout: "stacked",
  diagnosticsMode: "summary",
};

/** Build a lookup key for diff annotations. */
const diffKey = (section: DiffAnnotation["section"], key: string): string =>
  `${section}:${key}`;

/** Build a lookup map from annotations for O(1) access. */
const buildDiffMap = (annotations: DiffAnnotation[]): Map<string, DiffAnnotation> => {
  const map = new Map<string, DiffAnnotation>();
  for (const a of annotations) {
    map.set(diffKey(a.section, a.key), a);
  }
  return map;
};

/** Look up a diff annotation for a given section/key. */
const getDiffAnnotation = (
  diffMap: Map<string, DiffAnnotation> | undefined,
  section: DiffAnnotation["section"],
  key: string,
): DiffAnnotation | undefined => {
  if (!diffMap) return undefined;
  return diffMap.get(diffKey(section, key));
};

/** Render inline diff tokens as HTML with del/ins markup. */
const renderDiffTokens = (tokens: InlineDiffToken[]): string => {
  return tokens
    .map((t) => {
      const text = escapeHtml(t.text);
      switch (t.kind) {
        case "equal":
          return text;
        case "delete":
          return `<del class="kr-diff-del">${text}</del>`;
        case "insert":
          return `<ins class="kr-diff-ins">${text}</ins>`;
      }
    })
    .join("");
};

const sanitizeAttrKey = (key: string): string =>
  key
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9_-]+/gi, "-");

const cssEscape = (value: string): string => {
  if (typeof CSS !== "undefined" && typeof CSS.escape === "function") {
    return CSS.escape(value);
  }
  return value.replace(/[^a-zA-Z0-9_-]/g, (char) => `\\${char}`);
};

type DimensionKind = "mass" | "volume" | "other" | null;

const dimensionFromUnit = (dimension: UnitDimension | undefined): DimensionKind => {
  if (!dimension) {
    return null;
  }

  if (dimension === "mass") {
    return "mass";
  }

  if (dimension === "volume") {
    return "volume";
  }

  return "other";
};

interface AlternateDisplay {
  attribute: IngredientAttribute;
  text: string | null;
  dimension: DimensionKind;
  hasQuantity: boolean;
  isMetric: boolean;
}

const pickAlternateDisplay = (
  candidates: AlternateDisplay[],
  mode: QuantityDisplayMode,
): AlternateDisplay | null => {
  if (mode === "native" || candidates.length === 0) {
    return null;
  }

  if (mode === "metric") {
    return candidates.find((c) => c.isMetric && c.text) ?? null;
  } else if (mode === "imperial") {
    return candidates.find((c) => !c.isMetric && c.hasQuantity && c.text) ?? null;
  }

  return null;
};

export interface AnchorTarget {
  amount: number;
  displayText: string;
  unit: string;
}

export const resolveAnchorTarget = (
  ingredient: Ingredient,
  quantityDisplay: QuantityDisplayMode,
): AnchorTarget | null => {
  if (ingredient.quantity?.kind !== "single") return null;

  const nativeQty = ingredient.quantity;
  const anchorFromQty = (qty: { value: number; unit: string | null }): AnchorTarget => ({
    amount: qty.value,
    displayText: numberToFractionText(qty.value),
    unit: qty.unit ?? "",
  });

  if (quantityDisplay === "native") {
    return anchorFromQty(nativeQty);
  }

  // Mirror pickAlternateDisplay: prefer mode-matching alternate, then any alternate with a quantity
  const alternates = ingredient.attributes
    .filter((attr) => attr.key === "also" && attr.quantity?.kind === "single")
    .map((attr) => {
      const altQty = attr.quantity as import("../core/types").QuantitySingle;
      const unitInfo = altQty.unit ? lookupUnit(altQty.unit) : null;
      return { altQty, isMetric: isMetricSystem(unitInfo?.system) };
    });

  // Prefer mode-matching alternate; fall back to native if none matches
  const preferred = alternates.find((a) =>
    quantityDisplay === "metric" ? a.isMetric : !a.isMetric && !!a.altQty.unit,
  );
  if (preferred) return anchorFromQty(preferred.altQty);

  return anchorFromQty(nativeQty);
};

const formatDiagnosticsSummary = (diagnostics: Diagnostic[]): {
  totalLabel: string;
  breakdown: string;
} => {
  const errorCount = diagnostics.filter((item) => item.severity === "error").length;
  const warningCount = diagnostics.length - errorCount;
  const totalLabel = `${diagnostics.length} issue${diagnostics.length === 1 ? "" : "s"}`;
  const breakdownParts: string[] = [];
  if (errorCount) {
    breakdownParts.push(`${errorCount} error${errorCount === 1 ? "" : "s"}`);
  }
  if (warningCount) {
    breakdownParts.push(`${warningCount} warning${warningCount === 1 ? "" : "s"}`);
  }
  const breakdown = breakdownParts.length ? breakdownParts.join(", ") : totalLabel;
  return { totalLabel, breakdown };
};

const renderDiagnosticsSection = (diagnostics: Diagnostic[], mode: DiagnosticsMode): string => {
  if (diagnostics.length === 0 || mode === "off") {
    return "";
  }

  const { totalLabel, breakdown } = formatDiagnosticsSummary(diagnostics);
  const summaryText =
    breakdown === totalLabel ? totalLabel : `${totalLabel} · ${breakdown}`;

  const items = diagnostics
    .map((diag) => {
      const severityLabel = diag.severity === "error" ? "Error" : "Warning";
      const code = escapeHtml(diag.code);
      const message = escapeHtml(diag.message);
      const location = `Line ${diag.line}`;
      return `<li class="kr-diagnostics__item" data-kr-code="${code}" data-kr-severity="${diag.severity}" data-kr-line="${diag.line}">
        <span class="kr-diagnostics__tag" data-kr-tag="${code}" data-kr-severity="${diag.severity}">${severityLabel} ${code}</span>
        <span class="kr-diagnostics__message">${message}</span>
        <span class="kr-diagnostics__meta">${escapeHtml(location)}</span>
      </li>`;
    })
    .join("");

  const openAttr = mode === "panel" ? " open" : "";

  return `<details class="kr-diagnostics" data-kr-diagnostics data-kr-mode="${mode}" role="status" aria-live="polite"${openAttr}>
      <summary class="kr-diagnostics__toggle">
        <span class="kr-diagnostics__icon" aria-hidden="true">!</span>
        <span class="kr-diagnostics__summary">${escapeHtml(summaryText)}</span>
      </summary>
      <div class="kr-diagnostics__panel">
        <ul class="kr-diagnostics__list">${items}</ul>
      </div>
    </details>`;
};

const renderInlineDiagnostics = (
  lineNumber: number,
  options: RenderOptions,
  lineSpans?: [number, number][],
): { popover: string; severity: "error" | "warning"; controlsId: string } | null => {
  if (options.diagnosticsMode !== "inline" || !options.diagnosticsMap) {
    return null;
  }

  // Collect diagnostics from all lines this element spans
  const allDiagnostics: Diagnostic[] = [];
  const diagnostics = options.diagnosticsMap.get(lineNumber);
  if (diagnostics) allDiagnostics.push(...diagnostics);
  if (lineSpans) {
    for (const [, spanLine] of lineSpans) {
      if (spanLine === lineNumber) continue;
      const spanDiags = options.diagnosticsMap.get(spanLine);
      if (spanDiags) allDiagnostics.push(...spanDiags);
    }
  }

  if (allDiagnostics.length === 0) {
    return null;
  }

  const severity = allDiagnostics.some((diag) => diag.severity === "error") ? "error" : "warning";
  const markerId = options.nextDiagnosticId
    ? options.nextDiagnosticId()
    : `kr-diagnostic-${lineNumber}-${Math.random().toString(36).slice(2)}`;

  const items = allDiagnostics
    .map(
      (diag) =>
        `<span class="kr-diagnostic-popover__item"><strong>${escapeHtml(diag.code)}</strong> ${escapeHtml(diag.message)}</span>`,
    )
    .join("");

  const popover = `<span class="kr-diagnostic-popover" id="${escapeAttr(markerId)}" role="status" hidden>
        <span class="kr-diagnostic-popover__list">${items}</span>
      </span>`;

  return { popover, severity, controlsId: markerId };
};

const convertTemperature = (value: number, scale: "F" | "C"): { other: number; otherScale: "F" | "C" } => {
  if (scale === "F") {
    return { other: Math.round(((value - 32) * 5) / 9), otherScale: "C" };
  }
  return { other: Math.round((value * 9) / 5 + 32), otherScale: "F" };
};

const renderTemperatureToken = (
  token: DocumentInlineTemperatureValue,
  preferredScale: TemperatureDisplayMode = null,
): string => {
  const { other, otherScale } = convertTemperature(token.value, token.scale);

  // If preferred scale differs from native, show converted as primary
  if (preferredScale && preferredScale !== token.scale) {
    const display = `${other}&deg;${otherScale}`;
    const nativeDisplay = `${token.value}°${token.scale}`;
    const ariaLabel = `${other} degrees ${otherScale === "F" ? "Fahrenheit" : "Celsius"} (${token.value} degrees ${token.scale === "F" ? "Fahrenheit" : "Celsius"})`;
    return `<span class="kr-temperature" data-kr-temperature-scale="${escapeAttr(
      otherScale,
    )}" data-kr-temperature-value="${String(other)}" data-kr-temperature-alt-scale="${escapeAttr(
      token.scale,
    )}" data-kr-temperature-alt-value="${String(token.value)}" aria-label="${escapeAttr(
      ariaLabel,
    )}" title="${escapeAttr(nativeDisplay)}">${display}</span>`;
  }

  const display = `${token.value}&deg;${token.scale}`;
  const ariaLabel = `${token.value} degrees ${token.scale === "F" ? "Fahrenheit" : "Celsius"} (about ${other} degrees ${otherScale === "F" ? "Fahrenheit" : "Celsius"})`;
  return `<span class="kr-temperature" data-kr-temperature-scale="${escapeAttr(
    token.scale,
  )}" data-kr-temperature-value="${String(token.value)}" data-kr-temperature-alt-scale="${escapeAttr(
    otherScale,
  )}" data-kr-temperature-alt-value="${String(other)}" aria-label="${escapeAttr(
    ariaLabel,
  )}" title="${escapeAttr(`approx. ${other}${otherScale}`)}">${display}</span>`;
};

const renderQuantityToken = (
  token: DocumentInlineQuantityValue,
  scaleFactor: number,
  quantityDisplay: QuantityDisplayMode = "native",
): string => {
  // Check if we should show an alternate based on display mode
  if (quantityDisplay !== "native" && token.alternates && token.alternates.length > 0) {
    const wantMetric = quantityDisplay === "metric";
    const alt = token.alternates.find((a) => {
      const unit = a.kind === "compound" ? a.parts[0].unit : a.unit;
      if (!unit) return false;
      const unitInfo = lookupUnit(unit);
      return unitInfo?.system ? isMetricSystem(unitInfo.system) === wantMetric : false;
    });
    if (alt) {
      const altScaled = scaleFactor !== 1 ? scaleQuantity(alt, scaleFactor) : null;
      const altFormatted = formatQuantity(alt, {
        scaled: altScaled ?? undefined,
        usePreferredUnit: true,
      });
      const altDisplay = altFormatted ? escapeHtml(altFormatted) : escapeHtml(alt.raw);
      const nativeFormatted = formatQuantity(token.quantity) ?? token.quantity.raw;
      return `<span class="kr-inline-quantity" title="${escapeAttr(nativeFormatted)}">${altDisplay}</span>`;
    }
  }

  const scaled = scaleFactor !== 1 ? scaleQuantity(token.quantity, scaleFactor) : null;
  const formatted = formatQuantity(token.quantity, {
    scaled: scaled ?? undefined,
    usePreferredUnit: true,
  });
  const display = formatted ? escapeHtml(formatted) : escapeHtml(token.raw);
  if (scaleFactor !== 1 && scaled) {
    const original = formatQuantity(token.quantity) ?? token.quantity.raw;
    return `<span class="kr-inline-quantity" title="${escapeAttr(original)}">${display}</span>`;
  }
  return `<span class="kr-inline-quantity">${display}</span>`;
};

const renderIngredientAttributes = (
  attributes: IngredientAttribute[],
  options: {
    omitKeys?: Set<string>;
    omitAttributes?: Set<IngredientAttribute>;
    displayTextByAttribute?: Map<IngredientAttribute, string>;
    attributeDiffs?: AttributeDiff[];
  } = {},
): string => {
  const { omitKeys, omitAttributes, displayTextByAttribute, attributeDiffs } = options;

  // Build diff lookup by key
  const diffByKey = new Map<string, "added" | "removed">();
  if (attributeDiffs) {
    for (const d of attributeDiffs) {
      diffByKey.set(d.key, d.status);
    }
  }

  const renderChip = (key: string, rawValue: string, diffStatus?: "added" | "removed") => {
    const detail =
      rawValue !== ""
        ? `: <span class="kr-ingredient__attribute-value">${escapeHtml(rawValue)}</span>`
        : "";
    const diffAttrStr = diffStatus ? ` data-kr-attr-diff="${diffStatus}"` : "";
    return `<span class="kr-ingredient__attribute"${diffAttrStr} data-kr-attribute="${escapeAttr(key)}">${escapeHtml(key)}${detail}</span>`;
  };

  const chips: string[] = [];

  for (const attr of attributes) {
    if (omitKeys?.has(attr.key)) continue;
    if (omitAttributes?.has(attr)) continue;
    const rawValue = displayTextByAttribute?.get(attr) ?? attr.value ?? attr.quantity?.raw ?? "";
    const diffStatus = diffByKey.get(attr.key);
    chips.push(renderChip(attr.key, rawValue, diffStatus));
  }

  // Append removed attribute chips (these don't exist on the after ingredient)
  for (const d of attributeDiffs ?? []) {
    if (d.status === "removed") {
      chips.push(renderChip(d.key, "", "removed"));
    }
  }

  if (chips.length === 0) return "";
  return `<span class="kr-ingredient__attributes">${chips.join("")}</span>`;
};

const REFERENCE_PATTERN = /\[\[([^[\]]+)\]\]/g;

const STEP_NUMBER_PATTERN = /^(\d+)\.\s+/;

const renderStepLine = (
  line: SectionLine,
  targetMeta: Map<string, TargetInfo>,
  tokens: DocumentInlineValueAny[],
  context: { recipeId: string; recipeTitle: string },
  options: RenderOptions,
  stepIndex: number | null = null,
  diffIndex?: number,
): string => {
  // Extract step number from the full text for display
  const stepMatch = STEP_NUMBER_PATTERN.exec(line.text);
  const stepNumber = stepMatch?.[1] ?? null;
  // Use content (prefix-stripped) — token indices are relative to this
  const text = line.content;

  type InlineToken = { start: number; end: number; html: string };
  const inlineTokens: InlineToken[] = [];

  const recipeTokens = tokens
    .filter((token) => token.recipeId === context.recipeId)
    .slice()
    .sort((a, b) => a.index - b.index);

  for (const token of recipeTokens) {
    const start = token.index;
    const end = token.index + token.raw.length;
    if (token.kind === "temperature") {
      inlineTokens.push({
        start,
        end,
        html: renderTemperatureToken(token, options.temperatureDisplay),
      });
    } else if (token.kind === "quantity") {
      inlineTokens.push({
        start,
        end,
        html: renderQuantityToken(token, options.scaleFactor, options.quantityDisplay),
      });
    }
  }

  REFERENCE_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = REFERENCE_PATTERN.exec(text)) !== null) {
    const full = match[0];
    if (!full) {
      continue;
    }
    const start = typeof match.index === "number" ? match.index : text.indexOf(full);
    const end = start + full.length;

    const innerRaw = match[1]?.trim() ?? "";
    let display = innerRaw;
    let target = innerRaw;

    let targets: string[];
    const arrowIndex = innerRaw.indexOf("->");
    if (arrowIndex !== -1) {
      const displayPart = innerRaw.slice(0, arrowIndex).trim();
      const rhs = innerRaw.slice(arrowIndex + 2).trim();
      const rawTargets = rhs.split(",").map((s) => slug(s.trim())).filter(Boolean);
      targets = rawTargets.map((t) => {
        const qualified = `${context.recipeId}/${t}`;
        return targetMeta.has(qualified) ? qualified : t;
      });
      if (displayPart) {
        display = displayPart;
      }
      if (!display && targets.length === 1) {
        const fallback = targetMeta.get(targets[0]!)?.name;
        if (fallback) {
          display = fallback;
        }
      }
    } else {
      target = slug(innerRaw);
      if (target) {
        const qualified = `${context.recipeId}/${target}`;
        targets = [targetMeta.has(qualified) ? qualified : target];
      } else {
        targets = [];
      }
      const fallback = targets.length > 0 ? targetMeta.get(targets[0]!)?.name : undefined;
      if (fallback) {
        display = fallback;
      }
    }

    if (targets.length === 0) {
      inlineTokens.push({ start, end, html: escapeHtml(full) });
      continue;
    }

    const targetAttr = targets.join(" ");
    const controlsIds = targets
      .map((t) => {
        const meta = targetMeta.get(t);
        return meta
          ? meta.type === "ingredient"
            ? `kr-ingredient-${t}`
            : `kr-recipe-${t}`
          : null;
      })
      .filter(Boolean)
      .join(" ");

    const buttonHtml = `<span role="button" tabindex="0" class="kr-ref" data-kr-target="${escapeAttr(
        targetAttr,
      )}" data-kr-display="${escapeAttr(display)}"${controlsIds ? ` aria-controls="${escapeAttr(
        controlsIds,
      )}"` : ""}>${escapeHtml(display)}</span>`;

    // Grab trailing punctuation so it wraps as a unit with the button
    const trailingPunct = text.slice(end).match(/^[.,;:!?)]+/);
    if (trailingPunct) {
      inlineTokens.push({
        start,
        end: end + trailingPunct[0].length,
        html: `<span class="kr-ref-wrap">${buttonHtml}${escapeHtml(trailingPunct[0])}</span>`,
      });
    } else {
      inlineTokens.push({ start, end, html: buttonHtml });
    }
  }

  inlineTokens.sort((a, b) => a.start - b.start);

  const parts: string[] = [];
  let cursor = 0;

  for (const token of inlineTokens) {
    if (token.start < cursor) {
      continue;
    }
    const prefix = text.slice(cursor, token.start);
    if (prefix) {
      parts.push(renderMarkdownInline(prefix));
    }
    parts.push(token.html);
    cursor = token.end;
  }

  const remainder = text.slice(cursor);
  if (remainder) {
    parts.push(renderMarkdownInline(remainder));
  }

  const inlineDiagnostics = renderInlineDiagnostics(line.line, options, line.lineSpans);
  const diagnosticClass = inlineDiagnostics ? " kr-diagnostic-target" : "";
  const diagnosticAttr = inlineDiagnostics
    ? ` data-kr-diagnostic-severity="${inlineDiagnostics.severity}" role="button" aria-expanded="false" aria-controls="${escapeAttr(inlineDiagnostics.controlsId)}" tabindex="0"`
    : "";
  const diagnosticContent = inlineDiagnostics ? inlineDiagnostics.popover : "";

  // Use diff tokens for redline display if available
  let content = parts.join("");
  if (diffIndex != null) {
    const ann = getDiffAnnotation(options.diffMap, "steps", String(diffIndex));
    if (ann?.status === "changed" && ann.tokens) {
      content = renderDiffTokens(ann.tokens);
    }
  }

  if (stepNumber !== null && stepIndex !== null) {
    const stepAttrs = ` data-kr-recipe-id="${escapeAttr(context.recipeId)}" data-kr-step-index="${stepIndex}" role="button" tabindex="0" aria-pressed="false"`;
    return `<p class="kr-section__line kr-step${diagnosticClass}" data-kr-line="${line.line}"${diagnosticAttr}${stepAttrs}>${diagnosticContent}<span class="kr-step-number">${escapeHtml(stepNumber)}.</span>${content}</p>`;
  }

  if (stepNumber !== null) {
    return `<p class="kr-section__line${diagnosticClass}" data-kr-line="${line.line}"${diagnosticAttr}>${diagnosticContent}<span class="kr-step-number">${escapeHtml(stepNumber)}.</span>${content}</p>`;
  }

  return `<p class="kr-section__line${diagnosticClass}" data-kr-line="${line.line}"${diagnosticAttr}>${diagnosticContent}${content}</p>`;
};

const renderIngredient = (ingredient: Ingredient, recipeId: string, options: RenderOptions): string => {
  const qualifiedId = `${recipeId}/${ingredient.id}`;
  const dataAttrs: string[] = [
    `data-kr-line="${String(ingredient.line)}"`,
    `data-kr-id="${escapeAttr(qualifiedId)}"`,
  ];

  for (const attr of ingredient.attributes) {
    const key = sanitizeAttrKey(attr.key);
    const rawValue = attr.value ?? attr.quantity?.raw ?? "";
    if (rawValue === "") {
      dataAttrs.push(`data-kr-attr-${key}="true"`);
    } else {
      dataAttrs.push(`data-kr-attr-${key}="${escapeAttr(rawValue)}"`);
    }
  }

  const inlineDiagnostics = renderInlineDiagnostics(ingredient.line, options);
  let diagnosticClass = "";
  let diagnosticContent = "";
  if (inlineDiagnostics) {
    diagnosticClass = " kr-diagnostic-target";
    dataAttrs.push(`data-kr-diagnostic-severity="${inlineDiagnostics.severity}"`);
    dataAttrs.push(`role="button"`);
    dataAttrs.push(`aria-expanded="false"`);
    dataAttrs.push(`aria-controls="${escapeAttr(inlineDiagnostics.controlsId)}"`);
    dataAttrs.push(`tabindex="0"`);
    diagnosticContent = inlineDiagnostics.popover;
  }

  const noscale = ingredient.attributes.some((attr) => attr.key === "noscale");
  const baseQuantity = ingredient.quantity ?? null;
  const scalable = Boolean(baseQuantity) && !noscale;
  dataAttrs.push(`data-kr-scalable="${scalable}"`);
  const shouldScale = scalable && options.scaleFactor !== 1;

  const scaledQuantity = shouldScale && baseQuantity
    ? scaleQuantity(baseQuantity, options.scaleFactor)
    : null;

  const nativeQuantityText = formatQuantity(baseQuantity, {
    scaled: scaledQuantity ?? undefined,
    usePreferredUnit: false,
  });

  const alternateAttributes = ingredient.attributes.filter((attr) => attr.key === "also");
  const alternateDisplays: AlternateDisplay[] = alternateAttributes.map((attr) => {
    let text: string | null = attr.value ?? null;
    let dimension: DimensionKind = null;
    let hasQuantity = false;

    let isMetric = false;
    if (attr.quantity) {
      hasQuantity = true;
      // Derive unit info from first part for compound quantities
      const qtyUnit = attr.quantity.kind === "compound"
        ? attr.quantity.parts[0].unit
        : attr.quantity.unit;
      const unitInfo = qtyUnit ? lookupUnit(qtyUnit) : null;
      dimension = dimensionFromUnit(unitInfo?.dimension);
      isMetric = isMetricSystem(unitInfo?.system);
      const scaledAlt =
        shouldScale && attr.quantity ? scaleQuantity(attr.quantity, options.scaleFactor) : null;
      const formatted = formatQuantity(attr.quantity, {
        scaled: scaledAlt ?? undefined,
        usePreferredUnit: true,
      });
      if (formatted) {
        text = formatted;
      }
    }

    return { attribute: attr, text, dimension, hasQuantity, isMetric };
  });

  const alternateDisplay = pickAlternateDisplay(alternateDisplays, options.quantityDisplay);

  let quantityMode: QuantityDisplayMode = "native";
  let primaryQuantity = nativeQuantityText;
  let tooltipQuantity: string | null = null;

  if (alternateDisplay && alternateDisplay.text) {
    quantityMode = options.quantityDisplay;
    primaryQuantity = alternateDisplay.text;
    if (nativeQuantityText && nativeQuantityText !== alternateDisplay.text) {
      tooltipQuantity = nativeQuantityText;
    }
  }

  dataAttrs.push(`data-kr-quantity-mode="${quantityMode}"`);

  // Build quantity column (always render, even if empty)
  const quantityContent = primaryQuantity ? escapeHtml(primaryQuantity) : "";
  const quantityAttr = primaryQuantity ? ` data-kr-quantity="${escapeAttr(primaryQuantity)}"` : "";
  const titleAttr = tooltipQuantity ? ` title="${escapeAttr(tooltipQuantity)}"` : "";
  const quantityCell = `<span class="kr-ingredient__quantity"${quantityAttr}${titleAttr}>${quantityContent}</span>`;

  // Build content column
  const nameInner = ingredient.linkedRecipeId
    ? `<a href="#${escapeAttr(ingredient.linkedRecipeId)}" class="kr-subrecipe-link">${escapeHtml(ingredient.name)}</a>`
    : escapeHtml(ingredient.name);
  const name = `<span class="kr-ingredient__name">${nameInner}</span>`;
  const modifiers = ingredient.modifiers
    ? `<span class="kr-ingredient__modifiers">${escapeHtml(ingredient.modifiers)}</span>`
    : "";


  const contentParts = [name, modifiers].filter(Boolean);
  const contentCell = `<span class="kr-ingredient__content">${contentParts.join(" ")}</span>`;

  // Caution icon for unscalable ingredients when recipe is scaled
  const cautionIcon = !scalable && options.scaleFactor !== 1
    ? `<span class="kr-noscale-icon" title="This ingredient can't be scaled">${CAUTION_ICON_SVG}</span>`
    : "";

  // Attribute chips — shown in edit mode (showAttributes) or diff mode (annotation present)
  const ingAnn = getDiffAnnotation(options.diffMap, "ingredients", ingredient.id);
  let attributeChips = "";
  if (options.showAttributes || ingAnn) {
    const omitKeys = new Set(["id"]);
    const omitAttributes = new Set<IngredientAttribute>();
    const displayTextByAttribute = new Map<IngredientAttribute, string>();

    if (alternateDisplay) {
      omitAttributes.add(alternateDisplay.attribute);
    }
    for (const alt of alternateDisplays) {
      if (alt.text) {
        displayTextByAttribute.set(alt.attribute, alt.text);
      }
    }

    attributeChips = renderIngredientAttributes(ingredient.attributes, {
      omitKeys,
      omitAttributes,
      displayTextByAttribute,
      attributeDiffs: ingAnn?.attributeDiffs,
    });
  }

  const elementId = `kr-ingredient-${qualifiedId}`;

  // Use diff tokens for content redlining if available
  let wrapper: string;
  if (ingAnn?.status === "changed" && ingAnn.tokens) {
    wrapper = `<div class="kr-ingredient__wrapper"><span class="kr-ingredient__content">${renderDiffTokens(ingAnn.tokens)}</span></div>`;
  } else {
    wrapper = `<div class="kr-ingredient__wrapper">${quantityCell}${contentCell}</div>`;
  }
  return `<li class="kr-ingredient${diagnosticClass}" id="${escapeAttr(elementId)}" tabindex="-1" ${dataAttrs.join(
    " ",
  )}>${cautionIcon}${diagnosticContent}${wrapper}${attributeChips}</li>`;
};

const renderIngredientsSection = (
  section: IngredientsSection,
  recipeId: string,
  options: RenderOptions,
): string => {
  const heading = `<h3 class="kr-section__title">${escapeHtml(section.title)}</h3>`;
  if (section.ingredients.length === 0) {
    return `<section class="kr-section" data-kr-kind="ingredients">${heading}<div class="kr-section__body"><p class="kr-section__line kr-empty">No ingredients listed.</p></div></section>`;
  }

  const items = section.ingredients.map((ingredient) => renderIngredient(ingredient, recipeId, options)).join("");
  return `<section class="kr-section" data-kr-kind="ingredients">${heading}<ul class="kr-ingredient-list">${items}</ul></section>`;
};

const renderStepsSection = (
  section: StepsSection,
  recipe: Recipe,
  options: RenderOptions,
  targetMeta: Map<string, TargetInfo>,
  inlineValuesByLine: Map<number, DocumentInlineValueAny[]>,
): string => {
  const heading = `<h3 class="kr-section__title">${escapeHtml(section.title)}</h3>`;
  let stepIndex = 0;
  let nonEmptyIndex = 0;
  const lines = section.lines
    .map((line: SectionLine) => {
      const fullText = line.text;
      const isEmpty = line.content.trim() === "";
      const stepMatch = STEP_NUMBER_PATTERN.exec(fullText);
      const currentStepIndex = stepMatch ? stepIndex++ : null;
      const currentDiffIndex = isEmpty ? undefined : nonEmptyIndex++;
      // Gather tokens from all lines this step spans
      let lineTokens: DocumentInlineValueAny[];
      if (line.lineSpans) {
        lineTokens = [];
        const seen = new Set<number>();
        for (const [, spanLine] of line.lineSpans) {
          if (seen.has(spanLine)) continue;
          seen.add(spanLine);
          const tokens = inlineValuesByLine.get(spanLine);
          if (tokens) lineTokens.push(...tokens);
        }
      } else {
        lineTokens = inlineValuesByLine.get(line.line) ?? [];
      }
      return renderStepLine(
        line,
        targetMeta,
        lineTokens,
        { recipeId: recipe.id, recipeTitle: recipe.title },
        options,
        currentStepIndex,
        currentDiffIndex,
      );
    })
    .join("");
  return `<section class="kr-section" data-kr-kind="steps">${heading}<div class="kr-section__body">${lines}</div></section>`;
};

const renderScaleWidget = (presets: ScalePreset[]): string => {
  const chips: string[] = [];
  chips.push(`<button class="kr-scale-chip" data-kr-scale-value="1" role="radio" aria-checked="false">1\u00d7</button>`);
  chips.push(`<button class="kr-scale-chip" data-kr-scale-value="0.5" role="radio" aria-checked="false">\u00bd</button>`);
  chips.push(`<button class="kr-scale-chip" data-kr-scale-value="2" role="radio" aria-checked="false">2\u00d7</button>`);
  for (let i = 0; i < presets.length; i++) {
    chips.push(`<button class="kr-scale-chip" data-kr-preset-index="${i}" role="radio" aria-checked="false">${escapeHtml(presets[i]!.name)}</button>`);
  }
  chips.push(`<span class="kr-scale-divider"></span>`);
  chips.push(`<button class="kr-scale-chip kr-scale-chip--anchor" data-kr-scale-mode="by-ingredient" role="radio" aria-checked="false" aria-label="Scale by ingredient">${ANCHOR_ICON_SMALL_SVG}</button>`);
  const bar = `<div class="kr-scale-bar" role="radiogroup" aria-label="Scale recipe" hidden>${chips.join("")}</div>`;
  // The toggle chip shows the current scale label — JS updates its text
  const toggle = `<button class="kr-scale-toggle" aria-label="Scale recipe" aria-expanded="false">1\u00d7</button>`;
  return `<div class="kr-scale-widget">${bar}${toggle}</div>`;
};

const renderRecipe = (
  recipe: Recipe,
  index: number,
  options: RenderOptions,
  targetMeta: Map<string, TargetInfo>,
  inlineValuesByLine: Map<number, DocumentInlineValueAny[]>,
  source?: Source,
  presets?: ScalePreset[],
  yieldQuantity?: Quantity,
): string => {
  const ingredientsHtml = renderIngredientsSection(recipe.ingredients, recipe.id, options);
  const stepsHtml = renderStepsSection(recipe.steps, recipe, options, targetMeta, inlineValuesByLine);
  const notesHtml = recipe.notes.length > 0
    ? `<section class="kr-section" data-kr-kind="notes"><h3 class="kr-section__title">Notes</h3><div class="kr-section__body">${renderTextBlocks(recipe.notes, NOTES_CLASSES, inlineValuesByLine, options, targetMeta, "notes", recipe.id)}</div></section>`
    : "";
  const sections = ingredientsHtml + stepsHtml + notesHtml;
  const roleAttr = index === 0 ? "main" : "secondary";
  const recipeElementId = `kr-recipe-${recipe.id}`;
  const inlineDiagnostics = renderInlineDiagnostics(recipe.line, options);
  const diagnosticClass = inlineDiagnostics ? " kr-diagnostic-target" : "";
  const diagnosticAttr = inlineDiagnostics
    ? ` data-kr-diagnostic-severity="${inlineDiagnostics.severity}" role="button" aria-expanded="false" aria-controls="${escapeAttr(inlineDiagnostics.controlsId)}" tabindex="0"`
    : "";
  const diagnosticContent = inlineDiagnostics ? inlineDiagnostics.popover : "";
  const sourceHtml = source ? renderSource(source) : "";
  const yieldHtml = yieldQuantity ? renderYield(yieldQuantity, options.scaleFactor) : "";
  let introHtml = "";
  if (recipe.introLines.length > 0) {
    introHtml = renderIntro(recipe.introLines, options, inlineValuesByLine, targetMeta, recipe.id);
  }

  const scaleWidget = roleAttr === "main" && !options.hideScale ? renderScaleWidget(presets ?? []) : "";

  return `<section class="kr-recipe" id="${escapeAttr(recipeElementId)}" tabindex="-1" data-kr-role="${roleAttr}" data-kr-id="${escapeAttr(
    recipe.id,
  )}" data-kr-layout="${escapeAttr(options.layout)}"><header class="kr-recipe__header"><div class="kr-recipe__header-row"><div class="kr-recipe__header-text"><h2 class="kr-recipe__title${diagnosticClass}" data-kr-line="${recipe.line}"${diagnosticAttr}>${diagnosticContent}${escapeHtml(
    recipe.title,
  )}</h2>${sourceHtml}${yieldHtml}</div>${scaleWidget}</div></header>${introHtml}${sections}</section>`;
};

const renderSource = (source: Source): string => {
  if (source.kind === "text") {
    return `<div class="kr-source">from ${escapeHtml(source.value)}</div>`;
  }

  if (source.kind === "url") {
    const titleText = source.title || source.url;
    return `<div class="kr-source">from <a class="kr-source__link" href="${escapeAttr(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(titleText)}</a></div>`;
  }

  if (source.kind === "cookbook") {
    const parts: string[] = [];
    parts.push(`<span class="kr-source__book-title">${escapeHtml(source.title)}</span>`);

    if (source.author) {
      parts.push(` by ${escapeHtml(source.author)}`);
    }

    if (source.pages) {
      const pagesText = typeof source.pages === "number" ? `p. ${source.pages}` : `p. ${source.pages}`;
      parts.push(`, ${pagesText}`);
    }

    return `<div class="kr-source">from ${parts.join("")}</div>`;
  }

  return "";
};

const renderYield = (
  yieldQuantity: Quantity,
  scaleFactor: number,
): string => {
  const scaled = scaleFactor !== 1 ? scaleQuantity(yieldQuantity, scaleFactor) : null;
  const formatted = formatQuantity(yieldQuantity, {
    scaled: scaled ?? undefined,
  });
  const display = formatted ? escapeHtml(formatted) : escapeHtml(yieldQuantity.raw);

  if (scaled) {
    const original = formatQuantity(yieldQuantity) ?? yieldQuantity.raw;
    return `<div class="kr-yield">Yield: <span class="kr-yield__value" title="${escapeAttr(original)}">${display}</span></div>`;
  }
  return `<div class="kr-yield">Yield: <span class="kr-yield__value">${display}</span></div>`;
};

export const renderDocument = (
  doc: DocumentParseResult,
  partialOptions: Partial<RenderOptions> = {},
): string => {
  const baseOptions: RenderOptions = {
    ...DEFAULT_RENDER_OPTIONS,
    ...partialOptions,
  };

  const targetMeta = new Map<string, TargetInfo>();
  const inlineValuesByLine = new Map<number, DocumentInlineValueAny[]>();
  const diagnostics = doc.diagnostics ?? [];
  const diagnosticsCount = diagnostics.length;
  const diagnosticsMap = new Map<number, Diagnostic[]>();

  if (diagnostics.length) {
    for (const diagnostic of diagnostics) {
      if (!diagnosticsMap.has(diagnostic.line)) {
        diagnosticsMap.set(diagnostic.line, [diagnostic]);
      } else {
        diagnosticsMap.get(diagnostic.line)!.push(diagnostic);
      }
    }
  }

  const inlineDiagnosticsMap =
    baseOptions.diagnosticsMode === "inline" && diagnosticsMap.size > 0
      ? diagnosticsMap
      : undefined;
  let diagnosticIdCounter = 0;

  const hasDiff = !!baseOptions.annotations;
  const options: RenderOptions = {
    ...baseOptions,
    // Diff mode forces native units (like edit mode) so the user sees quantities as-written
    ...(hasDiff && { quantityDisplay: "native" as const }),
    diagnosticsMap: inlineDiagnosticsMap,
    nextDiagnosticId: inlineDiagnosticsMap ? () => `kr-diag-${diagnosticIdCounter++}` : undefined,
    diffMap: hasDiff ? buildDiffMap(baseOptions.annotations!) : undefined,
  };

  for (const recipe of doc.recipes) {
    targetMeta.set(recipe.id, { name: recipe.title, type: "recipe" });
    for (const ingredient of recipe.ingredients.ingredients) {
      targetMeta.set(`${recipe.id}/${ingredient.id}`, { name: ingredient.name, type: "ingredient" });
    }
  }

  for (const token of doc.inlineValues) {
    const existing = inlineValuesByLine.get(token.line);
    if (existing) {
      existing.push(token);
    } else {
      inlineValuesByLine.set(token.line, [token]);
    }
  }

  for (const list of inlineValuesByLine.values()) {
    list.sort((a, b) => a.index - b.index);
  }

  const parts: string[] = [
    `<style>${BASE_STYLE}</style>`,
  ];

  const diagnosticsSection = renderDiagnosticsSection(diagnostics, options.diagnosticsMode);
  if (diagnosticsSection) {
    parts.push(diagnosticsSection);
  }

  const scaledAttr = options.scaleFactor !== 1 ? " data-kr-scaled" : "";
  parts.push(
    `<article class="kr-root" data-kr-scale="${options.scaleFactor}" data-kr-quantity-display="${options.quantityDisplay}" data-kr-layout="${options.layout}" data-kr-diagnostics-count="${diagnosticsCount}"${scaledAttr}>`,
  );

  if (doc.documentTitle) {
    const inlineDiagnostics = renderInlineDiagnostics(doc.documentTitle.line, options);
    const diagnosticClass = inlineDiagnostics ? " kr-diagnostic-target" : "";
    const diagnosticAttr = inlineDiagnostics
      ? ` data-kr-diagnostic-severity="${inlineDiagnostics.severity}" role="button" aria-expanded="false" aria-controls="${escapeAttr(inlineDiagnostics.controlsId)}" tabindex="0"`
      : "";
    const diagnosticContent = inlineDiagnostics ? inlineDiagnostics.popover : "";
    const docIntroHtml = doc.documentTitle.introLines.length > 0
      ? renderIntro(doc.documentTitle.introLines, options, inlineValuesByLine)
      : "";
    parts.push(
      `<header class="kr-document"><h1 class="kr-document-title${diagnosticClass}" data-kr-line="${doc.documentTitle.line}"${diagnosticAttr}>${diagnosticContent}${escapeHtml(doc.documentTitle.text)}</h1>${docIntroHtml}</header>`,
    );
  }

  if (doc.recipes.length === 0) {
    parts.push(
      `<p class="kr-empty" role="status">No recipes found in provided content.</p>`,
    );
  } else {
    const scalePresets = doc.frontmatter?.scales ?? [];
    doc.recipes.forEach((recipe, index) => {
      // Only show source and yield on the main recipe (index 0)
      const source = index === 0 ? doc.frontmatter?.source : undefined;
      const yieldQuantity = index === 0 ? doc.frontmatter?.yield : undefined;
      parts.push(renderRecipe(recipe, index, options, targetMeta, inlineValuesByLine, source, scalePresets, yieldQuantity));
    });
  }

  parts.push(`</article>`);
  return parts.join("");
};

const emptyRender = (): string =>
  `<style>${BASE_STYLE}</style><article class="kr-root"><p class="kr-empty" role="status">Provide Kniferoll Markdown to render.</p></article>`;

export class KrRecipeElement extends HTMLElement {
  static tagName = TAG_NAME;
  static get observedAttributes(): string[] {
    return [
      "scale",
      "preset",
      "quantity-display",
      "temperature-display",
      "layout",
      "diagnostics",
      "show-attributes",
    ];
  }

  #content: string | null = null;
  #inlineSource: string | null = null;
  #isConnected = false;
  #currentStepIndex: Map<string, number> = new Map(); // recipeId → current step index
  #activeRecipeId: string | null = null; // which recipe currently owns the step pointer
  #stepKeyboardHandler: ((e: KeyboardEvent) => void) | null = null;
  #editable = false;
  #editCleanup: (() => void) | null = null;
  #editSaveActive: (() => void) | null = null;
  #scaleMode: "fixed" | "by-ingredient" = "fixed";
  #scaleBarOpen = false;
  #anchorIngredientId: string | null = null;
  #anchorCustomAmount: number | null = null;
  #anchorDisplayText: string | null = null; // user-facing text for the anchor amount
  #anchorUnit: string | null = null;
  #anchorEditing = false; // whether the anchor input is visible
  #anchorCleanup: (() => void) | null = null;
  #scaleClickOutsideCleanup: (() => void) | null = null;
  #lastScaleFactor: number = 1;
  #suppressAttrCallback = false;
  #annotations: DiffAnnotation[] | null = null;

  connectedCallback(): void {
    this.#isConnected = true;
    this.#ensureShadowRoot();
    this.#render();
  }

  disconnectedCallback(): void {
    this.#isConnected = false;
    if (this.#editCleanup) {
      this.#editCleanup();
      this.#editCleanup = null;
      this.#editSaveActive = null;
    }
    if (this.#anchorCleanup) {
      this.#anchorCleanup();
      this.#anchorCleanup = null;
    }
    if (this.#scaleClickOutsideCleanup) {
      this.#scaleClickOutsideCleanup();
      this.#scaleClickOutsideCleanup = null;
    }
  }

  attributeChangedCallback(name: string): void {
    if (this.#suppressAttrCallback) return;
    // External scale/preset changes should exit anchor mode
    if (name === "scale" || name === "preset") {
      this.#resetScale();
    }
    if (this.#isConnected) {
      this.#render();
    }
  }

  set content(value: string | null) {
    this.#content = value;
    if (this.#isConnected) {
      this.#render();
    }
  }

  get content(): string | null {
    return this.#content ?? this.#inlineSource;
  }

  set editable(value: boolean) {
    const changed = this.#editable !== value;
    this.#editable = value;
    if (changed && this.#isConnected) {
      // Entering edit mode resets scale to 1x to avoid conflicts
      if (value) {
        this.#resetScale();
        this.#suppressAttrCallback = true;
        try {
          this.removeAttribute("scale");
          this.removeAttribute("preset");
        } finally {
          this.#suppressAttrCallback = false;
        }
      }
      this.#render();
    }
  }

  get editable(): boolean {
    return this.#editable;
  }

  /** Commit any in-progress inline edit (saves its value into the markdown). */
  commitActiveEdit(): void {
    this.#editSaveActive?.();
  }

  /** Set diff annotations to highlight added/changed/removed elements. */
  set annotations(value: DiffAnnotation[] | null) {
    this.#annotations = value;
    if (this.#isConnected) {
      this.#render();
    }
  }

  get annotations(): DiffAnnotation[] | null {
    return this.#annotations;
  }

  refresh(): void {
    if (this.#isConnected) {
      this.#render();
    }
  }

  #ensureShadowRoot(): ShadowRoot {
    if (!this.shadowRoot) {
      return this.attachShadow({ mode: "open" });
    }
    return this.shadowRoot;
  }

  #readInlineSource(): string {
    if (this.#inlineSource !== null) {
      return this.#inlineSource;
    }
    const text = (this.textContent ?? "").trim();
    this.#inlineSource = text;
    return text;
  }

  #parseScaleAttribute(): number | null {
    const raw = this.getAttribute("scale");
    if (raw == null) {
      return null;
    }

    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) {
      console.warn(`[kr-recipe] Ignoring invalid scale attribute "${raw}".`);
      return null;
    }

    return value;
  }

 #parsePresetSelection(value: string | null): ScaleSelection | null {
    if (value == null) {
      return null;
    }

    const trimmed = value.trim();
    if (trimmed === "") {
      return null;
    }

    const numeric = Number(trimmed);
    if (Number.isInteger(numeric) && numeric >= 0) {
      return { presetIndex: numeric } satisfies ScaleSelection;
    }

    return { presetName: trimmed } satisfies ScaleSelection;
  }

  #resolveScaleFactor(doc: DocumentParseResult): { factor: number; presetIndex: number | null } {
    // Anchor mode: compute scale from anchor ingredient
    if (this.#scaleMode === "by-ingredient" && this.#anchorIngredientId && this.#anchorCustomAmount != null) {
      const result = computeScaleFactor(doc, {
        anchor: {
          id: this.#anchorIngredientId,
          amount: this.#anchorCustomAmount,
          unit: this.#anchorUnit ?? "",
        },
      });
      if (result.ok) {
        return { factor: result.factor, presetIndex: null };
      }
      console.warn(`[kr-recipe] Anchor scaling: ${result.message}`);
    }

    const directScale = this.#parseScaleAttribute();
    if (directScale !== null) {
      return { factor: directScale, presetIndex: null };
    }

    const presetSelection = this.#parsePresetSelection(this.getAttribute("preset"));
    if (presetSelection) {
      const result = computeScaleFactor(doc, presetSelection);
      if (result.ok) {
        const presetIndex = result.preset?.index ?? ("presetIndex" in presetSelection ? presetSelection.presetIndex ?? null : null);
        return { factor: result.factor, presetIndex: presetIndex ?? null };
      }
      console.warn(`[kr-recipe] ${result.message}`);
    }

    return { factor: 1, presetIndex: null };
  }

  #resolveQuantityDisplay(): QuantityDisplayMode {
    const mode = this.getAttribute("quantity-display");
    if (!mode) {
      return "native";
    }

    const normalized = mode.trim().toLowerCase();
    if (normalized === "metric" || normalized === "imperial") {
      return normalized;
    }

    return "native";
  }

  #resolveTemperatureDisplay(): TemperatureDisplayMode {
    const attr = this.getAttribute("temperature-display");
    if (!attr) return null;
    const normalized = attr.trim().toUpperCase();
    if (normalized === "F" || normalized === "C") return normalized;
    return null;
  }

  #resolveLayout(): LayoutPreset {
    const layout = this.getAttribute("layout");
    if (!layout) {
      return "stacked";
    }

    const normalized = layout.trim().toLowerCase();
    switch (normalized) {
      case "two-column":
      case "steps-left":
      case "ingredients-left":
      case "print-compact":
        return normalized;
      default:
        return "stacked";
    }
  }

  #resolveDiagnosticsMode(): DiagnosticsMode {
    const attr = this.getAttribute("diagnostics");
    if (attr !== null) {
      const normalized = attr.trim().toLowerCase();
      if (normalized === "off" || normalized === "none") {
        return "off";
      }
      if (normalized === "panel" || normalized === "full") {
        return "panel";
      }
      if (normalized === "inline") {
        return "inline";
      }
      return "summary";
    }

    return "summary";
  }

  /**
   * Auto-activate anchor mode when a recipe has an `:: anchor` ingredient.
   * If a `scale` attribute is set, it acts as a multiplier on the anchor's
   * default amount (e.g., scale="2" doubles the anchor quantity).
   */
  #maybeAutoActivateAnchor(doc: DocumentParseResult): void {
    // Don't override if already in by-ingredient mode with a chosen anchor
    if (this.#scaleMode === "by-ingredient" && this.#anchorIngredientId) return;

    // Find the first anchor ingredient across all recipes
    for (const recipe of doc.recipes) {
      for (const ingredient of recipe.ingredients.ingredients) {
        if (ingredient.attributes.some((attr) => attr.key === "anchor")) {
          const target = resolveAnchorTarget(ingredient, this.#resolveQuantityDisplay());
          if (!target) continue;

          // Use scale attribute as a multiplier on the default anchor amount
          const scaleMultiplier = this.#parseScaleAttribute() ?? 1;

          this.#scaleMode = "by-ingredient";
          this.#anchorIngredientId = ingredient.id;
          this.#anchorCustomAmount = target.amount * scaleMultiplier;
          this.#anchorDisplayText = numberToFractionText(this.#anchorCustomAmount);
          this.#anchorUnit = target.unit;
          return;
        }
      }
    }
  }

  /** Reset all scale state back to 1× */
  #resetScale(): void {
    this.#scaleMode = "fixed";
    this.#scaleBarOpen = false;
    this.#anchorIngredientId = null;
    this.#anchorCustomAmount = null;
    this.#anchorDisplayText = null;
    this.#anchorUnit = null;
    this.#anchorEditing = false;
  }

  /** Suppress attributeChangedCallback during internal attribute updates, then render once. */
  #withSuppressedCallback(fn: () => void): void {
    this.#suppressAttrCallback = true;
    try { fn(); } finally { this.#suppressAttrCallback = false; }
    this.#render();
  }

  #pickFixedScale(value: string): void {
    this.#resetScale();
    this.#withSuppressedCallback(() => {
      this.removeAttribute("preset");
      if (value === "1") {
        this.removeAttribute("scale");
      } else {
        this.setAttribute("scale", value);
      }
    });
  }

  #pickPreset(index: string): void {
    this.#resetScale();
    this.#withSuppressedCallback(() => {
      this.removeAttribute("scale");
      this.setAttribute("preset", index);
    });
  }

  #pickByIngredient(): void {
    this.#resetScale();
    this.#scaleMode = "by-ingredient";
    this.#withSuppressedCallback(() => {
      this.removeAttribute("scale");
      this.removeAttribute("preset");
    });
  }

  #setupScaleInteractions(doc: DocumentParseResult): void {
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
      return;
    }

    const root = this.shadowRoot;
    if (!root) return;

    // Clean up previous listeners on persistent nodes (shadow root)
    if (this.#scaleClickOutsideCleanup) {
      this.#scaleClickOutsideCleanup();
      this.#scaleClickOutsideCleanup = null;
    }
    if (this.#anchorCleanup) {
      this.#anchorCleanup();
      this.#anchorCleanup = null;
    }

    const toggleBtn = root.querySelector<HTMLElement>(".kr-scale-toggle");
    const scaleBar = root.querySelector<HTMLElement>(".kr-scale-bar");
    if (!toggleBtn || !scaleBar) return;

    // --- Derive current label for the collapsed toggle ---
    const allChips = Array.from(scaleBar.querySelectorAll<HTMLElement>(".kr-scale-chip"));
    let toggleLabel = "1\u00d7";
    let activeSelector: string | null = null;

    let toggleIsHtml = false;
    if (this.#scaleMode === "by-ingredient") {
      toggleIsHtml = true;
      activeSelector = '[data-kr-scale-mode="by-ingredient"]';
    } else {
      const preset = this.getAttribute("preset");
      const scale = this.getAttribute("scale");
      if (preset != null) {
        activeSelector = `[data-kr-preset-index="${preset}"]`;
      } else {
        activeSelector = `[data-kr-scale-value="${scale ?? "1"}"]`;
      }
    }

    // Mark active chip
    for (const chip of allChips) {
      const isActive = activeSelector != null && chip.matches(activeSelector);
      chip.classList.toggle("kr-scale-chip--active", isActive);
      chip.setAttribute("aria-checked", String(isActive));
      if (isActive) {
        if (toggleIsHtml) {
          toggleLabel = ANCHOR_ICON_SMALL_SVG;
        } else if (chip.textContent) {
          toggleLabel = chip.textContent;
        }
      }
    }

    if (toggleIsHtml) {
      toggleBtn.innerHTML = toggleLabel;
    } else {
      toggleBtn.textContent = toggleLabel;
    }

    // --- Sync open/closed state ---
    if (this.#scaleBarOpen) {
      scaleBar.removeAttribute("hidden");
      toggleBtn.setAttribute("aria-expanded", "true");
      toggleBtn.classList.add("kr-scale-toggle--open");
    }

    // --- Event: toggle click opens/closes bar ---
    toggleBtn.addEventListener("click", (e: Event) => {
      e.stopPropagation();
      this.#scaleBarOpen = !this.#scaleBarOpen;
      if (this.#scaleBarOpen) {
        scaleBar.removeAttribute("hidden");
        toggleBtn.setAttribute("aria-expanded", "true");
        toggleBtn.classList.add("kr-scale-toggle--open");
      } else {
        scaleBar.setAttribute("hidden", "");
        toggleBtn.setAttribute("aria-expanded", "false");
        toggleBtn.classList.remove("kr-scale-toggle--open");
      }
    });

    // --- Event: click outside closes bar (on shadow root — must be cleaned up) ---
    const clickOutsideHandler = () => {
      if (this.#scaleBarOpen) {
        this.#scaleBarOpen = false;
        scaleBar.setAttribute("hidden", "");
        toggleBtn.setAttribute("aria-expanded", "false");
        toggleBtn.classList.remove("kr-scale-toggle--open");
      }
    };
    root.addEventListener("click", clickOutsideHandler);
    this.#scaleClickOutsideCleanup = () => root.removeEventListener("click", clickOutsideHandler);
    scaleBar.addEventListener("click", (e: Event) => e.stopPropagation());

    // --- Event: chip clicks ---
    for (const chip of allChips) {
      chip.addEventListener("click", () => {
        const sv = chip.dataset.krScaleValue;
        const pi = chip.dataset.krPresetIndex;
        const sm = chip.dataset.krScaleMode;

        if (sm === "by-ingredient") {
          this.#pickByIngredient();
        } else if (pi != null) {
          this.#pickPreset(pi);
        } else if (sv != null) {
          this.#pickFixedScale(sv);
        }
      });
    }

    // --- Anchor mode setup ---
    if (this.#scaleMode === "by-ingredient") {
      const krRoot = root.querySelector(".kr-root");
      if (krRoot) {
        krRoot.setAttribute("data-kr-anchor-mode", "");
      }

      const cleanupFns: (() => void)[] = [];
      const scalableIngredients = Array.from(
        root.querySelectorAll<HTMLElement>('.kr-ingredient[data-kr-scalable="true"]'),
      );

      const quantityDisplay = this.#resolveQuantityDisplay();
      for (const ingEl of scalableIngredients) {
        const handler = () => {
          const id = ingEl.dataset.krId;
          if (!id) return;

          // If this ingredient is already the anchor, just open the editor
          if (id === this.#anchorIngredientId) {
            this.#anchorEditing = true;
            this.#render();
            return;
          }

          for (const recipe of doc.recipes) {
            for (const ing of recipe.ingredients.ingredients) {
              if (ing.id === id) {
                const target = resolveAnchorTarget(ing, quantityDisplay);
                if (!target) return;
                this.#anchorIngredientId = id;
                this.#anchorCustomAmount = target.amount;
                this.#anchorDisplayText = target.displayText;
                this.#anchorUnit = target.unit;
                this.#anchorEditing = true;
                this.#render();
                return;
              }
            }
          }
        };
        ingEl.addEventListener("click", handler);
        cleanupFns.push(() => ingEl.removeEventListener("click", handler));
      }

      this.#anchorCleanup = () => cleanupFns.forEach((fn) => fn());

      if (this.#anchorIngredientId) {
        this.#renderAnchorInput(root);
      } else if (scalableIngredients.length > 0) {
        // Cycle the anchor icon through scalable ingredients as a hint
        let cycleIndex = 0;
        let prevIcon: HTMLElement | null = null;

        const showIconAt = (index: number) => {
          if (prevIcon?.parentElement) {
            prevIcon.remove();
          }
          const el = scalableIngredients[index];
          if (!el) return;
          el.classList.add("kr-ingredient--anchor-hint");
          const icon = document.createElement("span");
          icon.className = "kr-anchor-icon kr-anchor-icon--hint";
          icon.innerHTML = ANCHOR_ICON_SVG;
          el.prepend(icon);
          prevIcon = icon;

          // Remove class from previous
          for (const other of scalableIngredients) {
            if (other !== el) other.classList.remove("kr-ingredient--anchor-hint");
          }
        };

        showIconAt(0);
        const cycleTimer = setInterval(() => {
          cycleIndex = (cycleIndex + 1) % scalableIngredients.length;
          showIconAt(cycleIndex);
        }, 1200);

        cleanupFns.push(() => {
          clearInterval(cycleTimer);
          if (prevIcon?.parentElement) prevIcon.remove();
          for (const el of scalableIngredients) {
            el.classList.remove("kr-ingredient--anchor-hint");
          }
        });
      }
    }
  }

  #renderAnchorInput(root: ShadowRoot): void {
    if (!this.#anchorIngredientId) return;

    const anchorEl = root.querySelector<HTMLElement>(
      `.kr-ingredient[data-kr-id="${this.#anchorIngredientId}"]`,
    );
    if (!anchorEl) return;

    anchorEl.classList.add("kr-ingredient--anchor");
    const qtySpan = anchorEl.querySelector<HTMLElement>(".kr-ingredient__quantity");
    if (!qtySpan) return;

    const displayText = this.#anchorDisplayText ?? numberToFractionText(this.#anchorCustomAmount ?? 1);
    const unitLabel = this.#anchorUnit ?? "";

    if (!this.#anchorEditing) {
      // Display mode: pin in gutter, normal quantity text (clickable to edit)
      // Keep the existing rendered quantity text, just prepend the pin icon
      const existingText = qtySpan.textContent ?? `${displayText}${unitLabel ? ` ${unitLabel}` : ""}`;
      qtySpan.innerHTML = `<span class="kr-anchor-icon">${ANCHOR_ICON_SVG}</span>${escapeHtml(existingText)}`;
      qtySpan.classList.add("kr-anchor-display");
      qtySpan.addEventListener("click", (e: Event) => {
        e.stopPropagation();
        this.#anchorEditing = true;
        this.#render();
      });
      return;
    }

    // Edit mode: pin in gutter, input + unit label
    const unitSuffix = unitLabel ? ` <span class="kr-anchor-unit">${escapeHtml(unitLabel)}</span>` : "";
    qtySpan.innerHTML = `<span class="kr-anchor-icon">${ANCHOR_ICON_SVG}</span><input class="kr-anchor-input" type="text" value="${escapeAttr(displayText)}" aria-label="Scale quantity">${unitSuffix}`;

    const input = qtySpan.querySelector<HTMLInputElement>(".kr-anchor-input");
    if (!input) return;

    // Size input to fit its value
    const sizeToFit = () => { input.style.width = `${Math.max(2, input.value.length + 1)}ch`; };
    sizeToFit();
    input.addEventListener("input", sizeToFit);

    input.select();
    if (typeof input.focus === "function") {
      input.focus();
    }

    const commitAndClose = () => {
      // Guard against blur firing on a detached input during innerHTML replacement
      if (!input.isConnected) return;
      const text = input.value.trim();
      const val = readNumber(text);
      if (val != null && val > 0) {
        this.#anchorCustomAmount = val;
        this.#anchorDisplayText = text;
      }
      this.#anchorEditing = false;
      this.#render();
    };

    input.addEventListener("blur", commitAndClose);

    input.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        commitAndClose();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.#anchorEditing = false;
        this.#render();
      }
    });

    // Prevent ingredient click from triggering while editing
    input.addEventListener("click", (e: Event) => e.stopPropagation());
  }

  #setupReferenceInteractions(): void {
    if (typeof document === "undefined") {
      return;
    }

    const root = this.shadowRoot;
    if (!root) {
      return;
    }

    const refs = Array.from(
      root.querySelectorAll<HTMLElement>(".kr-ref[data-kr-target]"),
    );
    if (refs.length === 0) {
      return;
    }

    let activeRef: HTMLElement | null = null;
    let lockedRef: HTMLElement | null = null;

    const clearHighlight = () => {
      if (activeRef) {
        activeRef.classList.remove("kr-ref--active");
        activeRef.removeAttribute("aria-pressed");
      }
      root.querySelectorAll(".kr-target-highlight").forEach((node) => {
        node.classList.remove("kr-target-highlight");
        node.removeAttribute("data-kr-target-active");
      });
      activeRef = null;
    };

    const highlight = (ref: HTMLElement, targetIds: string[], lock: boolean) => {
      const targetNodes: HTMLElement[] = [];
      for (const id of targetIds) {
        const escaped = cssEscape(id);
        root.querySelectorAll<HTMLElement>(`[data-kr-id="${escaped}"]`).forEach(
          (node) => targetNodes.push(node),
        );
      }
      if (targetNodes.length === 0) {
        return;
      }

      if (activeRef && activeRef !== ref) {
        clearHighlight();
      }

      activeRef = ref;
      if (!targetNodes.some((node) => node.classList.contains("kr-target-highlight"))) {
        targetNodes.forEach((node) => {
          node.classList.add("kr-target-highlight");
          node.setAttribute("data-kr-target-active", "true");
        });
      }
      ref.classList.add("kr-ref--active");
      if (lock) {
        ref.setAttribute("aria-pressed", "true");
      } else {
        ref.removeAttribute("aria-pressed");
      }
      if (lock) {
        lockedRef = ref;
        const primaryTarget = targetNodes[0];
        if (primaryTarget && typeof primaryTarget.scrollIntoView === "function") {
          primaryTarget.scrollIntoView({ behavior: "smooth", block: "nearest" });
        }
        if (primaryTarget && typeof primaryTarget.focus === "function") {
          primaryTarget.focus({ preventScroll: true });
        }
      }

    };

    refs.forEach((ref) => {
      const targetAttr = ref.getAttribute("data-kr-target");
      if (!targetAttr) {
        return;
      }
      const targetIds = targetAttr.split(" ").filter(Boolean);

      ref.addEventListener("pointerenter", () => {
        if (lockedRef && lockedRef !== ref) {
          return;
        }
        highlight(ref, targetIds, false);
      });

      ref.addEventListener("pointerleave", () => {
        if (lockedRef && lockedRef !== ref) {
          return;
        }
        if (!lockedRef) {
          clearHighlight();
        }
      });

      ref.addEventListener("focus", () => {
        highlight(ref, targetIds, false);
      });

      ref.addEventListener("blur", () => {
        if (!lockedRef) {
          clearHighlight();
        }
      });

      const activate = (lock: boolean) => {
        if (lock && lockedRef === ref) {
          lockedRef = null;
          clearHighlight();
          return;
        }
        highlight(ref, targetIds, lock);
      };

      ref.addEventListener("click", (event) => {
        event.preventDefault();
        activate(true);
      });

      ref.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          activate(true);
        }
      });
    });
  }

  #setupSubrecipeLinks(): void {
    const root = this.shadowRoot;
    if (!root?.querySelectorAll) return;

    for (const link of Array.from(root.querySelectorAll<HTMLAnchorElement>(".kr-subrecipe-link"))) {
      link.addEventListener("click", (event: Event) => {
        event.preventDefault();
        const href = link.getAttribute("href");
        if (!href) return;
        const recipeId = href.slice(1); // strip leading #
        const target = root.getElementById(`kr-recipe-${recipeId}`);
        target?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  #render(): void {
    const shadow = this.#ensureShadowRoot();
    const source = (this.#content ?? this.#readInlineSource()).trim();
    if (source.length === 0) {
      shadow.innerHTML = emptyRender();
      return;
    }

    // Preserve diagnostics panel open/closed state across re-renders
    const existingDiagnostics =
      typeof shadow.querySelector === "function"
        ? shadow.querySelector<HTMLDetailsElement>(".kr-diagnostics")
        : null;
    const diagnosticsWasOpen = existingDiagnostics?.open ?? false;

    const result = parseDocument(source);

    // Auto-activate anchor mode when :: anchor attribute is present
    this.#maybeAutoActivateAnchor(result);

    const scaleResolution = this.#resolveScaleFactor(result);
    const quantityDisplay = this.#resolveQuantityDisplay();
    const temperatureDisplay = this.#resolveTemperatureDisplay();
    const layout = this.#resolveLayout();
    const html = renderDocument(result, {
      scaleFactor: scaleResolution.factor,
      quantityDisplay,
      temperatureDisplay,
      layout,
      diagnosticsMode: this.#resolveDiagnosticsMode(),
      sourceLines: source.split("\n"),
      hideScale: this.hasAttribute("no-scale"),
      showAttributes: this.hasAttribute("show-attributes"),
      annotations: this.#annotations ?? undefined,
    });
    shadow.innerHTML = html;

    // Restore diagnostics panel state
    if (diagnosticsWasOpen) {
      const newDiagnostics = shadow.querySelector<HTMLDetailsElement>(".kr-diagnostics");
      if (newDiagnostics) {
        newDiagnostics.open = true;
      }
    }

    this.#setupScaleInteractions(result);

    // Dispatch kr:scale-change when factor changes
    if (scaleResolution.factor !== this.#lastScaleFactor) {
      this.#lastScaleFactor = scaleResolution.factor;
      const scaleDetail: { factor: number; mode: string; anchorId?: string } = {
        factor: scaleResolution.factor,
        mode: this.#scaleMode,
      };
      if (this.#scaleMode === "by-ingredient" && this.#anchorIngredientId) {
        scaleDetail.anchorId = this.#anchorIngredientId;
      }
      this.dispatchEvent(new CustomEvent("kr:scale-change", { detail: scaleDetail }));
    }

    if (!this.#editable) {
      this.#setupReferenceInteractions();
      this.#setupSubrecipeLinks();
    }
    this.#setupDiagnosticMarkers();
    this.#setupStepProgressionInteractions();

    // Edit mode setup
    if (this.#editCleanup) {
      this.#editCleanup();
      this.#editCleanup = null;
      this.#editSaveActive = null;
    }
    if (this.#editable) {
      const article = shadow.querySelector(".kr-root");
      if (article) {
        article.setAttribute("data-kr-editable", "");
      }
      const spans = computeSourceSpans(source.split("\n"), result);
      const edit = setupEditInteractions(shadow, result, spans, {
        getMarkdown: () => this.#content ?? this.#readInlineSource(),
        applyEdit: (edits) => {
          const currentMarkdown = this.#content ?? this.#readInlineSource();
          const newMarkdown = applyLineEdits(currentMarkdown, edits);
          this.#content = newMarkdown;
          this.#render();
          this.dispatchEvent(
            new CustomEvent("kr:content-change", {
              detail: { markdown: newMarkdown },
              bubbles: true,
            }),
          );
        },
      }, { showAttributes: this.hasAttribute("show-attributes") });
      this.#editCleanup = edit.cleanup;
      this.#editSaveActive = edit.saveActive;
    }
  }

  #setupDiagnosticMarkers(): void {
    const root = this.shadowRoot;
    if (!root) {
      return;
    }

    if (typeof (root as ShadowRoot).querySelectorAll !== "function") {
      return;
    }

    const triggers = Array.from(
      root.querySelectorAll<HTMLElement>(".kr-diagnostic-target[aria-controls]"),
    );
    if (triggers.length === 0) {
      return;
    }

    const popovers = Array.from(root.querySelectorAll<HTMLElement>(".kr-diagnostic-popover"));

    const closeAll = () => {
      popovers.forEach((popover) => {
        popover.hidden = true;
      });
      triggers.forEach((trigger) => {
        trigger.setAttribute("aria-expanded", "false");
      });
    };

    triggers.forEach((trigger) => {
      const controlsId = trigger.getAttribute("aria-controls");
      const popover = controlsId ? root.getElementById(controlsId) : null;

      trigger.addEventListener("click", (event) => {
        event.stopPropagation();
        const expanded = trigger.getAttribute("aria-expanded") === "true";
        closeAll();
        if (!expanded && popover) {
          trigger.setAttribute("aria-expanded", "true");
          popover.hidden = false;
        }
      });

      trigger.addEventListener("keydown", (event) => {
        const origin = event.target as HTMLElement | undefined;
        if (origin?.tagName === "INPUT" || origin?.tagName === "TEXTAREA") return;
        if (event.key === "Escape") {
          closeAll();
          trigger.focus();
        }
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          trigger.click();
        }
      });
    });

    popovers.forEach((popover) => {
      popover.addEventListener("click", (event) => event.stopPropagation());
    });

    root.addEventListener("click", () => {
      closeAll();
    });

    // Make diagnostic list items clickable to emit kr:diagnostic-click
    const listItems = Array.from(
      root.querySelectorAll<HTMLElement>(".kr-diagnostics__item[data-kr-line]"),
    );
    for (const item of listItems) {
      item.style.cursor = "pointer";
      item.addEventListener("click", () => {
        const line = parseInt(item.dataset.krLine ?? "", 10);
        if (!isNaN(line)) {
          this.dispatchEvent(
            new CustomEvent("kr:diagnostic-click", {
              detail: { line },
              bubbles: true,
            }),
          );
        }
      });
    }
  }


  #setupStepProgressionInteractions(): void {
    const root = this.shadowRoot;
    if (!root) {
      return;
    }

    if (typeof (root as ShadowRoot).querySelectorAll !== "function") {
      return;
    }

    const steps = Array.from(root.querySelectorAll<HTMLElement>(".kr-step[data-kr-step-index]"));
    if (steps.length === 0) {
      return;
    }

    // Click handler for steps
    steps.forEach((step) => {
      const handleStepClick = () => {
        if (this.#editable) return;
        const recipeId = step.getAttribute("data-kr-recipe-id") ?? "";
        const stepIndex = Number(step.getAttribute("data-kr-step-index"));

        if (!Number.isNaN(stepIndex) && stepIndex >= 0) {
          this.#setCurrentStep(recipeId, stepIndex);
        }
      };

      step.addEventListener("click", handleStepClick);
      step.addEventListener("keydown", (e) => {
        if (this.#editable) return;
        if (e.key === "Enter") {
          e.preventDefault();
          handleStepClick();
        }
      });
    });

    // Remove old keyboard handler if it exists
    if (this.#stepKeyboardHandler) {
      this.removeEventListener("keydown", this.#stepKeyboardHandler);
    }

    // Global keyboard handler for navigation
    const handleKeyDown = (e: KeyboardEvent) => {
      // Disable step navigation in edit mode
      if (this.#editable) return;

      // Don't intercept keys when an input/textarea is focused (check composedPath for shadow DOM)
      const origin = e.composedPath()[0] as HTMLElement | undefined;
      const originTag = origin?.tagName;
      if (originTag === "INPUT" || originTag === "TEXTAREA") return;

      // Only handle if not focused on a specific interactive element
      if (e.target !== this && !(e.target as HTMLElement)?.closest?.('.kr-recipe')) {
        return;
      }

      const isArrowKey = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"].includes(e.key);
      const isSpace = e.key === " ";

      if (isArrowKey || isSpace) {
        e.preventDefault();

        if (e.shiftKey && (e.key === "ArrowDown" || e.key === "ArrowRight")) {
          this.#jumpToNextRecipe();
        } else if (e.shiftKey && (e.key === "ArrowUp" || e.key === "ArrowLeft")) {
          this.#jumpToPreviousRecipe();
        } else if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === " ") {
          this.#advanceToNextStep();
        } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
          this.#advanceToPreviousStep();
        }
      }
    };

    // Store handler reference for cleanup
    this.#stepKeyboardHandler = handleKeyDown;

    // Make host element focusable for keyboard events
    if (!this.hasAttribute("tabindex")) {
      this.setAttribute("tabindex", "0");
    }

    this.addEventListener("keydown", handleKeyDown);

    // Initialize first step if none selected
    const firstStep = steps[0];
    if (firstStep) {
      const recipeId = firstStep.getAttribute("data-kr-recipe-id") ?? "";
      if (recipeId && !this.#currentStepIndex.has(recipeId)) {
        this.#setCurrentStep(recipeId, 0);
      }
    }
  }

  #setCurrentStep(recipeId: string, stepIndex: number): void {
    const root = this.shadowRoot;
    if (!root) {
      return;
    }

    // Clear active step in all other recipes
    if (this.#activeRecipeId && this.#activeRecipeId !== recipeId) {
      const oldSteps = Array.from(
        root.querySelectorAll<HTMLElement>(`.kr-step[data-kr-recipe-id="${cssEscape(this.#activeRecipeId)}"]`)
      );
      oldSteps.forEach((step) => step.setAttribute("aria-pressed", "false"));
    }

    // Update stored index and active recipe
    this.#activeRecipeId = recipeId;
    this.#currentStepIndex.set(recipeId, stepIndex);

    // Update aria-pressed on all steps for this recipe
    const steps = Array.from(
      root.querySelectorAll<HTMLElement>(`.kr-step[data-kr-recipe-id="${cssEscape(recipeId)}"]`)
    );

    let activeStep: HTMLElement | null = null;
    steps.forEach((step) => {
      const thisStepIndex = Number(step.getAttribute("data-kr-step-index"));
      const isActive = thisStepIndex === stepIndex;
      step.setAttribute("aria-pressed", isActive ? "true" : "false");
      if (isActive) activeStep = step;
    });

    // Scroll the active step into view if needed
    if (activeStep && typeof (activeStep as HTMLElement).scrollIntoView === "function") {
      (activeStep as HTMLElement).scrollIntoView({ block: "nearest", behavior: "smooth" });
    }

    // Highlight ingredients referenced in current step
    this.#updateIngredientHighlights(recipeId, stepIndex);

    // Dispatch event
    const detail = { recipeId, stepIndex };
    this.dispatchEvent(new CustomEvent("kr:step-focus", { detail }));
  }

  #advanceToNextStep(): void {
    const root = this.shadowRoot;
    if (!root) {
      return;
    }

    const recipeId = this.#activeRecipeId;
    if (!recipeId) {
      // No active recipe, activate first step of first recipe
      const firstStep = root.querySelector<HTMLElement>(".kr-step[data-kr-step-index]");
      if (firstStep) {
        const id = firstStep.getAttribute("data-kr-recipe-id") ?? "";
        this.#setCurrentStep(id, 0);
      }
      return;
    }

    const currentIndex = this.#currentStepIndex.get(recipeId) ?? 0;

    // Find next step in same recipe
    const nextStep = root.querySelector<HTMLElement>(
      `.kr-step[data-kr-recipe-id="${cssEscape(recipeId)}"][data-kr-step-index="${currentIndex + 1}"]`
    );

    if (nextStep) {
      this.#setCurrentStep(recipeId, currentIndex + 1);
    }
    // If no next step, stay at current (don't wrap around)
  }

  #advanceToPreviousStep(): void {
    const recipeId = this.#activeRecipeId;
    if (!recipeId) {
      return;
    }

    const root = this.shadowRoot;
    if (!root) {
      return;
    }

    const currentIndex = this.#currentStepIndex.get(recipeId) ?? 0;

    if (currentIndex === 0) {
      return; // Already at first step
    }

    // Find previous step in same recipe
    const prevStep = root.querySelector<HTMLElement>(
      `.kr-step[data-kr-recipe-id="${cssEscape(recipeId)}"][data-kr-step-index="${currentIndex - 1}"]`
    );

    if (prevStep) {
      this.#setCurrentStep(recipeId, currentIndex - 1);
    }
  }

  #getRecipeIds(): string[] {
    const root = this.shadowRoot;
    if (!root) return [];
    const steps = Array.from(root.querySelectorAll<HTMLElement>(".kr-step[data-kr-recipe-id]"));
    const seen = new Set<string>();
    const ids: string[] = [];
    for (const step of steps) {
      const id = step.getAttribute("data-kr-recipe-id") ?? "";
      if (id && !seen.has(id)) {
        seen.add(id);
        ids.push(id);
      }
    }
    return ids;
  }

  #jumpToNextRecipe(): void {
    const recipeIds = this.#getRecipeIds();
    const currentIdx = this.#activeRecipeId ? recipeIds.indexOf(this.#activeRecipeId) : -1;
    if (currentIdx < 0 || currentIdx >= recipeIds.length - 1) return;
    this.#setCurrentStep(recipeIds[currentIdx + 1]!, 0);
  }

  #jumpToPreviousRecipe(): void {
    const recipeIds = this.#getRecipeIds();
    const currentIdx = this.#activeRecipeId ? recipeIds.indexOf(this.#activeRecipeId) : -1;
    if (currentIdx <= 0) return;
    this.#setCurrentStep(recipeIds[currentIdx - 1]!, 0);
  }

  #updateIngredientHighlights(recipeId: string, stepIndex: number): void {
    const root = this.shadowRoot;
    if (!root) {
      return;
    }

    // Get the current step element
    const step = root.querySelector<HTMLElement>(
      `.kr-step[data-kr-recipe-id="${cssEscape(recipeId)}"][data-kr-step-index="${stepIndex}"]`
    );

    // Clear all highlights first
    root.querySelectorAll<HTMLElement>(".kr-ingredient[data-kr-step-highlight]").forEach((ing) => {
      ing.removeAttribute("data-kr-step-highlight");
    });

    if (!step) {
      return;
    }

    // Find all ingredient references in this step
    const refs = Array.from(step.querySelectorAll<HTMLElement>(".kr-ref[data-kr-target]"));
    const targetIds = new Set(refs.map((ref) => ref.getAttribute("data-kr-target")).filter(Boolean));

    // Highlight corresponding ingredients
    targetIds.forEach((targetId) => {
      const ingredient = root.querySelector<HTMLElement>(
        `.kr-ingredient[data-kr-id="${cssEscape(targetId!)}"]`
      );
      if (ingredient) {
        ingredient.setAttribute("data-kr-step-highlight", "true");
      }
    });
  }
}

// ── Typed event support ──────────────────────────────────────────────

export interface KrRecipeContentChangeDetail {
  markdown: string;
}

export interface KrRecipeDiagnosticClickDetail {
  line: number;
}

export interface KrRecipeEventMap extends HTMLElementEventMap {
  "kr:content-change": CustomEvent<KrRecipeContentChangeDetail>;
  "kr:diagnostic-click": CustomEvent<KrRecipeDiagnosticClickDetail>;
}

/** Merge typed addEventListener/removeEventListener onto the class. */
export interface KrRecipeElement {
  addEventListener<K extends keyof KrRecipeEventMap>(
    type: K,
    listener: (this: KrRecipeElement, ev: KrRecipeEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions,
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  removeEventListener<K extends keyof KrRecipeEventMap>(
    type: K,
    listener: (this: KrRecipeElement, ev: KrRecipeEventMap[K]) => void,
    options?: boolean | EventListenerOptions,
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions,
  ): void;
}

export const registerKrRecipeElement = (): void => {
  if (typeof customElements === "undefined") {
    return;
  }

  if (!customElements.get(TAG_NAME)) {
    customElements.define(TAG_NAME, KrRecipeElement);
  }
};

registerKrRecipeElement();
