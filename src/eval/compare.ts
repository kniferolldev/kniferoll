/**
 * Structured comparison of Recipe Markdown documents
 *
 * Compares golden (expected) vs actual parse results and produces
 * detailed scoring with actionable feedback.
 */

import type {
  DocumentParseResult,
  Recipe,
  Ingredient,
  Frontmatter,
  IngredientsSection,
  StepsSection,
  SectionLine,
} from "../core/types";
import { DEFAULT_WEIGHTS, type ComparisonWeights } from "./weights";

// ============================================================================
// Result Types
// ============================================================================

export interface IngredientComparison {
  goldenId: string;
  goldenName: string;
  actualId: string | null;
  actualName: string | null;
  nameScore: number;
  quantityScore: number;
  notesScore: number;
  totalScore: number;
  issues: string[];
}

export interface StepComparison {
  index: number;
  textScore: number;
  refsScore: number;
  totalScore: number;
  missingRefs: string[];
  extraRefs: string[];
}

export interface RecipeComparison {
  goldenTitle: string;
  actualTitle: string | null;
  ingredientScore: number;
  stepScore: number;
  ingredients: {
    comparisons: IngredientComparison[];
    missing: string[];
    extra: string[];
  };
  steps: {
    comparisons: StepComparison[];
    missingCount: number;
    extraCount: number;
  };
}

export interface MetadataComparison {
  titleScore: number;
  sourceScore: number;
  overallScore: number;
  issues: string[];
}

export interface ComparisonResult {
  /** Scalar score for hill climbing (0-100) */
  score: number;

  /** Did actual parse successfully? */
  parsed: boolean;

  /** Category subscores (0-1) */
  ingredientScore: number;
  stepScore: number;
  metadataScore: number;
  structureScore: number;

  /** Per-recipe comparisons */
  recipes: RecipeComparison[];

  /** Metadata comparison */
  metadata: MetadataComparison;

  /** Missing/extra recipes */
  missingRecipes: string[];
  extraRecipes: string[];

  /** Human-readable issues for AI harness */
  issues: string[];
}

// ============================================================================
// String Comparison
// ============================================================================

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  if (m === 0) return n;
  if (n === 0) return m;

  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );

  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(
        dp[i - 1]![j]! + 1,
        dp[i]![j - 1]! + 1,
        dp[i - 1]![j - 1]! + cost
      );
    }
  }

  return dp[m]![n]!;
}

/**
 * Calculate Levenshtein ratio (0-1 where 1.0 = identical)
 */
function levenshteinRatio(a: string, b: string): number {
  if (a === b) return 1.0;
  if (a.length === 0 && b.length === 0) return 1.0;

  const distance = levenshteinDistance(a, b);
  const maxLen = Math.max(a.length, b.length);
  return 1 - distance / maxLen;
}

/**
 * Normalize string for comparison (lowercase, trim, collapse whitespace)
 */
