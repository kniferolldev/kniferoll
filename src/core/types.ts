export type Severity = "error" | "warning";

export interface Diagnostic {
  code: string;
  message: string;
  severity: Severity;
  line: number;
  column: number;
}

export type UnitDimension = "mass" | "volume" | "count" | "temperature" | "other";

export type UnitSystem = "metric" | "imperial";

export interface RoundingProfile {
  /** Minimum increment to round to. Example: 0.25 for quarter cups. */
  increment: number;
  /** Optional fixed precision override (decimal places) after rounding to increment. */
  precision?: number;
}

export interface UnitDefinition {
  canonical: string;
  display: string;
  /** Plural form for display (e.g. "cups"). Only needed for units whose display form changes with count. */
  pluralDisplay?: string;
  aliases: readonly string[];
  dimension: UnitDimension;
  rounding: RoundingProfile;
  base?: string;
  toBase?: number;
  system?: UnitSystem;
  preferred?: {
    /** Preferred unit when value is >= threshold (in base units). */
    thresholds: { unit: string; min: number }[];
  };
}

export interface UnitMatch extends UnitDefinition {
  matched: string;
}

export interface UrlSource {
  kind: "url";
  url: string;
  title?: string;
  accessed?: string;
}

export interface TextSource {
  kind: "text";
  value: string;
}

export interface CookbookSource {
  kind: "cookbook";
  title: string;
  author?: string;
  pages?: string | number;
  isbn?: string;
  year?: number;
}

export type Source = UrlSource | TextSource | CookbookSource;

export interface ScaleAnchor {
  id: string;
  amount: number;
  unit: string;
}

export interface ScalePreset {
  name: string;
  anchor: string;
  amount: Quantity;
}

export interface Frontmatter {
  version: number;
  source?: Source;
  scales?: ScalePreset[];
  yield?: Quantity;
}

export interface ParseOptions {
  knownIds?: Iterable<string>;
}

export interface FrontmatterParseResult {
  frontmatter: Frontmatter | null;
  body: string;
  diagnostics: Diagnostic[];
  bodyStartLine: number;
}

export interface SectionLine {
  /** Full original text of the line (including list/step prefix). */
  text: string;
  /** Display content with list/step prefix stripped. Tokens are indexed against this. */
  content: string;
  line: number;
  /**
   * When a step spans multiple source lines (after reflow), maps character
   * offsets in `content` to their original source line numbers.
   * Each entry is [charOffset, sourceLine]. Sorted by charOffset ascending.
   */
  lineSpans?: [number, number][];
}

export interface TextBlock extends SectionLine {
  kind: "paragraph" | "ul-item" | "ol-item" | "header";
  /** For headers: 3 = ###, 4 = #### */
  level?: number;
}

export interface IngredientAttribute {
  key: string;
  value: string | null;
  quantity?: Quantity;
}

export type QuantityKind = "single" | "range" | "compound";

export interface QuantitySingle {
  kind: "single";
  raw: string;
  value: number;
  unit: string | null;
}

export interface QuantityRange {
  kind: "range";
  raw: string;
  min: number;
  max: number;
  unit: string | null;
}

export interface QuantityCompound {
  kind: "compound";
  raw: string;
  parts: [QuantitySingle, QuantitySingle];
}

export type Quantity = QuantitySingle | QuantityRange | QuantityCompound;


export interface ScaledQuantitySingle extends QuantitySingle {
  scaledValue: number;
  unitInfo?: UnitMatch | null;
}

export interface ScaledQuantityRange extends QuantityRange {
  scaledMin: number;
  scaledMax: number;
  unitInfo?: UnitMatch | null;
}

export interface ScaledQuantityCompound extends QuantityCompound {
  scaledParts: [ScaledQuantitySingle, ScaledQuantitySingle];
}

export type ScaledQuantity = ScaledQuantitySingle | ScaledQuantityRange | ScaledQuantityCompound;

export interface Ingredient {
  line: number;
  text: string;
  name: string;
  id: string;
  quantityText: string | null;
  quantity: Quantity | null;
  modifiers: string | null;
  attributes: IngredientAttribute[];
  linkedRecipeId?: string;
}

export interface RecipeLink {
  fromRecipeId: string;
  ingredientId: string;
  toRecipeId: string;
}

export interface IngredientsSection {
  title: string;
  line: number;
  ingredients: Ingredient[];
}

export interface StepsSection {
  title: string;
  line: number;
  lines: SectionLine[];
}

export interface InlineValueBase {
  raw: string;
  /**
   * Zero-based index within the source line.
   */
  index: number;
}

export interface InlineTemperatureValue extends InlineValueBase {
  kind: "temperature";
  value: number;
  scale: "F" | "C";
}

export interface InlineQuantityValue extends InlineValueBase {
  kind: "quantity";
  quantity: Quantity;
  alternates?: Quantity[];
}

export type InlineValue = InlineTemperatureValue | InlineQuantityValue;

export type InvalidInlineValue = InlineValueBase;

export type DocumentInlineValue<T extends InlineValue> = T & {
  line: number;
  column: number;
  recipeId: string;
  recipeTitle: string;
};

export type DocumentInlineTemperatureValue = DocumentInlineValue<InlineTemperatureValue>;
export type DocumentInlineQuantityValue = DocumentInlineValue<InlineQuantityValue>;
export type DocumentInlineValueAny = DocumentInlineValue<InlineValue>;

export interface IngredientReference {
  id: string;
  name: string;
  line: number;
  recipeId: string;
  recipeTitle: string;
}

export interface ComputeScaleFactorBase {
  anchor: ScaleAnchor;
  ingredient: IngredientReference & { quantity: QuantitySingle };
  source: "preset" | "manual";
}

export interface ComputeScaleFactorSuccess extends ComputeScaleFactorBase {
  ok: true;
  factor: number;
  preset?: { name: string; index: number };
}

export interface ComputeScaleFactorFailure {
  ok: false;
  reason:
    | "invalid-selection"
    | "missing-frontmatter"
    | "no-scales"
    | "preset-not-found"
    | "anchor-invalid"
    | "ingredient-not-found"
    | "ingredient-missing-quantity"
    | "ingredient-range-quantity"
    | "unit-mismatch"
    | "zero-quantity";
  message: string;
}

export type ComputeScaleFactorResult =
  | ComputeScaleFactorSuccess
  | ComputeScaleFactorFailure;

export type ScaleSelection =
  | { presetName: string }
  | { presetIndex: number }
  | { anchor: ScaleAnchor };

export interface Recipe {
  title: string;
  id: string;
  line: number;
  intro: TextBlock[];
  introLines: SectionLine[];
  ingredients: IngredientsSection;
  steps: StepsSection;
  notes: TextBlock[];
}

export interface DocumentTitle {
  text: string;
  line: number;
}

export interface ReferenceToken {
  original: string;
  display?: string;
  /** Raw target slug(s) from the reference text. Multi-ingredient refs have multiple entries. */
  targets: string[];
  /** The recipe ID where this reference appears (for scoped resolution). */
  recipeId: string;
  /** Resolved qualified IDs after two-phase lookup (parallel to targets). */
  resolvedTargets: string[];
  line: number;
  column: number;
}

export interface DocumentParseResult extends FrontmatterParseResult {
  documentTitle: DocumentTitle | null;
  recipes: Recipe[];
  references: ReferenceToken[];
  inlineValues: DocumentInlineValueAny[];
  recipeLinks: RecipeLink[];
}
