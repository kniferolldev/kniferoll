export type Severity = "error" | "warning";

export interface Diagnostic {
  code: string;
  message: string;
  severity: Severity;
  line: number;
  column: number;
}

export type UnitDimension = "mass" | "volume" | "count" | "temperature" | "other";

export type UnitFamily = "mass" | "volume_metric" | "volume_us" | "count";

export interface RoundingProfile {
  /** Minimum increment to round to. Example: 0.25 for quarter cups. */
  increment: number;
  /** Optional fixed precision override (decimal places) after rounding to increment. */
  precision?: number;
}

export interface UnitDefinition {
  canonical: string;
  display: string;
  aliases: readonly string[];
  dimension: UnitDimension;
  rounding: RoundingProfile;
  base?: string;
  toBase?: number;
  family?: UnitFamily;
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
  anchor: ScaleAnchor;
}

export interface Frontmatter {
  version: string;
  source?: Source;
  scales?: ScalePreset[];
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

export type SectionKind = "ingredients" | "steps" | "notes" | "unknown";

export interface SectionLine {
  text: string;
  line: number;
}

export interface IngredientAttribute {
  key: string;
  value: string | null;
  quantity?: Quantity;
}

export type QuantityKind = "single" | "range";

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

export type Quantity = QuantitySingle | QuantityRange;


export interface ScaledQuantitySingle extends QuantitySingle {
  scaledValue: number;
  unitInfo?: UnitMatch | null;
}

export interface ScaledQuantityRange extends QuantityRange {
  scaledMin: number;
  scaledMax: number;
  unitInfo?: UnitMatch | null;
}

export type ScaledQuantity = ScaledQuantitySingle | ScaledQuantityRange;

export interface Ingredient {
  line: number;
  text: string;
  name: string;
  id: string;
  quantityText: string | null;
  quantity: Quantity | null;
  modifiers: string | null;
  attributes: IngredientAttribute[];
}

interface RecipeSectionBase {
  title: string;
  normalizedTitle: string;
  line: number;
  lines: SectionLine[];
}

export interface IngredientsSection extends RecipeSectionBase {
  kind: "ingredients";
  ingredients: Ingredient[];
}

export interface StepsSection extends RecipeSectionBase {
  kind: "steps";
}

export interface NotesSection extends RecipeSectionBase {
  kind: "notes";
}

export interface UnknownSection extends RecipeSectionBase {
  kind: "unknown";
}

export type TimerDuration = { hours: number; minutes: number; seconds: number };

export interface StepTokenBase {
  raw: string;
  /**
   * Zero-based index within the source line.
   */
  index: number;
}

export interface StepTimerToken extends StepTokenBase {
  kind: "timer";
  start: TimerDuration;
}

export interface StepTemperatureToken extends StepTokenBase {
  kind: "temperature";
  value: number;
  scale: "F" | "C";
}

export type StepToken = StepTimerToken | StepTemperatureToken;

export type InvalidStepToken = StepTokenBase;

export interface DocumentStepTimerToken extends StepTimerToken {
  line: number;
  column: number;
  recipeId: string;
  recipeTitle: string;
}

export interface DocumentStepTemperatureToken extends StepTemperatureToken {
  line: number;
  column: number;
  recipeId: string;
  recipeTitle: string;
}

export type DocumentStepToken =
  | DocumentStepTimerToken
  | DocumentStepTemperatureToken;

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

export type RecipeSection =
  | IngredientsSection
  | StepsSection
  | NotesSection
  | UnknownSection;

export interface Recipe {
  title: string;
  id: string;
  line: number;
  sections: RecipeSection[];
}

export interface DocumentTitle {
  text: string;
  line: number;
}

export interface ReferenceToken {
  original: string;
  display?: string;
  /** The raw target slug from the reference text. */
  target: string;
  /** The recipe ID where this reference appears (for scoped resolution). */
  recipeId: string;
  /** The resolved qualified ID after two-phase lookup. */
  resolvedTarget?: string;
  line: number;
  column: number;
}

export interface DocumentParseResult extends FrontmatterParseResult {
  documentTitle: DocumentTitle | null;
  recipes: Recipe[];
  references: ReferenceToken[];
  stepTokens: DocumentStepToken[];
}
