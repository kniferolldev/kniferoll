/// <reference lib="dom" />

import { parseDocument } from "../core/parser";
import { computeScaleFactor } from "../core/scale";
import { scaleQuantity } from "../core/scale-quantity";
import { formatQuantity, numberToFractionText } from "../core/format";
import { isMetricFamily, lookupUnit } from "../core/units";
import { readNumber } from "../core/quantity";
import { slug } from "../core/slug";
import { computeSourceSpans } from "../core/source-spans";
import { applyLineEdits } from "../core/edit-format";
import { setupEditInteractions } from "./edit";
import BASE_STYLE from "./styles.css" with { type: "text" };
import type {
  Diagnostic,
  DocumentParseResult,
  DocumentStepTemperatureToken,
  DocumentStepTimerToken,
  DocumentStepToken,
  Ingredient,
  IngredientAttribute,
  IngredientsSection,
  NotesSection,
  Recipe,
  RecipeSection,
  Quantity,
  TimerDuration,
  UnitDimension,
  UnitFamily,
  ScalePreset,
  ScaleSelection,
  SectionLine,
  Source,
} from "../core/types";
import type { SourceSpan } from "../core/source-spans";

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

const renderIntro = (
  markdown: string,
  sourceLines?: string[],
  startLine?: number,
  endLine?: number,
): string => {
  // When source lines are available, split into paragraphs by blank lines
  // and assign data-kr-line to each paragraph for inline editing
  if (sourceLines && startLine != null && endLine != null) {
    const paragraphs: { text: string; line: number }[] = [];
    let currentLines: string[] = [];
    let currentStart = -1;

    for (let i = startLine; i <= endLine; i++) {
      const lineText = (sourceLines[i - 1] ?? "").trim();
      if (lineText === "") {
        if (currentLines.length > 0) {
          paragraphs.push({ text: currentLines.join(" "), line: currentStart });
          currentLines = [];
          currentStart = -1;
        }
      } else {
        if (currentStart === -1) currentStart = i;
        currentLines.push(lineText);
      }
    }
    if (currentLines.length > 0) {
      paragraphs.push({ text: currentLines.join(" "), line: currentStart });
    }

    const html = paragraphs
      .map((p) => {
        const content = renderMarkdownInline(p.text);
        return `<p class="kr-intro__p" data-kr-line="${p.line}">${content}</p>`;
      })
      .join("");
    return `<div class="kr-intro">${html}</div>`;
  }

  // Fallback when source lines aren't available (no line tracking)
  const paragraphs = markdown.split(/\n\n+/).filter((p) => p.trim());
  const html = paragraphs
    .map((p) => {
      const content = renderMarkdownInline(p.replace(/\n/g, " ").trim());
      return `<p class="kr-intro__p">${content}</p>`;
    })
    .join("");
  return `<div class="kr-intro">${html}</div>`;
};

// Notes section markdown rendering
type NotesBlockType = "paragraph" | "header" | "ul" | "ol";

interface NotesBlock {
  type: NotesBlockType;
  lines: SectionLine[];
  level?: number; // for headers (3 = ###, 4 = ####)
}

