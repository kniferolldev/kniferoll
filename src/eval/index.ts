/**
 * Structured eval comparison module
 */

export { compareDocuments } from "./compare";
export type {
  ComparisonResult,
  RecipeComparison,
  IngredientComparison,
  StepComparison,
  MetadataComparison,
} from "./compare";

export { DEFAULT_WEIGHTS } from "./weights";
export type { ComparisonWeights } from "./weights";

export { formatScalar, formatDetailed, formatJson } from "./format";
