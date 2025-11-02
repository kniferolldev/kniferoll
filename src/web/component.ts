/// <reference lib="dom" />

import { parseDocument } from "../core/parser";
import { computeScaleFactor } from "../core/scale";
import { scaleQuantity } from "../core/scale-quantity";
import { formatQuantity } from "../core/format";
import { lookupUnit } from "../core/units";
import type {
  Diagnostic,
  DocumentParseResult,
  DocumentStepTemperatureToken,
  DocumentStepTimerToken,
  DocumentStepToken,
  Ingredient,
  IngredientAttribute,
  IngredientsSection,
  Recipe,
  RecipeSection,
  Quantity,
  TimerDuration,
  UnitDimension,
  UnitFamily,
  ScaleSelection,
  SectionLine,
} from "../core/types";

const TAG_NAME = "kr-recipe";

const BASE_STYLE = `
  :host {
    display: block;
    font-family: var(--kr-font-family, system-ui, sans-serif);
    color: var(--kr-color-text, inherit);
  }

  .kr-root {
    display: grid;
    gap: var(--kr-gap, 1.5rem);
  }

  .kr-document-title {
    margin: 0;
    font-size: var(--kr-document-title-size, 1.75rem);
    font-weight: 600;
  }

  .kr-recipe {
    border-radius: var(--kr-card-radius, 0.75rem);
    border: var(--kr-card-border, 1px solid var(--kr-color-border, rgba(17, 24, 39, 0.1)));
    padding: var(--kr-card-padding, 1.25rem);
    background: var(--kr-card-background, var(--kr-color-surface, rgba(255, 255, 255, 0.95)));
  }

  .kr-recipe__title {
    margin: 0 0 var(--kr-title-spacing, 1rem);
    font-size: var(--kr-recipe-title-size, 1.5rem);
    font-weight: 600;
  }

  .kr-section {
    margin: 0;
    padding: 0;
  }

  .kr-section + .kr-section {
    margin-top: var(--kr-section-gap, 1rem);
  }

  .kr-section__title {
    margin: 0;
    font-size: var(--kr-section-title-size, 1rem);
    font-weight: 600;
    text-transform: capitalize;
  }

  .kr-section__body {
    margin-top: var(--kr-section-body-gap, 0.5rem);
    color: var(--kr-color-muted, #4b5563);
    font-size: var(--kr-section-body-size, 0.95rem);
    line-height: var(--kr-section-body-line-height, 1.5);
  }

  .kr-section__line {
    margin: 0;
  }

  .kr-controls {
    display: flex;
    flex-wrap: wrap;
    gap: var(--kr-control-gap, 0.75rem);
    align-items: center;
    margin-bottom: var(--kr-control-margin, 1rem);
  }

  .kr-control-label {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    font-weight: 600;
    color: var(--kr-color-muted, #4b5563);
  }

  .kr-control-select {
    appearance: none;
    border-radius: var(--kr-control-radius, 999px);
    border: var(--kr-control-border, 1px solid var(--kr-color-border, rgba(17, 24, 39, 0.2)));
    background: var(--kr-control-background, var(--kr-color-surface, rgba(255, 255, 255, 0.96)));
    padding: var(--kr-control-padding, 0.35rem 1.1rem 0.35rem 0.65rem);
    font-size: var(--kr-control-size, 0.9rem);
    line-height: 1.2;
    cursor: pointer;
  }

  .kr-control-select:focus-visible {
    outline: 2px solid var(--kr-color-border, rgba(17, 24, 39, 0.35));
    outline-offset: 2px;
  }

  .kr-ref {
    border: none;
    background: none;
    color: var(--kr-color-accent, #2563eb);
    text-decoration: underline;
    cursor: pointer;
    font: inherit;
    padding: 0;
  }

  .kr-ref:focus-visible {
    outline: 2px solid var(--kr-color-accent, #2563eb);
    outline-offset: 2px;
  }

  .kr-ref--active {
    color: var(--kr-color-highlight-text, #1f2937);
    background: var(--kr-color-highlight, rgba(59, 130, 246, 0.15));
    border-radius: 0.3rem;
    padding-inline: 0.2rem;
  }

  .kr-target-highlight {
    background: var(--kr-color-highlight, rgba(59, 130, 246, 0.15));
    border-radius: 0.4rem;
    transition: background 0.15s ease;
  }

  .kr-diagnostics {
    border-radius: var(--kr-diagnostics-radius, 0.75rem);
    border: var(--kr-diagnostics-border, 1px solid rgba(185, 28, 28, 0.2));
    background: var(--kr-diagnostics-background, rgba(254, 242, 242, 0.85));
    padding: var(--kr-diagnostics-padding, 1rem 1.25rem);
    color: var(--kr-diagnostics-text, #7f1d1d);
    display: grid;
    gap: 0.75rem;
    margin-bottom: var(--kr-diagnostics-margin, 1rem);
  }

  .kr-diagnostics__header {
    display: flex;
    align-items: baseline;
    gap: 0.5rem;
    font-size: 0.95rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
  }

  .kr-diagnostics__summary {
    font-size: 0.85rem;
    color: rgba(127, 29, 29, 0.75);
  }

  .kr-diagnostics__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0.6rem;
  }

  .kr-diagnostics__item {
    display: grid;
    gap: 0.35rem;
  }

  .kr-diagnostics__tag {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.75rem;
    font-weight: 600;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }

  .kr-diagnostics__tag::before {
    content: attr(data-kr-tag);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.75rem;
    padding: 0.15rem 0.45rem;
    border-radius: 999px;
    background: rgba(185, 28, 28, 0.15);
    color: rgba(153, 27, 27, 0.95);
  }

  .kr-diagnostics__tag[data-kr-severity="warning"]::before {
    background: rgba(202, 138, 4, 0.2);
    color: rgba(146, 64, 14, 0.95);
  }

  .kr-diagnostics__message {
    font-size: 0.95rem;
    font-weight: 500;
  }

  .kr-diagnostics__meta {
    font-size: 0.8rem;
    color: rgba(127, 29, 29, 0.7);
  }

  .kr-ingredient-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: var(--kr-ingredient-gap, 0.5rem);
  }

  .kr-ingredient {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: var(--kr-ingredient-item-gap, 0.5rem);
  }

  .kr-ingredient__quantity {
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .kr-ingredient__quantity-secondary {
    font-size: var(--kr-ingredient-secondary-size, 0.8rem);
    color: var(--kr-color-muted, #6b7280);
    font-style: italic;
    margin-left: var(--kr-ingredient-secondary-offset, 0.35rem);
  }

  .kr-ingredient__name {
    font-weight: 500;
  }

  .kr-ingredient__modifiers {
    color: var(--kr-color-muted, #6b7280);
  }

  .kr-ingredient__attributes {
    display: inline-flex;
    gap: var(--kr-attribute-gap, 0.375rem);
    flex-wrap: wrap;
  }

  .kr-ingredient__attribute {
    display: inline-flex;
    align-items: center;
    gap: 0.125rem;
    font-size: var(--kr-attribute-size, 0.75rem);
    padding: var(--kr-attribute-padding, 0.125rem 0.375rem);
    border-radius: var(--kr-attribute-radius, 999px);
    background: var(--kr-color-badge, rgba(15, 118, 110, 0.12));
    color: var(--kr-color-badge-text, #0f766e);
  }

  .kr-ingredient__attribute-value {
    font-weight: 600;
  }

  .kr-timer-group {
    display: inline-flex;
    gap: var(--kr-timer-group-gap, 0.35rem);
    align-items: center;
    margin: 0 0.25rem;
  }

  .kr-timer {
    display: inline-flex;
    align-items: center;
    gap: var(--kr-timer-gap, 0.35rem);
    padding: var(--kr-timer-padding, 0.2rem 0.65rem);
    border-radius: var(--kr-timer-radius, 999px);
    border: var(--kr-timer-border, 1px solid var(--kr-color-border, rgba(17, 24, 39, 0.2)));
    background: var(--kr-timer-background, var(--kr-color-surface, rgba(255, 255, 255, 0.96)));
    font-size: var(--kr-timer-size, 0.85rem);
    font-weight: 600;
    line-height: 1.2;
    cursor: pointer;
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .kr-timer:not(:disabled):hover {
    background: var(--kr-timer-hover-background, var(--kr-color-surface-strong, rgba(244, 244, 245, 0.9)));
  }

  .kr-timer:focus-visible {
    outline: 2px solid var(--kr-color-border, rgba(17, 24, 39, 0.35));
    outline-offset: 2px;
  }

  .kr-timer__label {
    font-variant-numeric: tabular-nums;
  }

  .kr-temperature {
    display: inline-flex;
    align-items: center;
    padding: var(--kr-temperature-padding, 0.05rem 0.4rem);
    margin: 0 0.25rem;
    border-radius: var(--kr-temperature-radius, 0.5rem);
    background: var(--kr-color-temperature, rgba(250, 204, 21, 0.18));
    color: var(--kr-color-temperature-text, #92400e);
    font-size: var(--kr-temperature-size, 0.85rem);
    font-weight: 600;
    font-variant-numeric: tabular-nums;
  }

  .kr-recipe[data-kr-layout="two-column"],
  .kr-recipe[data-kr-layout="ingredients-left"],
  .kr-recipe[data-kr-layout="steps-left"] {
    display: grid;
    gap: var(--kr-layout-column-gap, 1.5rem);
    grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    grid-auto-rows: min-content;
  }

  .kr-recipe[data-kr-layout="two-column"] .kr-recipe__header,
  .kr-recipe[data-kr-layout="ingredients-left"] .kr-recipe__header,
  .kr-recipe[data-kr-layout="steps-left"] .kr-recipe__header {
    grid-column: 1 / -1;
  }

  .kr-recipe[data-kr-layout="two-column"] .kr-section[data-kr-kind="ingredients"],
  .kr-recipe[data-kr-layout="ingredients-left"] .kr-section[data-kr-kind="ingredients"] {
    grid-column: 1;
  }

  .kr-recipe[data-kr-layout="two-column"] .kr-section[data-kr-kind="steps"],
  .kr-recipe[data-kr-layout="ingredients-left"] .kr-section[data-kr-kind="steps"] {
    grid-column: 2;
  }

  .kr-recipe[data-kr-layout="steps-left"] .kr-section[data-kr-kind="steps"] {
    grid-column: 1;
  }

  .kr-recipe[data-kr-layout="steps-left"] .kr-section[data-kr-kind="ingredients"] {
    grid-column: 2;
  }

  .kr-recipe[data-kr-layout="two-column"] .kr-section:not([data-kr-kind="ingredients"]):not([data-kr-kind="steps"]),
  .kr-recipe[data-kr-layout="ingredients-left"] .kr-section:not([data-kr-kind="ingredients"]):not([data-kr-kind="steps"]),
  .kr-recipe[data-kr-layout="steps-left"] .kr-section:not([data-kr-kind="ingredients"]):not([data-kr-kind="steps"]) {
    grid-column: 1 / -1;
  }

  .kr-root[data-kr-layout="print-compact"] {
    gap: var(--kr-gap-compact, 1rem);
  }

  .kr-recipe[data-kr-layout="print-compact"] {
    border: none;
    padding: var(--kr-print-padding, 0);
    background: transparent;
  }

  .kr-recipe[data-kr-layout="print-compact"] .kr-recipe__title {
    font-size: var(--kr-print-title-size, 1.35rem);
  }

  .kr-recipe[data-kr-layout="print-compact"] .kr-section + .kr-section {
    margin-top: var(--kr-print-section-gap, 0.75rem);
  }

  @media (max-width: 768px) {
    .kr-recipe[data-kr-layout="two-column"],
    .kr-recipe[data-kr-layout="ingredients-left"],
    .kr-recipe[data-kr-layout="steps-left"] {
      display: block;
    }
  }

  .kr-empty {
    font-style: italic;
    color: var(--kr-color-muted, #6b7280);
  }

  @media print {
    :host {
      color: #111827;
      background: #ffffff !important;
    }

    .kr-root {
      gap: var(--kr-print-root-gap, 1rem);
    }

    .kr-recipe {
      border: none;
      background: transparent;
      padding: var(--kr-print-card-padding, 0);
      box-shadow: none;
    }

    .kr-controls {
      display: none !important;
    }

    .kr-ref {
      color: inherit;
      text-decoration: none;
    }

    .kr-timer,
    .kr-timer-group,
    .kr-temperature {
      border: 1px solid rgba(55, 65, 81, 0.4);
      background: transparent;
      padding: 0.1rem 0.35rem;
    }

    .kr-ingredient__quantity-secondary {
      color: rgba(55, 65, 81, 0.7);
    }

    .kr-diagnostics {
      border: 1px solid rgba(127, 29, 29, 0.35);
      background: transparent;
      color: #7f1d1d;
    }
  }
`.trim();

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");

