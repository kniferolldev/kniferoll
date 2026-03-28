/**
 * Public API for kniferoll core.
 *
 * This barrel export defines the stable public surface.
 *
 * The web component (src/web/) imports internal modules directly via file
 * paths and is not constrained by this boundary.
 */

// ── Functions ──────────────────────────────────────────────────────────

export { parseDocument } from "./parser";
export { extractFrontmatter, serializeFrontmatter } from "./frontmatter";
export { slug } from "./slug";
export { diffRecipes } from "./diff";
export { parseQuantity } from "./quantity";
export { rewrapMarkdown } from "./edit-format";
export {
  lookupUnit,
  toBaseValue,
  fromBaseValue,
  choosePreferredUnit,
  roundToProfile,
} from "./units";

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

// Quantities & units
export type {
  Quantity,
  QuantitySingle,
  QuantityRange,
  QuantityKind,
  UnitDefinition,
  UnitMatch,
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

