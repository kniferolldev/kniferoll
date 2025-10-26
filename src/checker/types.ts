export type Severity = "error" | "warning";

export interface Diagnostic {
  code: string;
  message: string;
  severity: Severity;
  line: number;
  column: number;
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

export interface ReferenceToken {
  original: string;
  display?: string;
  target: string;
  line: number;
  column: number;
}

export interface DocumentParseResult extends FrontmatterParseResult {
  recipes: Recipe[];
  references: ReferenceToken[];
}