const escapeAttr = (value: string): string => escapeHtml(value);

type QuantityDisplayMode = "native" | "alt-mass" | "alt-volume";
type LayoutPreset =
  | "stacked"
  | "two-column"
  | "steps-left"
  | "ingredients-left"
  | "print-compact";

type TargetInfo = { name: string; type: "ingredient" | "recipe" };

interface RenderOptions {
  scaleFactor: number;
  quantityDisplay: QuantityDisplayMode;
  layout: LayoutPreset;
  showDiagnostics: boolean;
}

const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  scaleFactor: 1,
  quantityDisplay: "native",
  layout: "stacked",
  showDiagnostics: false,
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
}

const pickAlternateDisplay = (
  candidates: AlternateDisplay[],
  mode: QuantityDisplayMode,
): AlternateDisplay | null => {
  if (mode === "native" || candidates.length === 0) {
    return null;
  }

  const preferredDimension: DimensionKind = mode === "alt-mass" ? "mass" : "volume";
  const preferred = candidates.find(
    (candidate) => candidate.dimension === preferredDimension && candidate.text,
  );
  if (preferred) {
    return preferred;
  }

  const withQuantity = candidates.find((candidate) => candidate.hasQuantity && candidate.text);
  if (withQuantity) {
    return withQuantity;
  }

  return candidates.find((candidate) => candidate.text) ?? candidates[0] ?? null;
};