function normalize(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

// ============================================================================
// Ingredient Comparison
// ============================================================================

function compareIngredients(
  goldenIngredients: Ingredient[],
  actualIngredients: Ingredient[],
  weights: ComparisonWeights
): {
  comparisons: IngredientComparison[];
  missing: string[];
  extra: string[];
  score: number;
} {
  const comparisons: IngredientComparison[] = [];
  const matchedActualIds = new Set<string>();
  const missing: string[] = [];

  // Match by normalized ID
  for (const golden of goldenIngredients) {
    const actual = actualIngredients.find(
      (a) => a.id === golden.id && !matchedActualIds.has(a.id)
    );

    if (!actual) {
      missing.push(golden.id);
      comparisons.push({
        goldenId: golden.id,
        goldenName: golden.name,
        actualId: null,
        actualName: null,
        nameScore: 0,
        quantityScore: 0,
        notesScore: 0,
        totalScore: 0,
        issues: [`missing ingredient: ${golden.name}`],
      });
      continue;
    }

    matchedActualIds.add(actual.id);

    // Compare name
    const nameScore = levenshteinRatio(
      normalize(golden.name),
      normalize(actual.name)
    );

    // Compare quantity
    const goldenQty = golden.quantityText ?? "";
    const actualQty = actual.quantityText ?? "";
    const quantityScore = levenshteinRatio(
      normalize(goldenQty),
      normalize(actualQty)
    );

    // Compare modifiers/notes
    const goldenNotes = golden.modifiers ?? "";
    const actualNotes = actual.modifiers ?? "";
    const notesScore = levenshteinRatio(
      normalize(goldenNotes),
      normalize(actualNotes)
    );

    // Calculate total score for this ingredient
    const totalScore =
      weights.ingredientName * nameScore +
      weights.ingredientQuantity * quantityScore +
      weights.ingredientNotes * notesScore;

    const issues: string[] = [];
    if (nameScore < 0.95) {
      issues.push(`name: "${actual.name}" vs "${golden.name}"`);
    }
    if (quantityScore < 0.9) {
      issues.push(`qty: "${actualQty}" vs "${goldenQty}"`);
    }
    if (notesScore < 0.9 && (goldenNotes || actualNotes)) {
      issues.push(`notes: "${actualNotes}" vs "${goldenNotes}"`);
    }

    comparisons.push({
      goldenId: golden.id,
      goldenName: golden.name,
      actualId: actual.id,
      actualName: actual.name,
      nameScore,
      quantityScore,
      notesScore,
      totalScore,
      issues,
    });
  }

  // Find extra ingredients
  const extra: string[] = [];
  for (const actual of actualIngredients) {
    if (!matchedActualIds.has(actual.id)) {
      extra.push(actual.id);
    }
  }

  // Calculate overall score with penalties
  const matchedScore = comparisons
    .filter((c) => c.actualId !== null)
    .reduce((sum, c) => sum + c.totalScore, 0);

  const missingPenalty = missing.length * weights.missingIngredientPenalty;
  const extraPenalty = extra.length * weights.extraIngredientPenalty;

  const maxPossible = goldenIngredients.length;
  const rawScore = Math.max(0, matchedScore - missingPenalty - extraPenalty);
  const score = maxPossible > 0 ? rawScore / maxPossible : 1;

  return { comparisons, missing, extra, score: Math.max(0, Math.min(1, score)) };
}

// ============================================================================
// Step Comparison
// ============================================================================

const REFERENCE_PATTERN = /\[\[([^\]]+)\]\]/g;

function extractRefs(text: string): Set<string> {
  const refs = new Set<string>();
  let match;
  REFERENCE_PATTERN.lastIndex = 0;
  while ((match = REFERENCE_PATTERN.exec(text)) !== null) {
    const inner = match[1] ?? "";
    // Handle [[display -> target]] syntax
    const arrowIndex = inner.indexOf("->");
    const target = arrowIndex >= 0 ? inner.slice(arrowIndex + 2).trim() : inner.trim();
    // Normalize to lowercase slug-like form
    refs.add(target.toLowerCase().replace(/\s+/g, "-"));
  }
  return refs;
}

function getStepLines(section: StepsSection): string[] {
  return section.lines
    .map((l) => l.text.trim())
    .filter((t) => t.length > 0 && /^\d+\./.test(t));
}

function compareSteps(
  goldenSection: StepsSection | undefined,
  actualSection: StepsSection | undefined,
  weights: ComparisonWeights
): {
  comparisons: StepComparison[];
  missingCount: number;
  extraCount: number;
  score: number;
} {
  if (!goldenSection) {
    return { comparisons: [], missingCount: 0, extraCount: 0, score: 1 };
  }
  if (!actualSection) {
    const goldenSteps = getStepLines(goldenSection);
    return {
      comparisons: [],
      missingCount: goldenSteps.length,
      extraCount: 0,
      score: 0,
    };
  }

  const goldenSteps = getStepLines(goldenSection);
  const actualSteps = getStepLines(actualSection);

  const comparisons: StepComparison[] = [];
  const minLen = Math.min(goldenSteps.length, actualSteps.length);

  for (let i = 0; i < minLen; i++) {
    const goldenText = goldenSteps[i]!;
    const actualText = actualSteps[i]!;

    // Text similarity
    const textScore = levenshteinRatio(normalize(goldenText), normalize(actualText));

    // Reference accuracy
    const goldenRefs = extractRefs(goldenText);
    const actualRefs = extractRefs(actualText);

    const intersection = new Set([...goldenRefs].filter((r) => actualRefs.has(r)));
    const union = new Set([...goldenRefs, ...actualRefs]);
    const refsScore = union.size > 0 ? intersection.size / union.size : 1;

    const missingRefs = [...goldenRefs].filter((r) => !actualRefs.has(r));
    const extraRefs = [...actualRefs].filter((r) => !goldenRefs.has(r));

    const totalScore =
      weights.stepText * textScore + weights.stepRefs * refsScore;

    comparisons.push({
      index: i + 1,
      textScore,
      refsScore,
      totalScore,
      missingRefs,
      extraRefs,
    });
  }

  const missingCount = Math.max(0, goldenSteps.length - actualSteps.length);
  const extraCount = Math.max(0, actualSteps.length - goldenSteps.length);

  // Calculate score
  const matchedScore = comparisons.reduce((sum, c) => sum + c.totalScore, 0);
  const countPenalty =
    missingCount * weights.missingStepPenalty +
    extraCount * weights.extraStepPenalty;

  const maxPossible = goldenSteps.length;
  const rawScore = Math.max(0, matchedScore - countPenalty);
  const score = maxPossible > 0 ? rawScore / maxPossible : 1;

  return {
    comparisons,
    missingCount,
    extraCount,
    score: Math.max(0, Math.min(1, score)),
  };
}