const getLineType = (
  text: string,
): { type: NotesBlockType; level?: number; content: string } => {
  // Headers: ### or ####
  const headerMatch = text.match(/^(#{3,4})\s+(.*)$/);
  if (headerMatch) {
    return {
      type: "header",
      level: headerMatch[1]!.length,
      content: headerMatch[2]!,
    };
  }
  // Unordered list: - or *
  const ulMatch = text.match(/^[-*]\s+(.*)$/);
  if (ulMatch) {
    return { type: "ul", content: ulMatch[1]! };
  }
  // Ordered list: 1. 2. etc
  const olMatch = text.match(/^\d+\.\s+(.*)$/);
  if (olMatch) {
    return { type: "ol", content: olMatch[1]! };
  }
  // Paragraph
  return { type: "paragraph", content: text };
};

const parseNotesBlocks = (lines: SectionLine[]): NotesBlock[] => {
  const blocks: NotesBlock[] = [];
  let currentBlock: NotesBlock | null = null;

  for (const line of lines) {
    const trimmed = line.text.trim();

    // Empty lines end current block
    if (!trimmed) {
      if (currentBlock) {
        blocks.push(currentBlock);
        currentBlock = null;
      }
      continue;
    }

    const { type, level, content } = getLineType(trimmed);

    // Headers are always their own block
    if (type === "header") {
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      blocks.push({
        type: "header",
        level,
        lines: [{ ...line, text: content }],
      });
      currentBlock = null;
      continue;
    }

    // Lists: group consecutive items of same type
    if (type === "ul" || type === "ol") {
      if (currentBlock && currentBlock.type === type) {
        currentBlock.lines.push({ ...line, text: content });
      } else {
        if (currentBlock) {
          blocks.push(currentBlock);
        }
        currentBlock = { type, lines: [{ ...line, text: content }] };
      }
      continue;
    }

    // Paragraphs: group consecutive non-empty lines
    if (currentBlock && currentBlock.type === "paragraph") {
      currentBlock.lines.push(line);
    } else {
      if (currentBlock) {
        blocks.push(currentBlock);
      }
      currentBlock = { type: "paragraph", lines: [line] };
    }
  }

  if (currentBlock) {
    blocks.push(currentBlock);
  }

  return blocks;
};

const renderNotesBlock = (block: NotesBlock, options: RenderOptions): string => {
  const renderInlineDiagnostics = (lineNum: number) => {
    if (options.diagnosticsMode !== "inline" || !options.diagnosticsMap) {
      return null;
    }
    const diagnostics = options.diagnosticsMap.get(lineNum);
    if (!diagnostics?.length) return null;
    const severity = diagnostics.some((d) => d.code.startsWith("E"))
      ? "error"
      : "warning";
    const controlsId = options.nextDiagnosticId?.() ?? `diag-${lineNum}`;
    const popover = `<div class="kr-diagnostic-popover" id="${escapeAttr(controlsId)}" popover="auto">${diagnostics
      .map(
        (d) =>
          `<div class="kr-diagnostic-popover__item kr-diagnostic-popover__item--${d.code.startsWith("E") ? "error" : "warning"}">${escapeHtml(d.message)}</div>`,
      )
      .join("")}</div>`;
    return { severity, controlsId, popover };
  };

  switch (block.type) {
    case "header": {
      const line = block.lines[0]!;
      const tag = block.level === 4 ? "h5" : "h4";
      const content = renderMarkdownInline(line.text);
      return `<${tag} class="kr-notes__header" data-kr-line="${line.line}">${content}</${tag}>`;
    }
    case "ul":
    case "ol": {
      const tag = block.type === "ul" ? "ul" : "ol";
      const items = block.lines
        .map((line) => {
          const inlineDiag = renderInlineDiagnostics(line.line);
          const diagnosticClass = inlineDiag ? " kr-diagnostic-target" : "";
          const diagnosticAttr = inlineDiag
            ? ` data-kr-diagnostic-severity="${inlineDiag.severity}" role="button" aria-expanded="false" aria-controls="${escapeAttr(inlineDiag.controlsId)}" tabindex="0"`
            : "";
          const diagnosticContent = inlineDiag ? inlineDiag.popover : "";
          const content = renderMarkdownInline(line.text);
          return `<li class="kr-notes__list-item${diagnosticClass}" data-kr-line="${line.line}"${diagnosticAttr}>${diagnosticContent}${content}</li>`;
        })
        .join("");
      return `<${tag} class="kr-notes__list kr-notes__list--${block.type === "ul" ? "unordered" : "ordered"}">${items}</${tag}>`;
    }
    case "paragraph": {
      // Join lines and render as paragraph
      const firstLine = block.lines[0]!;
      const text = block.lines.map((l) => l.text.trim()).join(" ");
      const inlineDiag = renderInlineDiagnostics(firstLine.line);
      const diagnosticClass = inlineDiag ? " kr-diagnostic-target" : "";
      const diagnosticAttr = inlineDiag
        ? ` data-kr-diagnostic-severity="${inlineDiag.severity}" role="button" aria-expanded="false" aria-controls="${escapeAttr(inlineDiag.controlsId)}" tabindex="0"`
        : "";
      const diagnosticContent = inlineDiag ? inlineDiag.popover : "";
      const content = renderMarkdownInline(text);
      return `<p class="kr-notes__paragraph${diagnosticClass}" data-kr-line="${firstLine.line}"${diagnosticAttr}>${diagnosticContent}${content}</p>`;
    }
  }
};

const renderNotesSection = (
  section: NotesSection,
  options: RenderOptions,
): string => {
  const heading = `<h3 class="kr-section__title">${escapeHtml(section.title)}</h3>`;
  if (!section.lines.length) {
    return `<section class="kr-section" data-kr-kind="notes">${heading}</section>`;
  }

  const blocks = parseNotesBlocks(section.lines);
  const content = blocks.map((block) => renderNotesBlock(block, options)).join("");

  return `<section class="kr-section" data-kr-kind="notes">${heading}<div class="kr-section__body">${content}</div></section>`;
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
}

const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  scaleFactor: 1,
  quantityDisplay: "native",
  temperatureDisplay: null,
  layout: "stacked",
  diagnosticsMode: "summary",
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

const dimensionFromUnit = (unitFamily: UnitFamily | undefined, dimension: UnitDimension | undefined): DimensionKind => {
  if (!unitFamily && !dimension) {
    return null;
  }

  if (dimension === "mass" || unitFamily === "mass") {
    return "mass";
  }

  if (
    dimension === "volume" ||
    unitFamily === "volume_metric" ||
    unitFamily === "volume_us"
  ) {
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
    const preferred = candidates.find((c) => c.isMetric && c.text);
    if (preferred) return preferred;
  } else if (mode === "imperial") {
    const preferred = candidates.find((c) => !c.isMetric && c.hasQuantity && c.text);
    if (preferred) return preferred;
  }

  const withQuantity = candidates.find((candidate) => candidate.hasQuantity && candidate.text);
  if (withQuantity) {
    return withQuantity;
  }

  return candidates.find((candidate) => candidate.text) ?? candidates[0] ?? null;
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

const summarizeDiagnostics = (diagnostics: Diagnostic[]): string =>
  diagnostics
    .map(
      (diag) =>
        `${diag.severity === "error" ? "Error" : "Warning"} ${diag.code}: ${diag.message}`,
    )
    .join(" • ");

const renderInlineDiagnostics = (
  lineNumber: number,
  options: RenderOptions,
): { popover: string; severity: "error" | "warning"; controlsId: string } | null => {
  if (options.diagnosticsMode !== "inline" || !options.diagnosticsMap) {
    return null;
  }

  const diagnostics = options.diagnosticsMap.get(lineNumber);
  if (!diagnostics || diagnostics.length === 0) {
    return null;
  }

  const severity = diagnostics.some((diag) => diag.severity === "error") ? "error" : "warning";
  const markerId = options.nextDiagnosticId
    ? options.nextDiagnosticId()
    : `kr-diagnostic-${lineNumber}-${Math.random().toString(36).slice(2)}`;

  const items = diagnostics
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

const durationToSeconds = (duration: TimerDuration): number =>
  duration.hours * 3600 + duration.minutes * 60 + duration.seconds;

const durationToMilliseconds = (duration: TimerDuration): number =>
  durationToSeconds(duration) * 1000;

const formatDurationDisplay = (duration: TimerDuration): string => {
  const parts: string[] = [];
  if (duration.hours) {
    parts.push(`${duration.hours}h`);
  }
  if (duration.minutes) {
    parts.push(`${duration.minutes}m`);
  }
  if (duration.seconds) {
    parts.push(`${duration.seconds}s`);
  }
  if (parts.length === 0) {
    parts.push("0s");
  }
  return parts.join(" ");
};

const formatDurationAria = (duration: TimerDuration): string => {
  const parts: string[] = [];
  if (duration.hours) {
    parts.push(`${duration.hours} ${duration.hours === 1 ? "hour" : "hours"}`);
  }
  if (duration.minutes) {
    parts.push(`${duration.minutes} ${duration.minutes === 1 ? "minute" : "minutes"}`);
  }
  if (duration.seconds || parts.length === 0) {
    const seconds = duration.seconds;
    parts.push(`${seconds} ${seconds === 1 ? "second" : "seconds"}`);
  }
  return parts.join(" ");
};

interface TimerTokenContext {
  recipeId: string;
  recipeTitle: string;
  lineNumber: number;
  tokenIndex: number;
}

const renderTimerToken = (
  token: DocumentStepTimerToken,
  context: TimerTokenContext,
): string => {
  const baseId = `${context.recipeId}:${context.lineNumber}:${context.tokenIndex}`;
  const timerId = `${baseId}:single`;
  const durationMs = durationToMilliseconds(token.start);
  const display = formatDurationDisplay(token.start);
  const ariaDuration = formatDurationAria(token.start);
  const ariaLabel = `Start ${ariaDuration} timer`;

  const dataAttrs = [
    `type="button"`,
    `class="kr-timer"`,
    `data-kr-timer-id="${escapeAttr(timerId)}"`,
    `data-kr-timer-duration="${String(durationMs)}"`,
    `data-kr-timer-label="${escapeAttr(display)}"`,
    `data-kr-timer-line="${String(context.lineNumber)}"`,
    `data-kr-timer-column="${String(token.column)}"`,
    `data-kr-timer-recipe-id="${escapeAttr(context.recipeId)}"`,
    `data-kr-timer-recipe-title="${escapeAttr(context.recipeTitle)}"`,
    `data-kr-timer-variant="single"`,
    `data-kr-timer-hours="${String(token.start.hours)}"`,
    `data-kr-timer-minutes="${String(token.start.minutes)}"`,
    `data-kr-timer-seconds="${String(token.start.seconds)}"`,
    `data-kr-timer-raw="${escapeAttr(token.raw)}"`,
  ];

  return `<button ${dataAttrs.join(" ")} aria-label="${escapeAttr(
    ariaLabel,
  )}" data-kr-timer-range-role="single"><span class="kr-timer__label">${escapeHtml(
    display,
  )}</span></button>`;
};

const convertTemperature = (value: number, scale: "F" | "C"): { other: number; otherScale: "F" | "C" } => {
  if (scale === "F") {
    return { other: Math.round(((value - 32) * 5) / 9), otherScale: "C" };
  }
  return { other: Math.round((value * 9) / 5 + 32), otherScale: "F" };
};

const renderTemperatureToken = (
  token: DocumentStepTemperatureToken,
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

interface TimerStartDetail {
  timerId: string;
  recipeId: string;
  recipeTitle: string;
  line: number;
  column: number;
  variant: "single";
  durationMs: number;
  duration: { hours: number; minutes: number; seconds: number };
  label: string;
  startedAt: number;
}

const renderIngredientAttributes = (
  attributes: IngredientAttribute[],
  options: {
    omitKeys?: Set<string>;
    omitAttributes?: Set<IngredientAttribute>;
  } = {},
): string => {
  if (attributes.length === 0) {
    return "";
  }

  const { omitKeys, omitAttributes } = options;

  const chips = attributes
    .map((attr) => {
      if (omitKeys?.has(attr.key)) {
        return "";
      }
      if (omitAttributes?.has(attr)) {
        return "";
      }
      const key = escapeHtml(attr.key);
      const rawValue = attr.value ?? attr.quantity?.raw ?? "";
      const detail =
        rawValue !== ""
          ? `: <span class="kr-ingredient__attribute-value">${escapeHtml(rawValue)}</span>`
          : "";
      return `<span class="kr-ingredient__attribute" data-kr-attribute="${escapeAttr(
        attr.key,
      )}">${key}${detail}</span>`;
    })
    .join("");

  return `<span class="kr-ingredient__attributes">${chips}</span>`;
};

const REFERENCE_PATTERN = /\[\[([^[\]]+)\]\]/g;

const STEP_NUMBER_PATTERN = /^(\d+)\.\s+/;

const renderStepLine = (
  line: SectionLine,
  targetMeta: Map<string, TargetInfo>,
  tokens: DocumentStepToken[],
  context: { recipeId: string; recipeTitle: string },
  options: RenderOptions,
  stepIndex: number | null = null,
): string => {
  const fullText = line.text;

  // Check if line starts with a step number like "1. "
  const stepMatch = STEP_NUMBER_PATTERN.exec(fullText);
  const stepNumber = stepMatch?.[1] ?? null;
  const stepPrefixLength = stepMatch?.[0]?.length ?? 0;
  const text = stepMatch ? fullText.slice(stepPrefixLength) : fullText;

  type InlineToken = { start: number; end: number; html: string };
  const inlineTokens: InlineToken[] = [];

  const recipeTokens = tokens
    .filter((token) => token.recipeId === context.recipeId)
    .slice()
    .sort((a, b) => a.index - b.index);

  let timerIndex = 0;
  for (const token of recipeTokens) {
    // Adjust indices for stripped step number prefix
    const start = token.index - stepPrefixLength;
    const end = token.index + token.raw.length - stepPrefixLength;
    // Skip tokens that fall within the stripped prefix
    if (end <= 0) continue;
    const adjustedStart = Math.max(0, start);
    if (token.kind === "timer") {
      inlineTokens.push({
        start: adjustedStart,
        end,
        html: renderTimerToken(token, {
          recipeId: context.recipeId,
          recipeTitle: context.recipeTitle,
          lineNumber: line.line,
          tokenIndex: timerIndex++,
        }),
      });
    } else if (token.kind === "temperature") {
      inlineTokens.push({
        start: adjustedStart,
        end,
        html: renderTemperatureToken(token, options.temperatureDisplay),
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

    const arrowIndex = innerRaw.indexOf("->");
    if (arrowIndex !== -1) {
      const displayPart = innerRaw.slice(0, arrowIndex).trim();
      const targetPart = innerRaw.slice(arrowIndex + 2).trim();
      if (displayPart) {
        display = displayPart;
      }
      if (targetPart) {
        target = slug(targetPart);
      }
      if (!display) {
        const fallback = targetMeta.get(target)?.name;
        if (fallback) {
          display = fallback;
        }
      }
    } else {
      target = slug(innerRaw);
      const fallback = targetMeta.get(target)?.name;
      if (fallback) {
        display = fallback;
      }
    }

    if (!target) {
      inlineTokens.push({ start, end, html: escapeHtml(full) });
      continue;
    }

    const meta = targetMeta.get(target);
    const controlsId = meta
      ? meta.type === "ingredient"
        ? `kr-ingredient-${target}`
        : `kr-recipe-${target}`
      : null;

    const buttonHtml = `<span role="button" tabindex="0" class="kr-ref" data-kr-target="${escapeAttr(
        target,
      )}" data-kr-display="${escapeAttr(display)}"${controlsId ? ` aria-controls="${escapeAttr(
        controlsId,
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

  const inlineDiagnostics = renderInlineDiagnostics(line.line, options);
  const diagnosticClass = inlineDiagnostics ? " kr-diagnostic-target" : "";
  const diagnosticAttr = inlineDiagnostics
    ? ` data-kr-diagnostic-severity="${inlineDiagnostics.severity}" role="button" aria-expanded="false" aria-controls="${escapeAttr(inlineDiagnostics.controlsId)}" tabindex="0"`
    : "";
  const diagnosticContent = inlineDiagnostics ? inlineDiagnostics.popover : "";

  const content = parts.join("");

  if (stepNumber !== null && stepIndex !== null) {
    const stepAttrs = ` data-kr-recipe-id="${escapeAttr(context.recipeId)}" data-kr-step-index="${stepIndex}" role="button" tabindex="0" aria-pressed="false"`;
    return `<p class="kr-section__line kr-step${diagnosticClass}" data-kr-line="${line.line}"${diagnosticAttr}${stepAttrs}>${diagnosticContent}<span class="kr-step-number">${escapeHtml(stepNumber)}.</span>${content}</p>`;
  }

  if (stepNumber !== null) {
    return `<p class="kr-section__line${diagnosticClass}" data-kr-line="${line.line}"${diagnosticAttr}>${diagnosticContent}<span class="kr-step-number">${escapeHtml(stepNumber)}.</span>${content}</p>`;
  }

  return `<p class="kr-section__line${diagnosticClass}" data-kr-line="${line.line}"${diagnosticAttr}>${diagnosticContent}${content}</p>`;
};

const renderIngredient = (ingredient: Ingredient, options: RenderOptions): string => {
  const dataAttrs: string[] = [
    `data-kr-line="${String(ingredient.line)}"`,
    `data-kr-id="${escapeAttr(ingredient.id)}"`,
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
      const unitInfo = attr.quantity.unit ? lookupUnit(attr.quantity.unit) : null;
      dimension = dimensionFromUnit(unitInfo?.family, unitInfo?.dimension);
      isMetric = isMetricFamily(unitInfo?.family);
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

  const elementId = `kr-ingredient-${ingredient.id}`;
  const wrapper = `<div class="kr-ingredient__wrapper">${quantityCell}${contentCell}</div>`;
  return `<li class="kr-ingredient${diagnosticClass}" id="${escapeAttr(elementId)}" tabindex="-1" ${dataAttrs.join(
    " ",
  )}>${cautionIcon}${diagnosticContent}${wrapper}</li>`;
};

const renderIngredientsSection = (
  section: IngredientsSection,
  options: RenderOptions,
): string => {
  const heading = `<h3 class="kr-section__title">${escapeHtml(section.title)}</h3>`;
  if (section.ingredients.length === 0) {
    return `<section class="kr-section" data-kr-kind="ingredients">${heading}<div class="kr-section__body"><p class="kr-section__line kr-empty">No ingredients listed.</p></div></section>`;
  }

  const items = section.ingredients.map((ingredient) => renderIngredient(ingredient, options)).join("");
  return `<section class="kr-section" data-kr-kind="ingredients">${heading}<ul class="kr-ingredient-list">${items}</ul></section>`;
};

const renderSection = (
  recipe: Recipe,
  section: RecipeSection,
  options: RenderOptions,
  targetMeta: Map<string, TargetInfo>,
  stepTokensByLine: Map<number, DocumentStepToken[]>,
): string => {
  if (section.kind === "ingredients") {
    return renderIngredientsSection(section, options);
  }

  if (section.kind === "steps") {
    const heading = `<h3 class="kr-section__title">${escapeHtml(section.title)}</h3>`;
    let stepIndex = 0;
    const lines = section.lines
      .map((line) => {
        const fullText = line.text;
        const stepMatch = STEP_NUMBER_PATTERN.exec(fullText);
        const currentStepIndex = stepMatch ? stepIndex++ : null;
        return renderStepLine(
          line,
          targetMeta,
          stepTokensByLine.get(line.line) ?? [],
          { recipeId: recipe.id, recipeTitle: recipe.title },
          options,
          currentStepIndex,
        );
      })
      .join("");
    return `<section class="kr-section" data-kr-kind="steps">${heading}<div class="kr-section__body">${lines}</div></section>`;
  }

  if (section.kind === "notes") {
    return renderNotesSection(section, options);
  }

  const heading = `<h3 class="kr-section__title">${escapeHtml(section.title)}</h3>`;
  if (!section.lines.length) {
    return `<section class="kr-section" data-kr-kind="${escapeAttr(section.kind)}">${heading}</section>`;
  }

  const lines = section.lines
    .map((line) => {
      const inlineDiagnostics = renderInlineDiagnostics(line.line, options);
      const diagnosticClass = inlineDiagnostics ? " kr-diagnostic-target" : "";
      const diagnosticAttr = inlineDiagnostics
        ? ` data-kr-diagnostic-severity="${inlineDiagnostics.severity}" role="button" aria-expanded="false" aria-controls="${escapeAttr(inlineDiagnostics.controlsId)}" tabindex="0"`
        : "";
      const diagnosticContent = inlineDiagnostics ? inlineDiagnostics.popover : "";
      return `<p class="kr-section__line${diagnosticClass}" data-kr-line="${line.line}"${diagnosticAttr}>${diagnosticContent}${escapeHtml(
        line.text.trim(),
      )}</p>`;
    })
    .join("");

  return `<section class="kr-section" data-kr-kind="${escapeAttr(section.kind)}">${heading}<div class="kr-section__body">${lines}</div></section>`;
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
  stepTokensByLine: Map<number, DocumentStepToken[]>,
  source?: Source,
  presets?: ScalePreset[],
): string => {
  const sections = recipe.sections
    .map((section) => renderSection(recipe, section, options, targetMeta, stepTokensByLine))
    .join("");
  const roleAttr = index === 0 ? "main" : "secondary";
  const recipeElementId = `kr-recipe-${recipe.id}`;
  const inlineDiagnostics = renderInlineDiagnostics(recipe.line, options);
  const diagnosticClass = inlineDiagnostics ? " kr-diagnostic-target" : "";
  const diagnosticAttr = inlineDiagnostics
    ? ` data-kr-diagnostic-severity="${inlineDiagnostics.severity}" role="button" aria-expanded="false" aria-controls="${escapeAttr(inlineDiagnostics.controlsId)}" tabindex="0"`
    : "";
  const diagnosticContent = inlineDiagnostics ? inlineDiagnostics.popover : "";
  const sourceHtml = source ? renderSource(source) : "";
  let introHtml = "";
  if (recipe.intro && options.sourceLines) {
    // Intro spans from the line after the recipe heading to the line before the first section heading
    // Trim leading/trailing blank lines to get the actual content range
    const firstSectionLine = recipe.sections.length > 0 ? recipe.sections[0]!.line : undefined;
    let introStart = recipe.line + 1;
    let introEnd = firstSectionLine != null ? firstSectionLine - 1 : introStart;
    // Scan forward past blank lines
    while (introStart <= introEnd && (options.sourceLines[introStart - 1] ?? "").trim() === "") {
      introStart++;
    }
    // Scan backward past blank lines
    while (introEnd >= introStart && (options.sourceLines[introEnd - 1] ?? "").trim() === "") {
      introEnd--;
    }
    introHtml = renderIntro(recipe.intro, options.sourceLines, introStart, introEnd);
  } else if (recipe.intro) {
    introHtml = renderIntro(recipe.intro);
  }

  const scaleWidget = roleAttr === "main" ? renderScaleWidget(presets ?? []) : "";

  return `<section class="kr-recipe" id="${escapeAttr(recipeElementId)}" tabindex="-1" data-kr-role="${roleAttr}" data-kr-id="${escapeAttr(
    recipe.id,
  )}" data-kr-layout="${escapeAttr(options.layout)}"><header class="kr-recipe__header"><div class="kr-recipe__header-row"><div class="kr-recipe__header-text"><h2 class="kr-recipe__title${diagnosticClass}" data-kr-line="${recipe.line}"${diagnosticAttr}>${diagnosticContent}${escapeHtml(
    recipe.title,
  )}</h2>${sourceHtml}</div>${scaleWidget}</div></header>${introHtml}${sections}</section>`;
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

export const renderDocument = (
  doc: DocumentParseResult,
  partialOptions: Partial<RenderOptions> = {},
): string => {
  const baseOptions: RenderOptions = {
    ...DEFAULT_RENDER_OPTIONS,
    ...partialOptions,
  };

  const targetMeta = new Map<string, TargetInfo>();
  const stepTokensByLine = new Map<number, DocumentStepToken[]>();
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

  const options: RenderOptions = {
    ...baseOptions,
    diagnosticsMap: inlineDiagnosticsMap,
    nextDiagnosticId: inlineDiagnosticsMap ? () => `kr-diag-${diagnosticIdCounter++}` : undefined,
  };

  for (const recipe of doc.recipes) {
    targetMeta.set(recipe.id, { name: recipe.title, type: "recipe" });
    for (const section of recipe.sections) {
      if (section.kind !== "ingredients") {
        continue;
      }
      for (const ingredient of section.ingredients) {
        targetMeta.set(ingredient.id, { name: ingredient.name, type: "ingredient" });
      }
    }
  }

  for (const token of doc.stepTokens) {
    const existing = stepTokensByLine.get(token.line);
    if (existing) {
      existing.push(token);
    } else {
      stepTokensByLine.set(token.line, [token]);
    }
  }

  for (const list of stepTokensByLine.values()) {
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
    parts.push(
      `<header class="kr-document"><h1 class="kr-document-title${diagnosticClass}" data-kr-line="${doc.documentTitle.line}"${diagnosticAttr}>${diagnosticContent}${escapeHtml(doc.documentTitle.text)}</h1></header>`,
    );
  }

  if (doc.recipes.length === 0) {
    parts.push(
      `<p class="kr-empty" role="status">No recipes found in provided content.</p>`,
    );
  } else {
    const scalePresets = doc.frontmatter?.scales ?? [];
    doc.recipes.forEach((recipe, index) => {
      // Only show source on the main recipe (index 0)
      const source = index === 0 ? doc.frontmatter?.source : undefined;
      parts.push(renderRecipe(recipe, index, options, targetMeta, stepTokensByLine, source, scalePresets));
    });
  }

  parts.push(`</article>`);
  return parts.join("");
};

const emptyRender = (): string =>
  `<style>${BASE_STYLE}</style><article class="kr-root"><p class="kr-empty" role="status">Provide Recipe Markdown to render.</p></article>`;

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
    ];
  }

  #content: string | null = null;
  #inlineSource: string | null = null;
  #isConnected = false;
  #currentStepIndex: Map<string, number> = new Map(); // recipeId → current step index
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
    // Backward compat: map legacy values
    if (normalized === "alt-mass" || normalized === "alt-volume") {
      return "metric";
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

  #setupTimerInteractions(): void {
    if (typeof document === "undefined") {
      return;
    }

    const root = this.shadowRoot;
    if (!root) {
      return;
    }

    if (typeof (root as ShadowRoot).querySelectorAll !== "function") {
      return;
    }

    const buttons = Array.from(
      root.querySelectorAll<HTMLButtonElement>(".kr-timer"),
    );
    if (buttons.length === 0) {
      return;
    }

    buttons.forEach((button) => {
      button.addEventListener("click", () => {
        const detail = this.#buildTimerDetail(button);
        this.dispatchEvent(new CustomEvent("kr:timer-start", { detail }));
      });
    });
  }

  #buildTimerDetail(button: HTMLButtonElement): TimerStartDetail {
    const variant = "single" as const;
    const durationMs = Number(button.dataset.krTimerDuration ?? "0");
    const hours = Number(button.dataset.krTimerHours ?? "0");
    const minutes = Number(button.dataset.krTimerMinutes ?? "0");
    const seconds = Number(button.dataset.krTimerSeconds ?? "0");

    return {
      timerId: button.dataset.krTimerId ?? "",
      recipeId: button.dataset.krTimerRecipeId ?? "",
      recipeTitle: button.dataset.krTimerRecipeTitle ?? "",
      line: Number(button.dataset.krTimerLine ?? "0"),
      column: Number(button.dataset.krTimerColumn ?? "0"),
      variant,
      durationMs,
      duration: { hours, minutes, seconds },
      label: button.dataset.krTimerLabel ?? button.textContent ?? "",
      startedAt: Date.now(),
    };
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

      for (const ingEl of scalableIngredients) {
        const handler = () => {
          const id = ingEl.dataset.krId;
          if (!id) return;
          for (const recipe of doc.recipes) {
            for (const section of recipe.sections) {
              if (section.kind !== "ingredients") continue;
              for (const ing of section.ingredients) {
                if (ing.id === id && ing.quantity?.kind === "single") {
                  this.#anchorIngredientId = id;
                  this.#anchorCustomAmount = ing.quantity.value;
                  this.#anchorDisplayText = numberToFractionText(ing.quantity.value);
                  this.#anchorUnit = ing.quantity.unit ?? "";
                  this.#anchorEditing = true;
                  this.#render();
                  return;
                }
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

    const highlight = (ref: HTMLElement, targetId: string, lock: boolean) => {
      const escaped = cssEscape(targetId);
      const targetNodes = Array.from(
        root.querySelectorAll<HTMLElement>(`[data-kr-id="${escaped}"]`),
      );
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

      const detail = {
        targetId,
        display: ref.getAttribute("data-kr-display") ?? ref.textContent ?? "",
      };
      this.dispatchEvent(new CustomEvent("kr:ref-focus", { detail }));
    };

    refs.forEach((ref) => {
      const targetId = ref.getAttribute("data-kr-target");
      if (!targetId) {
        return;
      }

      ref.addEventListener("pointerenter", () => {
        if (lockedRef && lockedRef !== ref) {
          return;
        }
        highlight(ref, targetId, false);
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
        highlight(ref, targetId, false);
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
        highlight(ref, targetId, lock);
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

    this.#setupTimerInteractions();
    if (!this.#editable) {
      this.#setupReferenceInteractions();
      this.#setupSubrecipeLinks();
    }
    this.#setupDiagnosticMarkers();
    this.#setupDiagnosticsInteractions();
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
      });
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
  }

  #setupDiagnosticsInteractions(): void {
    const root = this.shadowRoot;
    if (!root) {
      return;
    }

    if (typeof (root as ShadowRoot).querySelectorAll !== "function") {
      return;
    }

    const diagnosticItems = Array.from(
      root.querySelectorAll<HTMLElement>(".kr-diagnostics__item[data-kr-line]"),
    );
    if (diagnosticItems.length === 0) {
      return;
    }

    diagnosticItems.forEach((item) => {
      item.addEventListener("click", () => {
        const line = Number(item.getAttribute("data-kr-line"));
        if (!Number.isNaN(line) && line > 0) {
          const detail = {
            line,
            code: item.getAttribute("data-kr-code") ?? "",
            severity: item.getAttribute("data-kr-severity") ?? "error",
          };
          this.dispatchEvent(new CustomEvent("kr:diagnostic-click", { detail }));
        }
      });
    });
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

        if (e.key === "ArrowDown" || e.key === "ArrowRight" || e.key === " ") {
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

    // Update stored index
    this.#currentStepIndex.set(recipeId, stepIndex);

    // Update aria-pressed on all steps for this recipe
    const steps = Array.from(
      root.querySelectorAll<HTMLElement>(`.kr-step[data-kr-recipe-id="${CSS.escape(recipeId)}"]`)
    );

    steps.forEach((step) => {
      const thisStepIndex = Number(step.getAttribute("data-kr-step-index"));
      step.setAttribute("aria-pressed", thisStepIndex === stepIndex ? "true" : "false");
    });

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

    // Find current step
    const currentStep = root.querySelector<HTMLElement>('.kr-step[aria-pressed="true"]');
    if (!currentStep) {
      // No current step, activate first step
      const firstStep = root.querySelector<HTMLElement>(".kr-step[data-kr-step-index]");
      if (firstStep) {
        const recipeId = firstStep.getAttribute("data-kr-recipe-id") ?? "";
        this.#setCurrentStep(recipeId, 0);
      }
      return;
    }

    const recipeId = currentStep.getAttribute("data-kr-recipe-id") ?? "";
    const currentIndex = Number(currentStep.getAttribute("data-kr-step-index"));

    if (Number.isNaN(currentIndex)) {
      return;
    }

    // Find next step in same recipe
    const nextStep = root.querySelector<HTMLElement>(
      `.kr-step[data-kr-recipe-id="${CSS.escape(recipeId)}"][data-kr-step-index="${currentIndex + 1}"]`
    );

    if (nextStep) {
      this.#setCurrentStep(recipeId, currentIndex + 1);
    }
    // If no next step, stay at current (don't wrap around)
  }

  #advanceToPreviousStep(): void {
    const root = this.shadowRoot;
    if (!root) {
      return;
    }

    // Find current step
    const currentStep = root.querySelector<HTMLElement>('.kr-step[aria-pressed="true"]');
    if (!currentStep) {
      return;
    }

    const recipeId = currentStep.getAttribute("data-kr-recipe-id") ?? "";
    const currentIndex = Number(currentStep.getAttribute("data-kr-step-index"));

    if (Number.isNaN(currentIndex) || currentIndex === 0) {
      return; // Already at first step
    }

    // Find previous step in same recipe
    const prevStep = root.querySelector<HTMLElement>(
      `.kr-step[data-kr-recipe-id="${CSS.escape(recipeId)}"][data-kr-step-index="${currentIndex - 1}"]`
    );

    if (prevStep) {
      this.#setCurrentStep(recipeId, currentIndex - 1);
    }
  }

  #updateIngredientHighlights(recipeId: string, stepIndex: number): void {
    const root = this.shadowRoot;
    if (!root) {
      return;
    }

    // Get the current step element
    const step = root.querySelector<HTMLElement>(
      `.kr-step[data-kr-recipe-id="${CSS.escape(recipeId)}"][data-kr-step-index="${stepIndex}"]`
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
        `.kr-ingredient[data-kr-id="${CSS.escape(targetId!)}"]`
      );
      if (ingredient) {
        ingredient.setAttribute("data-kr-step-highlight", "true");
      }
    });
  }
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