const renderDiagnosticsPanel = (diagnostics: Diagnostic[]): string => {
  if (diagnostics.length === 0) {
    return "";
  }

  const errorCount = diagnostics.filter((item) => item.severity === "error").length;
  const warningCount = diagnostics.length - errorCount;
  const summaryParts: string[] = [];
  if (errorCount) {
    summaryParts.push(`${errorCount} error${errorCount === 1 ? "" : "s"}`);
  }
  if (warningCount) {
    summaryParts.push(`${warningCount} warning${warningCount === 1 ? "" : "s"}`);
  }

  const summaryText = summaryParts.length ? summaryParts.join(", ") : "No issues";

  const items = diagnostics
    .map((diag) => {
      const severityLabel = diag.severity === "error" ? "Error" : "Warning";
      const code = escapeHtml(diag.code);
      const message = escapeHtml(diag.message);
      const location = `Line ${diag.line}:${diag.column}`;
      return `<li class="kr-diagnostics__item" data-kr-code="${code}" data-kr-severity="${diag.severity}">
        <span class="kr-diagnostics__tag" data-kr-tag="${code}" data-kr-severity="${diag.severity}">${severityLabel} ${code}</span>
        <span class="kr-diagnostics__message">${message}</span>
        <span class="kr-diagnostics__meta">${escapeHtml(location)}</span>
      </li>`;
    })
    .join("");

  return `<section class="kr-diagnostics" data-kr-diagnostics role="status" aria-live="polite">
      <div class="kr-diagnostics__header">
        <span>Diagnostics</span>
        <span class="kr-diagnostics__summary">${escapeHtml(summaryText)}</span>
      </div>
      <ul class="kr-diagnostics__list">${items}</ul>
    </section>`;
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

const TIMER_VARIANT_LABEL: Record<"single" | "start" | "end", string> = {
  single: "",
  start: " (minimum)",
  end: " (maximum)",
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
  const rangeStartMs = durationToMilliseconds(token.start);
  const rangeEndMs = token.end ? durationToMilliseconds(token.end) : null;

  const renderButton = (
    variant: "single" | "start" | "end",
    duration: TimerDuration,
    durationMs: number,
  ): string => {
    const display = formatDurationDisplay(duration);
    const ariaDuration = formatDurationAria(duration);
    const variantSuffix = TIMER_VARIANT_LABEL[variant];
    const ariaLabel = `Start ${ariaDuration} timer${variantSuffix}`;
    const dataAttrs = [
      `type="button"`,
      `class="kr-timer"`,
      `data-kr-timer-id="${escapeAttr(`${baseId}:${variant}`)}"`,
      `data-kr-timer-duration="${String(durationMs)}"`,
      `data-kr-timer-label="${escapeAttr(display)}"`,
      `data-kr-timer-line="${String(context.lineNumber)}"`,
      `data-kr-timer-column="${String(token.column)}"`,
      `data-kr-timer-recipe-id="${escapeAttr(context.recipeId)}"`,
      `data-kr-timer-recipe-title="${escapeAttr(context.recipeTitle)}"`,
      `data-kr-timer-variant="${variant}"`,
      `data-kr-timer-hours="${String(duration.hours)}"`,
      `data-kr-timer-minutes="${String(duration.minutes)}"`,
      `data-kr-timer-seconds="${String(duration.seconds)}"`,
      `data-kr-timer-raw="${escapeAttr(token.raw)}"`,
    ];

    if (token.end) {
      dataAttrs.push(`data-kr-timer-range-start="${String(rangeStartMs)}"`);
      dataAttrs.push(`data-kr-timer-range-end="${String(rangeEndMs ?? durationMs)}"`);
    }

    return `<button ${dataAttrs.join(" ")} aria-label="${escapeAttr(
      ariaLabel,
    )}" data-kr-timer-range-role="${variant}"><span class="kr-timer__label">${escapeHtml(
      display,
    )}</span></button>`;
  };

  if (!token.end) {
    return renderButton("single", token.start, rangeStartMs);
  }

  const buttons = [
    renderButton("start", token.start, rangeStartMs),
    renderButton("end", token.end, rangeEndMs ?? rangeStartMs),
  ].join("");

  return `<span class="kr-timer-group" data-kr-timer="${escapeAttr(
    baseId,
  )}" aria-label="${escapeAttr(
    `Timer options for ${formatDurationAria(token.start)} to ${formatDurationAria(token.end)}`,
  )}">${buttons}</span>`;
};

const convertTemperature = (value: number, scale: "F" | "C"): { other: number; otherScale: "F" | "C" } => {
  if (scale === "F") {
    return { other: Math.round(((value - 32) * 5) / 9), otherScale: "C" };
  }
  return { other: Math.round((value * 9) / 5 + 32), otherScale: "F" };
};

const renderTemperatureToken = (token: DocumentStepTemperatureToken): string => {
  const { other, otherScale } = convertTemperature(token.value, token.scale);
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

type TimerVariant = "single" | "start" | "end";

interface TimerStartDetail {
  timerId: string;
  recipeId: string;
  recipeTitle: string;
  line: number;
  column: number;
  variant: TimerVariant;
  durationMs: number;
  duration: { hours: number; minutes: number; seconds: number };
  label: string;
  range?: { startMs: number; endMs: number };
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

const renderStepLine = (
  line: SectionLine,
  targetMeta: Map<string, TargetInfo>,
  tokens: DocumentStepToken[],
  context: { recipeId: string; recipeTitle: string },
): string => {
  const text = line.text;
  type InlineToken = { start: number; end: number; html: string };
  const inlineTokens: InlineToken[] = [];

  const recipeTokens = tokens
    .filter((token) => token.recipeId === context.recipeId)
    .slice()
    .sort((a, b) => a.index - b.index);

  let timerIndex = 0;
  for (const token of recipeTokens) {
    const start = token.index;
    const end = token.index + token.raw.length;
    if (token.kind === "timer") {
      inlineTokens.push({
        start,
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
        start,
        end,
        html: renderTemperatureToken(token),
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
        target = targetPart;
      }
      if (!display) {
        const fallback = targetMeta.get(target)?.name;
        if (fallback) {
          display = fallback;
        }
      }
    } else {
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

    inlineTokens.push({
      start,
      end,
      html: `<button type="button" class="kr-ref" data-kr-target="${escapeAttr(
        target,
      )}" data-kr-display="${escapeAttr(display)}"${controlsId ? ` aria-controls="${escapeAttr(
        controlsId,
      )}"` : ""}>${escapeHtml(display)}</button>`,
    });
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
      parts.push(escapeHtml(prefix));
    }
    parts.push(token.html);
    cursor = token.end;
  }

  const remainder = text.slice(cursor);
  if (remainder) {
    parts.push(escapeHtml(remainder));
  }

  return `<p class="kr-section__line" data-kr-line="${line.line}">${parts.join("")}</p>`;
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

  const noscale = ingredient.attributes.some((attr) => attr.key === "noscale");
  const baseQuantity = ingredient.quantity ?? null;
  const shouldScale = Boolean(baseQuantity) && !noscale && options.scaleFactor !== 1;

  const scaledQuantity = shouldScale && baseQuantity
    ? scaleQuantity(baseQuantity, options.scaleFactor)
    : null;

  const nativeQuantityText = formatQuantity(baseQuantity, {
    scaled: scaledQuantity ?? undefined,
    usePreferredUnit: true,
  });

  const alternateAttributes = ingredient.attributes.filter((attr) => attr.key === "also");
  const alternateDisplays: AlternateDisplay[] = alternateAttributes.map((attr) => {
    let text: string | null = attr.value ?? null;
    let dimension: DimensionKind = null;
    let hasQuantity = false;

    if (attr.quantity) {
      hasQuantity = true;
      const unitInfo = attr.quantity.unit ? lookupUnit(attr.quantity.unit) : null;
      dimension = dimensionFromUnit(unitInfo?.family, unitInfo?.dimension);
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

    return { attribute: attr, text, dimension, hasQuantity };
  });

  const alternateDisplay = pickAlternateDisplay(alternateDisplays, options.quantityDisplay);

  let quantityMode: QuantityDisplayMode = "native";
  let primaryQuantity = nativeQuantityText;
  let secondaryQuantity: string | null = null;

  if (alternateDisplay && alternateDisplay.text) {
    quantityMode = options.quantityDisplay;
    primaryQuantity = alternateDisplay.text;
    if (nativeQuantityText && nativeQuantityText !== alternateDisplay.text) {
      secondaryQuantity = `native: ${nativeQuantityText}`;
    }
  }

  dataAttrs.push(`data-kr-quantity-mode="${quantityMode}"`);

  const quantityParts: string[] = [];
  if (primaryQuantity) {
    quantityParts.push(
      `<span class="kr-ingredient__quantity" data-kr-quantity="${escapeAttr(
        primaryQuantity,
      )}">${escapeHtml(primaryQuantity)}</span>`,
    );
  }
  if (secondaryQuantity) {
    quantityParts.push(
      `<span class="kr-ingredient__quantity-secondary">${escapeHtml(
        `(${secondaryQuantity})`,
      )}</span>`,
    );
  }

  const quantity = quantityParts.join(" ");
  const name = `<span class="kr-ingredient__name">${escapeHtml(ingredient.name)}</span>`;
  const modifiers = ingredient.modifiers
    ? `<span class="kr-ingredient__modifiers">${escapeHtml(ingredient.modifiers)}</span>`
    : "";

  const omitAttributes =
    alternateDisplay && alternateDisplay.attribute
      ? new Set<IngredientAttribute>([alternateDisplay.attribute])
      : undefined;
  const attributes = renderIngredientAttributes(ingredient.attributes, {
    omitKeys: new Set(["also"]),
    omitAttributes,
  });

  const elementId = `kr-ingredient-${ingredient.id}`;
  const body = [quantity, name, modifiers, attributes].filter(Boolean).join("");
  return `<li class="kr-ingredient" id="${escapeAttr(elementId)}" tabindex="-1" ${dataAttrs.join(" ")}>${body}</li>`;
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
    const lines = section.lines
      .map((line) =>
        renderStepLine(
          line,
          targetMeta,
          stepTokensByLine.get(line.line) ?? [],
          { recipeId: recipe.id, recipeTitle: recipe.title },
        ),
      )
      .join("");
    return `<section class="kr-section" data-kr-kind="steps">${heading}<div class="kr-section__body">${lines}</div></section>`;
  }

  const heading = `<h3 class="kr-section__title">${escapeHtml(section.title)}</h3>`;
  if (!section.lines.length) {
    return `<section class="kr-section" data-kr-kind="${escapeAttr(section.kind)}">${heading}</section>`;
  }

  const lines = section.lines
    .map(
      (line) =>
        `<p class="kr-section__line" data-kr-line="${line.line}">${escapeHtml(
          line.text.trim(),
        )}</p>`,
    )
    .join("");

  return `<section class="kr-section" data-kr-kind="${escapeAttr(section.kind)}">${heading}<div class="kr-section__body">${lines}</div></section>`;
};

const renderRecipe = (
  recipe: Recipe,
  index: number,
  options: RenderOptions,
  targetMeta: Map<string, TargetInfo>,
  stepTokensByLine: Map<number, DocumentStepToken[]>,
): string => {
  const sections = recipe.sections
    .map((section) => renderSection(recipe, section, options, targetMeta, stepTokensByLine))
    .join("");
  const roleAttr = index === 0 ? "main" : "secondary";
  const recipeElementId = `kr-recipe-${recipe.id}`;
  return `<section class="kr-recipe" id="${escapeAttr(recipeElementId)}" tabindex="-1" data-kr-role="${roleAttr}" data-kr-id="${escapeAttr(
    recipe.id,
  )}" data-kr-layout="${escapeAttr(options.layout)}"><header class="kr-recipe__header"><h2 class="kr-recipe__title">${escapeHtml(
    recipe.title,
  )}</h2></header>${sections}</section>`;
};

export const renderDocument = (
  doc: DocumentParseResult,
  partialOptions: Partial<RenderOptions> = {},
): string => {
  const options: RenderOptions = {
    ...DEFAULT_RENDER_OPTIONS,
    ...partialOptions,
  };

  const targetMeta = new Map<string, TargetInfo>();
  const stepTokensByLine = new Map<number, DocumentStepToken[]>();
  const diagnostics = doc.diagnostics ?? [];
  const diagnosticsCount = diagnostics.length;

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

  if (options.showDiagnostics && diagnosticsCount > 0) {
    parts.push(renderDiagnosticsPanel(diagnostics));
  }

  parts.push(
    `<article class="kr-root" data-kr-scale="${options.scaleFactor}" data-kr-quantity-display="${options.quantityDisplay}" data-kr-layout="${options.layout}" data-kr-diagnostics-count="${diagnosticsCount}">`,
  );

  if (doc.documentTitle) {
    parts.push(
      `<header class="kr-document"><h1 class="kr-document-title" data-kr-line="${doc.documentTitle.line}">${escapeHtml(doc.documentTitle.text)}</h1></header>`,
    );
  }

  if (doc.recipes.length === 0) {
    parts.push(
      `<p class="kr-empty" role="status">No recipes found in provided content.</p>`,
    );
  } else {
    doc.recipes.forEach((recipe, index) => {
      parts.push(renderRecipe(recipe, index, options, targetMeta, stepTokensByLine));
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
    return ["scale", "preset", "quantity-display", "layout", "show-diagnostics"];
  }

  #content: string | null = null;
  #inlineSource: string | null = null;
  #isConnected = false;

  connectedCallback(): void {
    this.#isConnected = true;
    this.#ensureShadowRoot();
    this.#render();
  }

  disconnectedCallback(): void {
    this.#isConnected = false;
  }

  attributeChangedCallback(): void {
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
    if (normalized === "alt-mass" || normalized === "alt-volume") {
      return normalized;
    }

    return "native";
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

  #shouldShowDiagnostics(): boolean {
    const attr = this.getAttribute("show-diagnostics");
    if (attr === null) {
      return false;
    }
    const normalized = attr.trim().toLowerCase();
    if (normalized === "" || normalized === "true") {
      return true;
    }
    if (normalized === "false") {
      return false;
    }
    return true;
  }

  #setupTimerInteractions(): void {
    if (typeof document === "undefined") {
      return;
    }

    const root = this.shadowRoot;
    if (!root) {
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
    const variantAttr = button.dataset.krTimerVariant ?? "single";
    const variant: TimerVariant =
      variantAttr === "start" || variantAttr === "end" ? variantAttr : "single";
    const durationMs = Number(button.dataset.krTimerDuration ?? "0");
    const hours = Number(button.dataset.krTimerHours ?? "0");
    const minutes = Number(button.dataset.krTimerMinutes ?? "0");
    const seconds = Number(button.dataset.krTimerSeconds ?? "0");
    const rangeStartAttr = button.dataset.krTimerRangeStart;
    const rangeEndAttr = button.dataset.krTimerRangeEnd;

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
      range:
        rangeStartAttr !== undefined && rangeEndAttr !== undefined
          ? {
              startMs: Number(rangeStartAttr),
              endMs: Number(rangeEndAttr),
            }
          : undefined,
      startedAt: Date.now(),
    };
  }

  #setupControls(
    doc: DocumentParseResult,
    scaleResolution: { factor: number; presetIndex: number | null },
    quantityDisplay: QuantityDisplayMode,
  ): void {
    if (typeof document === "undefined" || typeof document.createElement !== "function") {
      return;
    }

    const root = this.shadowRoot;
    if (!root) {
      return;
    }

    const article = root.querySelector(".kr-root");
    if (!article) {
      return;
    }

    root.querySelector(".kr-controls")?.remove();

    const scalePresets = doc.frontmatter?.scales ?? [];
    const hasScaleControl = scalePresets.length > 0 || this.getAttribute("scale") !== null;
    const hasAlternateQuantities =
      doc.recipes.some((recipe) =>
        recipe.sections.some(
          (section) =>
            section.kind === "ingredients" &&
            section.ingredients.some((ingredient) =>
              ingredient.attributes.some((attr) => attr.key === "also"),
            ),
        ),
      ) || quantityDisplay !== "native";

    if (!hasScaleControl && !hasAlternateQuantities) {
      return;
    }

    const controls = document.createElement("div");
    controls.className = "kr-controls";

    const presetAttr = this.getAttribute("preset");
    const scaleAttr = this.getAttribute("scale");

    if (hasScaleControl) {
      const label = document.createElement("label");
      label.className = "kr-control-label";
      label.textContent = "Scale";

      const select = document.createElement("select");
      select.className = "kr-control-select kr-scale-control";

      const addOption = (value: string, text: string) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = text;
        select.append(option);
      };

      addOption("scale:1", "Original (1×)");

      scalePresets.forEach((preset, index) => {
        addOption(`preset:${index}`, preset.name);
      });

      if (scaleAttr && scaleAttr.trim() !== "" && scaleAttr !== "1") {
        const numeric = Number(scaleAttr);
        const labelText = Number.isFinite(numeric) ? `${numeric}×` : `${scaleAttr}×`;
        const existing = Array.from(select.options).some((option) => option.value === `scale:${scaleAttr}`);
        if (!existing) {
          addOption(`scale:${scaleAttr}`, labelText);
        }
      }

      let matched = false;
      if (presetAttr) {
        const normalized = presetAttr.trim();
        let index = Number(normalized);
        if (!Number.isInteger(index)) {
          index = scalePresets.findIndex(
            (preset) => preset.name.toLowerCase() === normalized.toLowerCase(),
          );
        }
        if (Number.isInteger(index) && index >= 0 && index < scalePresets.length) {
          select.value = `preset:${index}`;
          matched = true;
        }
      } else if (scaleResolution.presetIndex != null) {
        select.value = `preset:${scaleResolution.presetIndex}`;
        matched = true;
      }

      if (!matched && scaleAttr && scaleAttr.trim() !== "") {
        select.value = `scale:${scaleAttr}`;
        matched = true;
      }

      if (!matched) {
        select.value = "scale:1";
      }

      select.addEventListener("change", (event) => {
        const value = (event.target as HTMLSelectElement).value;
        if (value.startsWith("preset:")) {
          const index = Number(value.slice("preset:".length));
          if (Number.isInteger(index) && index >= 0) {
            this.setAttribute("preset", String(index));
            this.removeAttribute("scale");
          }
          return;
        }

        if (value.startsWith("scale:")) {
          const factor = value.slice("scale:".length);
          this.removeAttribute("preset");
          if (factor === "1" || factor === "") {
            this.removeAttribute("scale");
          } else {
            this.setAttribute("scale", factor);
          }
        }
      });

      label.append(select);
      controls.append(label);
    }

    if (hasAlternateQuantities) {
      const label = document.createElement("label");
      label.className = "kr-control-label";
      label.textContent = "Quantities";

      const select = document.createElement("select");
      select.className = "kr-control-select kr-quantity-control";

      const options: QuantityDisplayMode[] = ["native", "alt-mass", "alt-volume"];
      for (const mode of options) {
        const option = document.createElement("option");
        option.value = mode;
        option.textContent =
          mode === "native" ? "Native" : mode === "alt-mass" ? "Alt mass" : "Alt volume";
        select.append(option);
      }
      select.value = quantityDisplay;

      select.addEventListener("change", (event) => {
        const value = (event.target as HTMLSelectElement).value as QuantityDisplayMode;
        if (value === "native") {
          this.removeAttribute("quantity-display");
        } else {
          this.setAttribute("quantity-display", value);
        }
      });

      label.append(select);
      controls.append(label);
    }

    root.insertBefore(controls, article);
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
      root.querySelectorAll<HTMLButtonElement>(".kr-ref[data-kr-target]"),
    );
    if (refs.length === 0) {
      return;
    }

    let activeRef: HTMLButtonElement | null = null;
    let lockedRef: HTMLButtonElement | null = null;

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

    const highlight = (ref: HTMLButtonElement, targetId: string, lock: boolean) => {
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

  #render(): void {
    const shadow = this.#ensureShadowRoot();
    const source = (this.#content ?? this.#readInlineSource()).trim();
    if (source.length === 0) {
      shadow.innerHTML = emptyRender();
      return;
    }

    const result = parseDocument(source);
    const scaleResolution = this.#resolveScaleFactor(result);
    const quantityDisplay = this.#resolveQuantityDisplay();
    const layout = this.#resolveLayout();
    shadow.innerHTML = renderDocument(result, {
      scaleFactor: scaleResolution.factor,
      quantityDisplay,
      layout,
      showDiagnostics: this.#shouldShowDiagnostics(),
    });
    this.#setupControls(result, scaleResolution, quantityDisplay);
    this.#setupTimerInteractions();
    this.#setupReferenceInteractions();
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