// ============================================================================
// Recipe Comparison
// ============================================================================

function getIngredientsSection(recipe: Recipe): IngredientsSection | undefined {
  return recipe.sections.find((s) => s.kind === "ingredients") as
    | IngredientsSection
    | undefined;
}

function getStepsSection(recipe: Recipe): StepsSection | undefined {
  return recipe.sections.find((s) => s.kind === "steps") as
    | StepsSection
    | undefined;
}

function compareRecipe(
  golden: Recipe,
  actual: Recipe | undefined,
  weights: ComparisonWeights
): RecipeComparison {
  if (!actual) {
    const goldenIngredients =
      getIngredientsSection(golden)?.ingredients ?? [];
    return {
      goldenTitle: golden.title,
      actualTitle: null,
      ingredientScore: 0,
      stepScore: 0,
      ingredients: {
        comparisons: [],
        missing: goldenIngredients.map((i) => i.id),
        extra: [],
      },
      steps: {
        comparisons: [],
        missingCount: getStepLines(getStepsSection(golden) ?? { kind: "steps", lines: [], title: "", normalizedTitle: "", line: 0 }).length,
        extraCount: 0,
      },
    };
  }

  const goldenIngredients =
    getIngredientsSection(golden)?.ingredients ?? [];
  const actualIngredients =
    getIngredientsSection(actual)?.ingredients ?? [];

  const ingredientResult = compareIngredients(
    goldenIngredients,
    actualIngredients,
    weights
  );

  const stepResult = compareSteps(
    getStepsSection(golden),
    getStepsSection(actual),
    weights
  );

  return {
    goldenTitle: golden.title,
    actualTitle: actual.title,
    ingredientScore: ingredientResult.score,
    stepScore: stepResult.score,
    ingredients: {
      comparisons: ingredientResult.comparisons,
      missing: ingredientResult.missing,
      extra: ingredientResult.extra,
    },
    steps: {
      comparisons: stepResult.comparisons,
      missingCount: stepResult.missingCount,
      extraCount: stepResult.extraCount,
    },
  };
}

// ============================================================================
// Metadata Comparison
// ============================================================================

function stringifySource(source: Frontmatter["source"]): string {
  if (!source) return "";
  if (source.kind === "text") return source.value;
  if (source.kind === "url") return source.url;
  if (source.kind === "cookbook") {
    const parts = [source.title];
    if (source.author) parts.push(source.author);
    return parts.join(" ");
  }
  return "";
}

function compareMetadata(
  golden: DocumentParseResult,
  actual: DocumentParseResult
): MetadataComparison {
  const issues: string[] = [];

  // Title
  const goldenTitle = golden.documentTitle?.text ?? golden.recipes[0]?.title ?? "";
  const actualTitle = actual.documentTitle?.text ?? actual.recipes[0]?.title ?? "";
  const titleScore = levenshteinRatio(normalize(goldenTitle), normalize(actualTitle));
  if (titleScore < 0.9) {
    issues.push(`title: "${actualTitle}" vs "${goldenTitle}"`);
  }

  // Source
  const goldenSource = stringifySource(golden.frontmatter?.source);
  const actualSource = stringifySource(actual.frontmatter?.source);
  const sourceScore =
    goldenSource || actualSource
      ? levenshteinRatio(normalize(goldenSource), normalize(actualSource))
      : 1;
  if (sourceScore < 0.8 && goldenSource) {
    issues.push(`source mismatch`);
  }

  // Overall (weighted average)
  const overallScore = titleScore * 0.6 + sourceScore * 0.4;

  return { titleScore, sourceScore, overallScore, issues };
}

// ============================================================================
// Structure Comparison
// ============================================================================

