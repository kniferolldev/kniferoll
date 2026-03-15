/**
 * Public API for kniferoll core.
 *
 * This barrel export defines the stable public surface. Internal modules
 * (units, scaling, formatting, edit-format, source-spans) are intentionally
 * excluded — they're implementation details consumed by the web component.
 *
 * The web component (src/web/) imports internal modules directly via file
 * paths and is not constrained by this boundary.
 */

// ── Functions ──────────────────────────────────────────────────────────

export { parseDocument } from "./parser";
export { extractFrontmatter } from "./frontmatter";
export { slug } from "./slug";
export { diffRecipes } from "./diff";

// ── Types ──────────────────────────────────────────────────────────────

// Parse result
export type {
  DocumentParseResult,
  FrontmatterParseResult,
  ParseOptions,
  Diagnostic,
  Severity,
  DocumentTitle,
} from "./types";

// Recipe structure
export type {
  Recipe,
  IngredientsSection,
  Ingredient,
  IngredientAttribute,
  StepsSection,
  SectionLine,
  TextBlock,
} from "./types";

// Quantities
export type {
  Quantity,
  QuantitySingle,
  QuantityRange,
  QuantityKind,
} from "./types";

// Frontmatter
export type {
  Frontmatter,
  Source,
  UrlSource,
  TextSource,
  CookbookSource,
  ScalePreset,
  ScaleAnchor,
} from "./types";

// Inline values (on DocumentParseResult.inlineValues)
export type {
  DocumentInlineValueAny,
  DocumentInlineTemperatureValue,
  DocumentInlineQuantityValue,
} from "./types";

// References & links (on DocumentParseResult)
export type { ReferenceToken, RecipeLink } from "./types";

// Diff annotations
export type { DiffAnnotation, DiffStatus, AttributeDiff } from "./diff";
