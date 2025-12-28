/**
 * Output formatting for structured eval comparison
 */

import type { ComparisonResult, RecipeComparison, IngredientComparison, StepComparison } from "./compare";

/**
 * Format as scalar score only (default view)
 */
export function formatScalar(result: ComparisonResult): string {
  if (!result.parsed) {
    return "0% (parse failed)";
  }
  return `${result.score}%`;
}

/**
 * Format as detailed breakdown (--diff view)
 */
export function formatDetailed(result: ComparisonResult): string[] {
  const lines: string[] = [];

  if (!result.parsed) {
    lines.push("Parse failed");
    return lines;
  }

  lines.push(`Score: ${result.score}%`);
  lines.push("");

  // Category scores
  lines.push(`Ingredients: ${pct(result.ingredientScore)}`);
  lines.push(`Steps: ${pct(result.stepScore)}`);
  lines.push(`Metadata: ${pct(result.metadataScore)}`);
  lines.push(`Structure: ${pct(result.structureScore)}`);
  lines.push("");

  // Per-recipe details
  for (const recipe of result.recipes) {
    lines.push(`Recipe: ${recipe.goldenTitle}`);

    // Ingredient details
    const matched = recipe.ingredients.comparisons.filter((c) => c.actualId !== null).length;
    const total = recipe.ingredients.comparisons.length;
    lines.push(`  Ingredients: ${pct(recipe.ingredientScore)} (${matched}/${total} matched)`);

    for (const id of recipe.ingredients.missing) {
      lines.push(`    ✗ missing: ${id}`);
    }
    for (const id of recipe.ingredients.extra) {
      lines.push(`    + extra: ${id}`);
    }
    for (const c of recipe.ingredients.comparisons) {
      if (c.actualId && c.totalScore < 0.95) {
        const parts: string[] = [];
        if (c.nameScore < 0.95) parts.push(`name=${pct(c.nameScore)}`);
        if (c.quantityScore < 0.95) parts.push(`qty=${pct(c.quantityScore)}`);
        if (c.notesScore < 0.95) parts.push(`notes=${pct(c.notesScore)}`);
        lines.push(`    ~ ${c.goldenId}: ${parts.join(", ")}`);
      }
    }

    // Step details
    const stepCount = recipe.steps.comparisons.length;
    const missingSteps = recipe.steps.missingCount;
    const extraSteps = recipe.steps.extraCount;
    let stepSummary = `${stepCount} matched`;
    if (missingSteps > 0) stepSummary += `, ${missingSteps} missing`;
    if (extraSteps > 0) stepSummary += `, ${extraSteps} extra`;
    lines.push(`  Steps: ${pct(recipe.stepScore)} (${stepSummary})`);

    for (const s of recipe.steps.comparisons) {
      if (s.totalScore < 0.9 || s.missingRefs.length > 0) {
        const parts: string[] = [];
        if (s.textScore < 0.9) parts.push(`text=${pct(s.textScore)}`);
        if (s.missingRefs.length > 0) parts.push(`missing refs: ${s.missingRefs.join(", ")}`);
        if (s.extraRefs.length > 0) parts.push(`extra refs: ${s.extraRefs.join(", ")}`);
        lines.push(`    ~ step ${s.index}: ${parts.join("; ")}`);
      }
    }

    lines.push("");
  }

  // Missing/extra recipes
  if (result.missingRecipes.length > 0) {
    lines.push(`Missing recipes: ${result.missingRecipes.join(", ")}`);
  }
  if (result.extraRecipes.length > 0) {
    lines.push(`Extra recipes: ${result.extraRecipes.join(", ")}`);
  }

  return lines;
}

/**
 * Format as JSON (for AI harness)
 */
export function formatJson(result: ComparisonResult): string {
  return JSON.stringify(result, null, 2);
}

/**
 * Format percentage from 0-1 ratio
 */
function pct(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}
