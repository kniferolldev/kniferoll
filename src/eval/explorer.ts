/**
 * Eval Explorer — generates a self-contained HTML file that visualizes
 * eval results as annotated recipe documents with scoring overlays.
 */

import { join } from "path";
import type { Baseline, TestCaseResult } from "./types";
import type {
  ComparisonResult,
  RecipeComparison,
  IngredientComparison,
  StepComparison,
} from "./compare";
import { DEFAULT_WEIGHTS } from "./weights";
import { parseDocument } from "../core";
import type { Recipe, Ingredient } from "../core";
import { wordDiff } from "../core/diff";

// ============================================================================
// Data Preparation
// ============================================================================

const TOTAL_WEIGHT =
  DEFAULT_WEIGHTS.ingredients +
  DEFAULT_WEIGHTS.steps +
  DEFAULT_WEIGHTS.references +
  DEFAULT_WEIGHTS.metadata +
  DEFAULT_WEIGHTS.structure +
  DEFAULT_WEIGHTS.prose;

const CATEGORIES = [
  { key: "ingredients", label: "Ingredients", weight: DEFAULT_WEIGHTS.ingredients, color: "#c62828" },
  { key: "steps", label: "Steps", weight: DEFAULT_WEIGHTS.steps, color: "#e65100" },
  { key: "references", label: "References", weight: DEFAULT_WEIGHTS.references, color: "#1565c0" },
  { key: "metadata", label: "Metadata", weight: DEFAULT_WEIGHTS.metadata, color: "#795548" },
  { key: "structure", label: "Structure", weight: DEFAULT_WEIGHTS.structure, color: "#546e7a" },
  { key: "prose", label: "Prose", weight: DEFAULT_WEIGHTS.prose, color: "#2e7d32" },
] as const;

type CategoryKey = (typeof CATEGORIES)[number]["key"];

function getCategoryScore(c: ComparisonResult, key: CategoryKey): number {
  switch (key) {
    case "ingredients": return c.ingredientScore;
    case "steps": return c.stepScore;
    case "references": return c.referenceScore;
    case "metadata": return c.metadataScore;
    case "structure": return c.structureScore;
    case "prose": return c.proseScore;
  }
}

/** Points lost by a category on the 0-100 scale */
function categoryDeduction(score: number, weight: number): number {
  return ((1 - score) * weight / TOTAL_WEIGHT) * 100;
}

/** Points lost by a single ingredient (contribution to the category's deduction) */
function ingredientPenalty(
  comp: IngredientComparison,
  numGolden: number,
): number {
  if (numGolden === 0) return 0;
  const perIngredient = (1 - comp.totalScore) / numGolden;
  return perIngredient * (DEFAULT_WEIGHTS.ingredients / TOTAL_WEIGHT) * 100;
}

function missingIngredientPenalty(numGolden: number): number {
  if (numGolden === 0) return 0;
  const perMissing = DEFAULT_WEIGHTS.missingIngredientPenalty / numGolden;
  return perMissing * (DEFAULT_WEIGHTS.ingredients / TOTAL_WEIGHT) * 100;
}

function extraIngredientPenalty(numGolden: number): number {
  if (numGolden === 0) return 0;
  const perExtra = DEFAULT_WEIGHTS.extraIngredientPenalty / numGolden;
  return perExtra * (DEFAULT_WEIGHTS.ingredients / TOTAL_WEIGHT) * 100;
}

function stepPenalty(comp: StepComparison, numGolden: number): number {
  if (numGolden === 0) return 0;
  const perStep = (1 - comp.totalScore) / numGolden;
  return perStep * (DEFAULT_WEIGHTS.steps / TOTAL_WEIGHT) * 100;
}

function missingStepPenalty(numGolden: number): number {
  if (numGolden === 0) return 0;
  const perMissing = DEFAULT_WEIGHTS.missingStepPenalty / numGolden;
  return perMissing * (DEFAULT_WEIGHTS.steps / TOTAL_WEIGHT) * 100;
}

// ============================================================================
// HTML Rendering
// ============================================================================

/** Normalize for diffing to match what the scorer considers equivalent */
function normalizeForDiff(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"');
}

/**
 * Compute a display-friendly diff: use normalized text to decide what changed,
 * but show the actual (original-case) text in the output.
 * Returns null if the texts are equivalent after normalization.
 */
