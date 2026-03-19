/**
 * Scoring weights for structured eval comparison
 *
 * Edit these values to tune the scoring model.
 */

export interface ComparisonWeights {
  // Category weights (how much each category matters in final score)
  ingredients: number;
  steps: number;
  references: number;
  metadata: number;
  structure: number;
  prose: number;

  // Ingredient sub-weights (must sum to 1.0)
  ingredientName: number;
  ingredientQuantity: number;
  ingredientNotes: number;
  ingredientAttrs: number;

  // Ingredient penalties
  missingIngredientPenalty: number;
  extraIngredientPenalty: number;

  // Step sub-weights (must sum to 1.0)
  stepText: number;
  stepRefs: number;

  // Step penalties
  missingStepPenalty: number;
  extraStepPenalty: number;
}

/**
 * Tuning guide:
 *
 * Category weights (ingredients, steps, metadata, structure) are relative to
 * each other - they get normalized to sum to 1.0. So ingredients=3, steps=2
 * means ingredients count 1.5x more than steps. The absolute values don't
 * matter, only ratios.
 *
 * Sub-weights within a category (e.g., ingredientName/Quantity/Notes) should
 * sum to 1.0 since they divide up that category's score.
 *
 * Penalties are subtracted from category scores. A penalty of 1.0 means one
 * missing ingredient costs as much as one perfect ingredient contributes.
 */
export const DEFAULT_WEIGHTS: ComparisonWeights = {
  // Category weights
  ingredients: 3.0,
  steps: 2.0,
  references: 1.5,
  metadata: 0.5,
  structure: 0.5,
  prose: 0.5,

  // Ingredient sub-weights
  ingredientName: 0.25,
  ingredientQuantity: 0.45,
  ingredientNotes: 0.15,
  ingredientAttrs: 0.15,

  // Ingredient penalties (per missing/extra ingredient)
  missingIngredientPenalty: 1.0,
  extraIngredientPenalty: 0.3,

  // Step sub-weights
  stepText: 0.7,
  stepRefs: 0.3,

  // Step penalties
  missingStepPenalty: 0.5,
  extraStepPenalty: 0.2,
};