function compareStructure(
  golden: DocumentParseResult,
  actual: DocumentParseResult
): { score: number; missingRecipes: string[]; extraRecipes: string[] } {
  const goldenIds = new Set(golden.recipes.map((r) => r.id));
  const actualIds = new Set(actual.recipes.map((r) => r.id));

  const missing = [...goldenIds].filter((id) => !actualIds.has(id));
  const extra = [...actualIds].filter((id) => !goldenIds.has(id));

  const matchCount = [...goldenIds].filter((id) => actualIds.has(id)).length;
  const totalExpected = goldenIds.size;

  // Penalize missing more than extra
  const missingPenalty = missing.length * 1.0;
  const extraPenalty = extra.length * 0.3;

  const rawScore = Math.max(0, matchCount - missingPenalty - extraPenalty);
  const score = totalExpected > 0 ? rawScore / totalExpected : 1;

  return {
    score: Math.max(0, Math.min(1, score)),
    missingRecipes: missing,
    extraRecipes: extra,
  };
}

// ============================================================================
// Main Comparison Function
// ============================================================================

/**
 * Compare two parsed Recipe Markdown documents
 *
 * @param golden - Expected (human-edited) parse result
 * @param actual - Actual (generated) parse result
 * @param weights - Optional custom weights (defaults to DEFAULT_WEIGHTS)
 * @returns Detailed comparison result with scalar score
 */
export function compareDocuments(
  golden: DocumentParseResult,
  actual: DocumentParseResult | null,
  weights: Partial<ComparisonWeights> = {}
): ComparisonResult {
  const w = { ...DEFAULT_WEIGHTS, ...weights };

  // Handle parse failure
  if (!actual) {
    return {
      score: 0,
      parsed: false,
      ingredientScore: 0,
      stepScore: 0,
      metadataScore: 0,
      structureScore: 0,
      recipes: [],
      metadata: { titleScore: 0, sourceScore: 0, overallScore: 0, issues: [] },
      missingRecipes: golden.recipes.map((r) => r.id),
      extraRecipes: [],
      issues: ["actual failed to parse"],
    };
  }

  const issues: string[] = [];

  // Structure comparison (recipe matching)
  const structure = compareStructure(golden, actual);
  if (structure.missingRecipes.length > 0) {
    issues.push(`missing recipes: ${structure.missingRecipes.join(", ")}`);
  }
  if (structure.extraRecipes.length > 0) {
    issues.push(`extra recipes: ${structure.extraRecipes.join(", ")}`);
  }

  // Compare each recipe
  const recipeComparisons: RecipeComparison[] = [];
  let totalIngredientScore = 0;
  let totalStepScore = 0;
  let recipeCount = 0;

  for (const goldenRecipe of golden.recipes) {
    const actualRecipe = actual.recipes.find((r) => r.id === goldenRecipe.id);
    const comparison = compareRecipe(goldenRecipe, actualRecipe, w);
    recipeComparisons.push(comparison);

    totalIngredientScore += comparison.ingredientScore;
    totalStepScore += comparison.stepScore;
    recipeCount++;

    // Collect issues
    for (const ic of comparison.ingredients.comparisons) {
      if (ic.issues.length > 0) {
        issues.push(`${goldenRecipe.title}: ${ic.issues.join("; ")}`);
      }
    }
    if (comparison.ingredients.missing.length > 0) {
      issues.push(
        `${goldenRecipe.title}: missing ingredients: ${comparison.ingredients.missing.join(", ")}`
      );
    }
    for (const sc of comparison.steps.comparisons) {
      if (sc.missingRefs.length > 0) {
        issues.push(
          `${goldenRecipe.title} step ${sc.index}: missing refs: ${sc.missingRefs.join(", ")}`
        );
      }
    }
  }

  const avgIngredientScore = recipeCount > 0 ? totalIngredientScore / recipeCount : 1;
  const avgStepScore = recipeCount > 0 ? totalStepScore / recipeCount : 1;

  // Metadata comparison
  const metadata = compareMetadata(golden, actual);
  issues.push(...metadata.issues);

  // Calculate final weighted score
  const totalWeight =
    w.ingredients + w.steps + w.metadata + w.structure;
  const weightedScore =
    (w.ingredients * avgIngredientScore +
      w.steps * avgStepScore +
      w.metadata * metadata.overallScore +
      w.structure * structure.score) /
    totalWeight;

  return {
    score: Math.round(weightedScore * 100),
    parsed: true,
    ingredientScore: avgIngredientScore,
    stepScore: avgStepScore,
    metadataScore: metadata.overallScore,
    structureScore: structure.score,
    recipes: recipeComparisons,
    metadata,
    missingRecipes: structure.missingRecipes,
    extraRecipes: structure.extraRecipes,
    issues,
  };
}