function displayDiff(goldenRaw: string, actualRaw: string): string | null {
  const goldenNorm = normalizeForDiff(goldenRaw);
  const actualNorm = normalizeForDiff(actualRaw);
  if (goldenNorm === actualNorm) return null;
  // Diff the normalized text to find structural changes, then map
  // the "equal" tokens back to the actual text to preserve casing.
  const tokens = wordDiff(goldenNorm, actualNorm);
  // Walk through actual text in parallel with equal/insert tokens
  // to recover original casing for displayed text.
  let actualOffset = 0;
  let goldenOffset = 0;
  const result: string[] = [];
  for (const token of tokens) {
    if (token.kind === "equal") {
      // Show the actual text's casing for equal spans
      const chunk = actualRaw.slice(actualOffset, actualOffset + token.text.length);
      result.push(esc(chunk));
      actualOffset += token.text.length;
      goldenOffset += token.text.length;
    } else if (token.kind === "delete") {
      const chunk = goldenRaw.slice(goldenOffset, goldenOffset + token.text.length);
      result.push(`<del>${esc(chunk)}</del>`);
      goldenOffset += token.text.length;
    } else {
      const chunk = actualRaw.slice(actualOffset, actualOffset + token.text.length);
      result.push(`<ins>${esc(chunk)}</ins>`);
      actualOffset += token.text.length;
    }
  }
  return result.join("");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function penaltyBadge(pts: number): string {
  if (pts < 0.05) return `<span class="badge ok">\u2713</span>`;
  return `<span class="badge penalty">\u2212${pts.toFixed(1)}</span>`;
}

function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

function scoreClass(ratio: number): string {
  if (ratio >= 0.95) return "score-good";
  if (ratio >= 0.7) return "score-warn";
  return "score-bad";
}

// ── Deduction bar (overview row) ─────────────────────────────────────

function renderDeductionBar(comparison: ComparisonResult): string {
  const segments = CATEGORIES.map((cat) => {
    const score = getCategoryScore(comparison, cat.key);
    const ded = categoryDeduction(score, cat.weight);
    return { ...cat, deduction: ded };
  }).filter((s) => s.deduction > 0.05);

  const totalDeduction = segments.reduce((s, c) => s + c.deduction, 0);
  if (totalDeduction < 0.1) return `<div class="ded-bar"><div class="ded-perfect">perfect</div></div>`;

  const parts = segments.map(
    (s) =>
      `<div class="ded-seg" style="width:${(s.deduction / totalDeduction) * 100}%;background:${s.color}" ` +
      `title="${s.label}: \u2212${s.deduction.toFixed(1)} pts (${pct(getCategoryScore(comparison, s.key))})">${
        s.deduction >= 2 ? `\u2212${s.deduction.toFixed(0)}` : ""
      }</div>`
  );

  return `<div class="ded-bar">${parts.join("")}<span class="ded-total">\u2212${Math.round(totalDeduction)}</span></div>`;
}

// ── Category breakdown ───────────────────────────────────────────────

function renderCategoryBreakdown(comparison: ComparisonResult): string {
  const rows = CATEGORIES.map((cat) => {
    const score = getCategoryScore(comparison, cat.key);
    const ded = categoryDeduction(score, cat.weight);
    const maxPts = (cat.weight / TOTAL_WEIGHT) * 100;
    return `<tr>
      <td><span class="cat-dot" style="background:${cat.color}"></span>${cat.label}</td>
      <td class="${scoreClass(score)}">${pct(score)}</td>
      <td class="num">${maxPts.toFixed(1)}</td>
      <td class="num ${ded > 0.05 ? "penalty-text" : ""}">${ded > 0.05 ? `\u2212${ded.toFixed(1)}` : "\u2014"}</td>
    </tr>`;
  });

  return `<table class="cat-table">
    <thead><tr><th>Category</th><th>Score</th><th>Max pts</th><th>Lost</th></tr></thead>
    <tbody>${rows.join("")}</tbody>
  </table>`;
}

// ── Ingredient rendering ─────────────────────────────────────────────

function renderIngredientRow(
  comp: IngredientComparison,
  goldenIngredient: Ingredient | undefined,
  actualIngredient: Ingredient | undefined,
  numGolden: number,
): string {
  const pts = ingredientPenalty(comp, numGolden);

  if (!comp.actualId) {
    // Missing ingredient — ghost row
    const text = goldenIngredient
      ? formatIngredientText(goldenIngredient)
      : comp.goldenName;
    return `<div class="ing-row missing">
      <div class="ing-text"><del>${esc(text)}</del></div>
      ${penaltyBadge(missingIngredientPenalty(numGolden))}
      <div class="ing-detail">missing ingredient</div>
    </div>`;
  }

  // Matched ingredient — diff normalized text but display original casing
  const goldenTextRaw = goldenIngredient ? formatIngredientText(goldenIngredient) : comp.goldenName;
  const actualTextRaw = actualIngredient ? formatIngredientText(actualIngredient) : comp.actualName ?? "";

  const diffHtml = displayDiff(goldenTextRaw, actualTextRaw) ?? esc(actualTextRaw);

  const subScores = [
    comp.nameScore < 0.95 && `name ${pct(comp.nameScore)}`,
    comp.quantityScore < 0.95 && `qty ${pct(comp.quantityScore)}`,
    comp.notesScore < 0.95 && `notes ${pct(comp.notesScore)}`,
    comp.attrsScore < 0.95 && `attrs ${pct(comp.attrsScore)}`,
  ].filter(Boolean);

  const detail = subScores.length > 0
    ? `<div class="ing-detail">${subScores.join(" \u00b7 ")}</div>`
    : "";

  return `<div class="ing-row ${pts > 0.05 ? "imperfect" : ""}">
    <div class="ing-text">${diffHtml}</div>
    ${penaltyBadge(pts)}
    ${detail}
  </div>`;
}

function formatIngredientText(ing: Ingredient): string {
  const parts: string[] = [];
  parts.push(ing.name);
  if (ing.quantityText) parts.push(`- ${ing.quantityText}`);
  if (ing.modifiers) parts.push(`, ${ing.modifiers}`);
  return parts.join(" ");
}

function renderExtraIngredients(extras: string[], actualIngredients: Ingredient[], numGolden: number): string {
  return extras.map((id) => {
    const ing = actualIngredients.find((i) => i.id === id);
    const text = ing ? formatIngredientText(ing) : id;
    return `<div class="ing-row extra">
      <div class="ing-text"><ins>${esc(text)}</ins></div>
      ${penaltyBadge(extraIngredientPenalty(numGolden))}
      <div class="ing-detail">extra ingredient</div>
    </div>`;
  }).join("");
}

// ── Step rendering ───────────────────────────────────────────────────

function renderStepRow(
  comp: StepComparison,
  goldenStepText: string | undefined,
  actualStepText: string | undefined,
  numGolden: number,
): string {
  const pts = stepPenalty(comp, numGolden);
  const goldenRaw = goldenStepText ?? "";
  const actualRaw = actualStepText ?? "";

  const diffHtml = displayDiff(goldenRaw, actualRaw) ?? esc(actualRaw);

  const issues: string[] = [];
  if (comp.textScore < 0.9) issues.push(`text ${pct(comp.textScore)}`);
  if (comp.missingRefs.length > 0) issues.push(`missing refs: ${comp.missingRefs.join(", ")}`);
  if (comp.extraRefs.length > 0) issues.push(`extra refs: ${comp.extraRefs.join(", ")}`);

  const detail = issues.length > 0
    ? `<div class="step-detail">${esc(issues.join(" \u00b7 "))}</div>`
    : "";

  return `<div class="step-row ${pts > 0.05 ? "imperfect" : ""}">
    <div class="step-num">${comp.index}.</div>
    <div class="step-text">${diffHtml}</div>
    ${penaltyBadge(pts)}
    ${detail}
  </div>`;
}

// ── Recipe rendering ─────────────────────────────────────────────────

function renderRecipeSection(
  recipe: RecipeComparison,
  goldenRecipe: Recipe | undefined,
  actualRecipe: Recipe | undefined,
): string {
  const goldenIngredients = goldenRecipe?.ingredients.ingredients ?? [];
  const actualIngredients = actualRecipe?.ingredients.ingredients ?? [];
  const numGolden = goldenIngredients.length;

  // Build lookup maps
  const goldenIngMap = new Map(goldenIngredients.map((i) => [i.id, i]));
  const actualIngMap = new Map(actualIngredients.map((i) => [i.id, i]));

  // Ingredient rows
  const ingRows = recipe.ingredients.comparisons.map((comp) => {
    const golden = goldenIngMap.get(comp.goldenId);
    const actual = comp.actualId ? actualIngMap.get(comp.actualId) : undefined;
    return renderIngredientRow(comp, golden, actual, numGolden);
  }).join("");

  const extraRows = renderExtraIngredients(recipe.ingredients.extra, actualIngredients, numGolden);

  // Step rows
  const goldenStepTexts = getStepTexts(goldenRecipe);
  const actualStepTexts = getStepTexts(actualRecipe);
  const numGoldenSteps = goldenStepTexts.length;

  const stepRows = recipe.steps.comparisons.map((comp) => {
    const goldenText = goldenStepTexts[comp.index - 1];
    const actualText = comp.actualLine
      ? findStepTextByLine(actualRecipe, comp.actualLine)
      : actualStepTexts[comp.index - 1];
    return renderStepRow(comp, goldenText, actualText, numGoldenSteps);
  }).join("");

  const missingStepsHtml = recipe.steps.missingCount > 0
    ? `<div class="missing-steps">${recipe.steps.missingCount} missing step${recipe.steps.missingCount > 1 ? "s" : ""} (${penaltyBadge(missingStepPenalty(numGoldenSteps) * recipe.steps.missingCount)})</div>`
    : "";

  const extraStepsHtml = recipe.steps.extraCount > 0
    ? `<div class="extra-steps">${recipe.steps.extraCount} extra step${recipe.steps.extraCount > 1 ? "s" : ""}</div>`
    : "";

  // Intro/notes diffs (normalize typography before diffing to match scorer)
  let proseDiffHtml = "";
  if (goldenRecipe && actualRecipe) {
    const introHtml = renderProseDiffs("Intro", goldenRecipe.intro, actualRecipe.intro);
    const notesHtml = renderProseDiffs("Notes", goldenRecipe.notes, actualRecipe.notes);
    proseDiffHtml = introHtml + notesHtml;
  }

  const title = recipe.actualTitle ?? recipe.goldenTitle;
  const ingDed = categoryDeduction(recipe.ingredientScore, DEFAULT_WEIGHTS.ingredients);
  const stepDed = categoryDeduction(recipe.stepScore, DEFAULT_WEIGHTS.steps);

  return `<div class="recipe-section">
    <h3>${esc(title)}</h3>
    ${proseDiffHtml}
    <div class="section-header">
      <h4>Ingredients</h4>
      <span class="section-score ${scoreClass(recipe.ingredientScore)}">${pct(recipe.ingredientScore)}</span>
      ${ingDed > 0.05 ? `<span class="section-ded">\u2212${ingDed.toFixed(1)} pts</span>` : ""}
    </div>
    <div class="ing-list">${ingRows}${extraRows}</div>
    <div class="section-header">
      <h4>Steps</h4>
      <span class="section-score ${scoreClass(recipe.stepScore)}">${pct(recipe.stepScore)}</span>
      ${stepDed > 0.05 ? `<span class="section-ded">\u2212${stepDed.toFixed(1)} pts</span>` : ""}
    </div>
    <div class="step-list">${stepRows}${missingStepsHtml}${extraStepsHtml}</div>
  </div>`;
}

function renderProseDiffs(
  label: string,
  goldenBlocks: { content: string }[],
  actualBlocks: { content: string }[],
): string {
  const maxLen = Math.max(goldenBlocks.length, actualBlocks.length);
  const items: string[] = [];

  for (let i = 0; i < maxLen; i++) {
    const goldenRaw = goldenBlocks[i]?.content.trim() ?? "";
    const actualRaw = actualBlocks[i]?.content.trim() ?? "";

    if (!goldenRaw && actualRaw) {
      items.push(`<div class="prose-diff added"><ins>${esc(actualRaw)}</ins></div>`);
    } else if (goldenRaw && !actualRaw) {
      items.push(`<div class="prose-diff removed"><del>${esc(goldenRaw)}</del></div>`);
    } else {
      const diff = displayDiff(goldenRaw, actualRaw);
      if (diff) {
        items.push(`<div class="prose-diff changed">${diff}</div>`);
      }
    }
  }

  if (items.length === 0) return "";
  return `<div class="prose-section"><h4>${label}</h4>${items.join("")}</div>`;
}

function getStepTexts(recipe: Recipe | undefined): string[] {
  if (!recipe) return [];
  return recipe.steps.lines
    .map((l) => l.text.trim())
    .filter((t) => t.length > 0 && /^\d+\./.test(t));
}

function findStepTextByLine(recipe: Recipe | undefined, line: number): string | undefined {
  if (!recipe) return undefined;
  const entry = recipe.steps.lines.find((l) => l.line === line);
  return entry?.text.trim();
}

// ── Per-case rendering ───────────────────────────────────────────────

function renderCaseRow(id: string, result: TestCaseResult, goldenMarkdown: string | null): string {
  const comparison = result.comparison;
  if (!comparison || !result.parsed) {
    return `<div class="case-row" data-id="${esc(id)}">
      <div class="case-header" onclick="toggle('${esc(id)}')">
        <span class="case-name">${esc(id)}</span>
        <span class="case-score score-bad">${result.parsed ? `${result.score}%` : "parse failed"}</span>
        <div class="ded-bar"><div class="ded-seg" style="width:100%;background:#c62828">parse failed</div></div>
      </div>
      <div class="case-detail" id="detail-${esc(id)}" hidden>
        <p>${result.parsed ? "No comparison data" : "Actual output failed to parse"}</p>
      </div>
    </div>`;
  }

  // Parse golden and actual to get structured recipe data
  const goldenParse = goldenMarkdown ? parseDocument(goldenMarkdown) : null;
  const actualParse = parseDocument(result.actual);

  // Build recipe sections
  const recipeSections = comparison.recipes.map((rc) => {
    const goldenRecipe = goldenParse?.recipes.find((r) => r.id === (rc.actualTitle ? findRecipeIdByTitle(goldenParse, rc.goldenTitle) : undefined)) ??
      goldenParse?.recipes.find((r) => r.title === rc.goldenTitle);
    const actualRecipe = actualParse.recipes.find((r) => r.title === rc.actualTitle);
    return renderRecipeSection(rc, goldenRecipe, actualRecipe);
  }).join("");

  // Missing/extra recipes
  const missingRecipesHtml = comparison.missingRecipes.length > 0
    ? `<div class="missing-recipes">Missing recipes: ${comparison.missingRecipes.map(esc).join(", ")}</div>`
    : "";
  const extraRecipesHtml = comparison.extraRecipes.length > 0
    ? `<div class="extra-recipes">Extra recipes: ${comparison.extraRecipes.map(esc).join(", ")}</div>`
    : "";

  // Reference issues
  const refIssuesHtml = comparison.references.brokenRefs > 0
    ? `<div class="ref-issues">Broken references: ${comparison.references.brokenRefs}/${comparison.references.totalRefs}
      <ul>${comparison.references.issues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul></div>`
    : "";

  return `<div class="case-row" data-id="${esc(id)}">
    <div class="case-header" onclick="toggle('${esc(id)}')">
      <span class="case-expand">\u25b6</span>
      <span class="case-name">${esc(id)}</span>
      <span class="case-score ${scoreClass(result.score / 100)}">${result.score}%</span>
      ${renderDeductionBar(comparison)}
    </div>
    <div class="case-detail" id="detail-${esc(id)}" hidden>
      ${renderCategoryBreakdown(comparison)}
      ${missingRecipesHtml}
      ${extraRecipesHtml}
      ${recipeSections}
      ${refIssuesHtml}
    </div>
  </div>`;
}

function findRecipeIdByTitle(parse: import("../core").DocumentParseResult, title: string): string | undefined {
  return parse.recipes.find((r) => r.title === title)?.id;
}

// ============================================================================
// Main Generator
// ============================================================================

export async function generateExplorerHtml(
  baseline: Baseline,
  evalsDir: string,
): Promise<string> {
  // Load golden markdown for each test case
  const entries = Object.entries(baseline.results).sort(
    ([, a], [, b]) => a.score - b.score,
  );

  const cases = await Promise.all(
    entries.map(async ([id, result]) => {
      const goldenPath = join(evalsDir, id, "golden.md");
      const golden = await Bun.file(goldenPath)
        .text()
        .catch(() => null);
      return { id, result, golden };
    }),
  );

  const caseRows = cases
    .map(({ id, result, golden }) => renderCaseRow(id, result, golden))
    .join("");

  const avgScore = baseline.summary.avgScore;
  const caseCount = entries.length;
  const model = baseline.metadata.importerModel ?? "unknown";
  const timestamp = new Date(baseline.timestamp).toLocaleString();

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Eval Explorer</title>
<style>${CSS}</style>
</head>
<body>
<header>
  <h1>Eval Explorer</h1>
  <div class="meta">
    <span>${caseCount} cases</span>
    <span>avg <strong>${avgScore}%</strong></span>
    <span>${esc(model)}</span>
    <span>${timestamp}</span>
  </div>
  <div class="legend">${CATEGORIES.map(
    (c) => `<span class="legend-item"><span class="cat-dot" style="background:${c.color}"></span>${c.label} (${((c.weight / TOTAL_WEIGHT) * 100).toFixed(0)}%)</span>`,
  ).join("")}</div>
</header>
<main>
${caseRows}
</main>
<script>${JS}</script>
</body>
</html>`;
}

// ============================================================================
// Embedded CSS
// ============================================================================

const CSS = `
:root {
  --bg: #fafafa;
  --surface: #fff;
  --border: #e0e0e0;
  --text: #212121;
  --text-muted: #757575;
  --good: #2e7d32;
  --warn: #e65100;
  --bad: #c62828;
  --ins-bg: #c8e6c9;
  --ins-text: #1b5e20;
  --del-bg: #ffcdd2;
  --del-text: #b71c1c;
  --ghost-bg: #fce4ec;
  --extra-bg: #e8f5e9;
}

* { box-sizing: border-box; margin: 0; padding: 0; }

body {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  background: var(--bg);
  color: var(--text);
  line-height: 1.5;
  padding: 1.5rem;
  max-width: 960px;
  margin: 0 auto;
}

header { margin-bottom: 1.5rem; }
h1 { font-size: 1.5rem; font-weight: 600; margin-bottom: 0.25rem; }

.meta {
  display: flex; gap: 1rem; color: var(--text-muted);
  font-size: 0.85rem; margin-bottom: 0.5rem;
}
.meta strong { color: var(--text); }

.legend {
  display: flex; gap: 0.75rem; flex-wrap: wrap;
  font-size: 0.8rem; color: var(--text-muted);
}
.legend-item { display: flex; align-items: center; gap: 0.25rem; }

.cat-dot {
  display: inline-block; width: 10px; height: 10px;
  border-radius: 2px; flex-shrink: 0;
}

/* ── Case rows ─────────────────────────────────────────────── */

.case-row {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: 6px;
  margin-bottom: 0.5rem;
  overflow: hidden;
}

.case-header {
  display: flex; align-items: center; gap: 0.75rem;
  padding: 0.625rem 1rem;
  cursor: pointer;
  user-select: none;
}
.case-header:hover { background: #f5f5f5; }

.case-expand {
  font-size: 0.7rem;
  color: var(--text-muted);
  transition: transform 0.15s;
}
.case-row.open .case-expand { transform: rotate(90deg); }

.case-name {
  font-weight: 500; font-size: 0.9rem;
  min-width: 240px;
}

.case-score {
  font-weight: 600; font-size: 0.9rem;
  min-width: 48px; text-align: right;
}

.score-good { color: var(--good); }
.score-warn { color: var(--warn); }
.score-bad { color: var(--bad); }

/* ── Deduction bar ─────────────────────────────────────────── */

.ded-bar {
  flex: 1;
  display: flex; align-items: center;
  height: 20px;
  border-radius: 3px;
  overflow: hidden;
  background: #e8f5e9;
  position: relative;
}

.ded-seg {
  height: 100%;
  display: flex; align-items: center; justify-content: center;
  color: #fff;
  font-size: 0.65rem;
  font-weight: 600;
  min-width: 2px;
}

.ded-total {
  position: absolute; right: 4px;
  font-size: 0.7rem; font-weight: 600;
  color: var(--text-muted);
}

.ded-perfect {
  color: var(--good);
  font-size: 0.75rem;
  padding-left: 0.5rem;
}

/* ── Case detail ───────────────────────────────────────────── */

.case-detail {
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--border);
}

/* ── Category table ────────────────────────────────────────── */

.cat-table {
  width: 100%; border-collapse: collapse;
  margin-bottom: 1.25rem; font-size: 0.85rem;
}
.cat-table th {
  text-align: left; font-weight: 500;
  padding: 0.25rem 0.5rem;
  border-bottom: 1px solid var(--border);
  color: var(--text-muted);
}
.cat-table td {
  padding: 0.25rem 0.5rem;
}
.cat-table .num { text-align: right; }
.penalty-text { color: var(--bad); }

/* ── Recipe section ────────────────────────────────────────── */

.recipe-section { margin-bottom: 1rem; }
.recipe-section h3 {
  font-size: 1.1rem; font-weight: 600;
  margin-bottom: 0.75rem;
  padding-bottom: 0.25rem;
  border-bottom: 1px solid var(--border);
}

.section-header {
  display: flex; align-items: baseline; gap: 0.5rem;
  margin: 0.75rem 0 0.375rem;
}
.section-header h4 {
  font-size: 0.9rem; font-weight: 600; color: var(--text-muted);
}
.section-score { font-size: 0.85rem; font-weight: 600; }
.section-ded { font-size: 0.8rem; color: var(--bad); }

/* ── Ingredient rows ───────────────────────────────────────── */

.ing-list, .step-list {
  display: flex; flex-direction: column; gap: 2px;
}

.ing-row, .step-row {
  display: grid;
  grid-template-columns: 1fr auto;
  grid-template-rows: auto auto;
  gap: 0 0.75rem;
  padding: 0.375rem 0.5rem;
  border-radius: 4px;
  font-size: 0.85rem;
  line-height: 1.45;
}

.ing-row.imperfect, .step-row.imperfect { background: #fff8e1; }
.ing-row.missing { background: var(--ghost-bg); }
.ing-row.extra { background: var(--extra-bg); }

.ing-text, .step-text { grid-column: 1; grid-row: 1; }
.badge { grid-column: 2; grid-row: 1; white-space: nowrap; font-size: 0.75rem; font-weight: 600; }
.badge.ok { color: var(--good); }
.badge.penalty { color: var(--bad); }

.ing-detail, .step-detail {
  grid-column: 1 / -1; grid-row: 2;
  font-size: 0.75rem; color: var(--text-muted);
  padding-top: 0.125rem;
}

.step-row { grid-template-columns: auto 1fr auto; }
.step-num {
  grid-column: 1; grid-row: 1;
  font-weight: 600; color: var(--text-muted);
  padding-right: 0.5rem;
  min-width: 2rem;
}
.step-text { grid-column: 2; grid-row: 1; }
.step-row .badge { grid-column: 3; grid-row: 1; }
.step-row .step-detail { grid-column: 1 / -1; grid-row: 2; padding-left: 2rem; }

.missing-steps, .extra-steps, .missing-recipes, .extra-recipes {
  font-size: 0.85rem; padding: 0.375rem 0.5rem;
  border-radius: 4px; margin-top: 2px;
}
.missing-steps, .missing-recipes { background: var(--ghost-bg); color: var(--bad); }
.extra-steps, .extra-recipes { background: var(--extra-bg); color: var(--text-muted); }

/* ── Prose diffs ───────────────────────────────────────────── */

.prose-section { margin-bottom: 0.5rem; }
.prose-section h4 { font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.25rem; }
.prose-diff {
  font-size: 0.85rem; padding: 0.375rem 0.5rem;
  border-radius: 4px; margin-bottom: 2px; line-height: 1.45;
}
.prose-diff.removed { background: var(--ghost-bg); }
.prose-diff.added { background: var(--extra-bg); }
.prose-diff.changed { background: #fff8e1; }

/* ── Ref issues ────────────────────────────────────────────── */

.ref-issues {
  font-size: 0.85rem; color: var(--bad);
  margin-top: 0.75rem; padding: 0.5rem;
  background: var(--ghost-bg); border-radius: 4px;
}
.ref-issues ul { padding-left: 1.5rem; margin-top: 0.25rem; }

/* ── Inline diff marks ─────────────────────────────────────── */

ins {
  background: var(--ins-bg); color: var(--ins-text);
  text-decoration: none; border-radius: 2px;
  padding: 0 1px;
}
del {
  background: var(--del-bg); color: var(--del-text);
  text-decoration: line-through; border-radius: 2px;
  padding: 0 1px;
}
`;

// ============================================================================
// Embedded JS
// ============================================================================

const JS = `
function toggle(id) {
  var row = document.querySelector('[data-id="' + id + '"]');
  var detail = document.getElementById('detail-' + id);
  if (!row || !detail) return;
  var open = !detail.hidden;
  detail.hidden = open;
  row.classList.toggle('open', !open);
}
`;
