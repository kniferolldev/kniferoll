/**
 * Structured comparison of Kniferoll Markdown documents
 *
 * Compares golden (expected) vs actual parse results and produces
 * detailed scoring with actionable feedback.
 */

import type {
  DocumentParseResult,
  Recipe,
  Ingredient,
  IngredientAttribute,
  Frontmatter,
  IngredientsSection,
  StepsSection,
  SectionLine,
  ReferenceToken,
  TextBlock,
} from "../core";
import { DEFAULT_WEIGHTS, type ComparisonWeights } from "./weights";

// ============================================================================
// Result Types
// ============================================================================

export interface IngredientComparison {
  goldenId: string;
  goldenName: string;
  actualId: string | null;
  actualName: string | null;
  goldenLine: number;
  actualLine: number | null;
  nameScore: number;
  quantityScore: number;
  notesScore: number;
  attrsScore: number;
  totalScore: number;
  issues: string[];
}

export interface StepComparison {
  index: number;
  goldenLine: number;
  actualLine: number | null;
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

export interface ReferenceComparison {
  totalRefs: number;
  brokenRefs: number;
  score: number;
  issues: string[];
}

export interface ProseComparison {
  introScore: number;
  notesScore: number;
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
  referenceScore: number;
  proseScore: number;
  metadataScore: number;
  structureScore: number;

  /** Per-recipe comparisons */
  recipes: RecipeComparison[];

  /** Metadata comparison */
  metadata: MetadataComparison;

  /** Reference validity comparison */
  references: ReferenceComparison;

  /** Prose (intro + notes) comparison */
  prose: ProseComparison;

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
 * Normalize string for comparison: lowercase, trim, collapse whitespace,
 * and normalize typographic variants (dashes, quotes) to ASCII equivalents.
 */
function normalize(s: string): string {
  return s
    .toLowerCase()
    .trim()
    .replace(/[\u2013\u2014]/g, "-")   // en-dash, em-dash → hyphen
    .replace(/[\u2018\u2019]/g, "'")   // curly single quotes → straight
    .replace(/[\u201c\u201d]/g, '"')   // curly double quotes → straight
    .replace(/\s+/g, " ");
}

// ============================================================================
// Ingredient Comparison
// ============================================================================

/**
 * Serialize attributes to a comparable string format.
 * Excludes 'id' since that's just an override for the auto-generated ID.
 */
function serializeAttrs(attrs: IngredientAttribute[]): string {
  return attrs
    .filter((a) => a.key !== "id")
    .map((a) => (a.value ? `${a.key}=${a.value}` : a.key))
    .sort()
    .join(" ");
}

/**
 * Calculate name similarity score with containment and word-overlap bonuses.
 *
 * Substring containment: "sea salt" in "coarse sea salt" → boost.
 * Word overlap: all words of "grapeseed oil" appear in "grapeseed or other
 * neutral oil" even though it's not a substring → boost.
 */
function nameSimilarityScore(golden: string, actual: string): number {
  const goldenNorm = normalize(golden);
  const actualNorm = normalize(actual);

  // Base Levenshtein ratio
  const levScore = levenshteinRatio(goldenNorm, actualNorm);

  // Substring containment check
  if (goldenNorm.includes(actualNorm) || actualNorm.includes(goldenNorm)) {
    const shorter = Math.min(goldenNorm.length, actualNorm.length);
    if (shorter >= 5) {
      return Math.max(levScore, 0.65);
    }
    const longer = Math.max(goldenNorm.length, actualNorm.length);
    const containmentScore = shorter / longer;
    return Math.min(1, Math.max(levScore, containmentScore * 1.5, 0.5));
  }

  // Word-overlap check: if all significant words of the shorter name appear
  // in the longer name, treat it like containment. Handles cases like
  // "maldon sea salt" vs "maldon or other high-quality coarse sea salt".
  const goldenWords = significantWords(goldenNorm);
  const actualWords = significantWords(actualNorm);
  const [shorter, longerSet] =
    goldenWords.length <= actualWords.length
      ? [goldenWords, new Set(actualWords)]
      : [actualWords, new Set(goldenWords)];
  if (shorter.length >= 2 && shorter.every((w) => longerSet.has(w))) {
    return Math.max(levScore, 0.65);
  }

  return levScore;
}

/** Extract words that carry meaning (skip articles, prepositions, conjunctions) */
const STOP_WORDS = new Set(["a", "an", "the", "of", "or", "and", "for", "with", "to", "in", "other"]);
function significantWords(s: string): string[] {
  return s.split(/[\s,]+/).filter((w) => w.length > 0 && !STOP_WORDS.has(w));
}

/**
 * Find the best matching actual ingredient for a golden ingredient by name similarity.
 * Returns the best match and its score, or null if no match above threshold.
 */
function findBestIngredientMatch(
  golden: Ingredient,
  actualIngredients: Ingredient[],
  matchedActualIndices: Set<number>,
  threshold: number = 0.5
): { actual: Ingredient; index: number; nameScore: number } | null {
  let bestMatch: { actual: Ingredient; index: number; nameScore: number } | null = null;

  for (let i = 0; i < actualIngredients.length; i++) {
    if (matchedActualIndices.has(i)) continue;

    const actual = actualIngredients[i]!;
    const nameScore = nameSimilarityScore(golden.name, actual.name);

    if (nameScore >= threshold && (!bestMatch || nameScore > bestMatch.nameScore)) {
      bestMatch = { actual, index: i, nameScore };
    }
  }

  return bestMatch;
}

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
  const matchedActualIndices = new Set<number>();
  const missing: string[] = [];

  // Match by name similarity
  for (const golden of goldenIngredients) {
    const match = findBestIngredientMatch(golden, actualIngredients, matchedActualIndices);

    if (!match) {
      missing.push(golden.id);
      comparisons.push({
        goldenId: golden.id,
        goldenName: golden.name,
        actualId: null,
        actualName: null,
        goldenLine: golden.line,
        actualLine: null,
        nameScore: 0,
        quantityScore: 0,
        notesScore: 0,
        attrsScore: 0,
        totalScore: 0,
        issues: [`missing ingredient: ${golden.name}`],
      });
      continue;
    }

    matchedActualIndices.add(match.index);
    const actual = match.actual;
    const nameScore = match.nameScore;

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

    // Compare attributes (excluding id=)
    const goldenAttrs = serializeAttrs(golden.attributes);
    const actualAttrs = serializeAttrs(actual.attributes);
    const attrsScore =
      goldenAttrs || actualAttrs
        ? levenshteinRatio(goldenAttrs, actualAttrs)
        : 1.0;

    // Calculate total score for this ingredient
    const totalScore =
      weights.ingredientName * nameScore +
      weights.ingredientQuantity * quantityScore +
      weights.ingredientNotes * notesScore +
      weights.ingredientAttrs * attrsScore;

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
    if (attrsScore < 0.9 && (goldenAttrs || actualAttrs)) {
      issues.push(`attrs: "${actualAttrs}" vs "${goldenAttrs}"`);
    }

    comparisons.push({
      goldenId: golden.id,
      goldenName: golden.name,
      actualId: actual.id,
      actualName: actual.name,
      goldenLine: golden.line,
      actualLine: actual.line,
      nameScore,
      quantityScore,
      notesScore,
      attrsScore,
      totalScore,
      issues,
    });
  }

  // Find extra ingredients
  const extra: string[] = [];
  for (let i = 0; i < actualIngredients.length; i++) {
    if (!matchedActualIndices.has(i)) {
      extra.push(actualIngredients[i]!.id);
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

/**
 * Build a lookup map from ingredient ID to ingredient name.
 */
function buildIngredientLookup(ingredients: Ingredient[]): Map<string, string> {
  const lookup = new Map<string, string>();
  for (const ing of ingredients) {
    lookup.set(ing.id, ing.name);
  }
  return lookup;
}

/**
 * Resolve a single [[...]] reference to its display text.
 * - [[display -> id]] → "display"
 * - [[id]] → lookup ingredient name, fallback to id if not found
 */
function resolveReference(inner: string, ingredientLookup: Map<string, string>): string {
  const arrowIndex = inner.indexOf("->");
  if (arrowIndex >= 0) {
    // [[display -> id]] syntax - use the display text
    return inner.slice(0, arrowIndex).trim();
  }
  // [[id]] syntax - look up the ingredient name
  const id = inner.trim().toLowerCase().replace(/\s+/g, "-");
  return ingredientLookup.get(id) ?? inner.trim();
}

/**
 * Resolve all [[...]] references in step text to display text.
 * Returns the step text with all references replaced by their display form.
 */
function resolveStepRefs(text: string, ingredientLookup: Map<string, string>): string {
  return text.replace(REFERENCE_PATTERN, (_, inner: string) => {
    return resolveReference(inner, ingredientLookup);
  });
}

/**
 * Extract reference display texts from step text (for diff reporting).
 */
function extractRefDisplays(text: string, ingredientLookup: Map<string, string>): string[] {
  const refs: string[] = [];
  let match;
  REFERENCE_PATTERN.lastIndex = 0;
  while ((match = REFERENCE_PATTERN.exec(text)) !== null) {
    const inner = match[1] ?? "";
    refs.push(normalize(resolveReference(inner, ingredientLookup)));
  }
  return refs;
}

/**
 * Compare two sets of reference names using fuzzy matching.
 * Returns matched, missing, extra refs and a score.
 */
function compareRefSets(
  goldenRefs: string[],
  actualRefs: string[]
): { score: number; missingRefs: string[]; extraRefs: string[] } {
  if (goldenRefs.length === 0 && actualRefs.length === 0) {
    return { score: 1, missingRefs: [], extraRefs: [] };
  }

  const matchedActualIndices = new Set<number>();
  const missingRefs: string[] = [];
  let matchScore = 0;

  // For each golden ref, find the best matching actual ref
  for (const goldenRef of goldenRefs) {
    let bestMatch: { index: number; score: number } | null = null;

    for (let i = 0; i < actualRefs.length; i++) {
      if (matchedActualIndices.has(i)) continue;

      const actualRef = actualRefs[i]!;
      // Use containment-aware similarity
      const similarity = nameSimilarityScore(goldenRef, actualRef);

      if (similarity >= 0.5 && (!bestMatch || similarity > bestMatch.score)) {
        bestMatch = { index: i, score: similarity };
      }
    }

    if (bestMatch) {
      matchedActualIndices.add(bestMatch.index);
      matchScore += bestMatch.score;
    } else {
      missingRefs.push(goldenRef);
    }
  }

  // Find extra refs in actual that weren't matched
  const extraRefs: string[] = [];
  for (let i = 0; i < actualRefs.length; i++) {
    if (!matchedActualIndices.has(i)) {
      extraRefs.push(actualRefs[i]!);
    }
  }

  // Score: matched refs / total expected refs, penalized by extras
  const totalExpected = goldenRefs.length;
  const matchRatio = totalExpected > 0 ? matchScore / totalExpected : 1;
  const extraPenalty = extraRefs.length * 0.1; // Small penalty for extra refs
  const score = Math.max(0, Math.min(1, matchRatio - extraPenalty));

  return { score, missingRefs, extraRefs };
}

interface StepEntry {
  text: string;
  line: number;
}

function getStepEntries(section: StepsSection): StepEntry[] {
  return section.lines
    .filter((l) => {
      const t = l.text.trim();
      return t.length > 0 && /^\d+\./.test(t);
    })
    .map((l) => ({ text: l.text.trim(), line: l.line }));
}

function compareSteps(
  goldenSection: StepsSection | undefined,
  actualSection: StepsSection | undefined,
  goldenIngredients: Ingredient[],
  actualIngredients: Ingredient[],
  weights: ComparisonWeights
): {
  comparisons: StepComparison[];
  missingCount: number;
  extraCount: number;
  score: number;
} {
  const goldenLookup = buildIngredientLookup(goldenIngredients);
  const actualLookup = buildIngredientLookup(actualIngredients);

  if (!goldenSection) {
    return { comparisons: [], missingCount: 0, extraCount: 0, score: 1 };
  }
  if (!actualSection) {
    const goldenEntries = getStepEntries(goldenSection);
    return {
      comparisons: [],
      missingCount: goldenEntries.length,
      extraCount: 0,
      score: 0,
    };
  }

  const goldenEntries = getStepEntries(goldenSection);
  const actualEntries = getStepEntries(actualSection);

  // Pre-resolve all step text for comparison
  const goldenResolved = goldenEntries.map((s) => normalize(resolveStepRefs(s.text, goldenLookup)));
  const actualResolved = actualEntries.map((s) => normalize(resolveStepRefs(s.text, actualLookup)));

  // Sliding-window greedy alignment: for each golden step, find the best
  // matching actual step within ±2 index positions. This prevents one
  // step split/merge from cascading misalignment across all subsequent steps.
  // A minimum similarity threshold avoids forcing bad matches that block
  // better ones later.
  const WINDOW = 2;
  const MIN_ALIGNMENT_SCORE = 0.35;
  const claimedActual = new Set<number>();
  const comparisons: StepComparison[] = [];
  const goldenMatched = new Set<number>();

  for (let gi = 0; gi < goldenEntries.length; gi++) {
    let bestIdx = -1;
    let bestTextScore = -1;

    const lo = Math.max(0, gi - WINDOW);
    const hi = Math.min(actualEntries.length - 1, gi + WINDOW);

    for (let ai = lo; ai <= hi; ai++) {
      if (claimedActual.has(ai)) continue;
      const score = levenshteinRatio(goldenResolved[gi]!, actualResolved[ai]!);
      if (score > bestTextScore) {
        bestTextScore = score;
        bestIdx = ai;
      }
    }

    if (bestIdx >= 0 && bestTextScore >= MIN_ALIGNMENT_SCORE) {
      claimedActual.add(bestIdx);
      goldenMatched.add(gi);

      const goldenText = goldenEntries[gi]!.text;
      const actualText = actualEntries[bestIdx]!.text;
      const textScore = bestTextScore;

      // Reference accuracy
      const goldenRefs = extractRefDisplays(goldenText, goldenLookup);
      const actualRefs = extractRefDisplays(actualText, actualLookup);
      const refComparison = compareRefSets(goldenRefs, actualRefs);

      const totalScore =
        weights.stepText * textScore + weights.stepRefs * refComparison.score;

      comparisons.push({
        index: gi + 1,
        goldenLine: goldenEntries[gi]!.line,
        actualLine: actualEntries[bestIdx]!.line,
        textScore,
        refsScore: refComparison.score,
        totalScore,
        missingRefs: refComparison.missingRefs,
        extraRefs: refComparison.extraRefs,
      });
    }
  }

  const missingCount = goldenEntries.length - goldenMatched.size;
  const extraCount = actualEntries.length - claimedActual.size;

  // Calculate score
  const matchedScore = comparisons.reduce((sum, c) => sum + c.totalScore, 0);
  const countPenalty =
    missingCount * weights.missingStepPenalty +
    extraCount * weights.extraStepPenalty;

  const maxPossible = goldenEntries.length;
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

function getIngredientsSection(recipe: Recipe): IngredientsSection {
  return recipe.ingredients;
}

function getStepsSection(recipe: Recipe): StepsSection {
  return recipe.steps;
}

function compareRecipe(
  golden: Recipe,
  actual: Recipe | undefined,
  weights: ComparisonWeights
): RecipeComparison {
  if (!actual) {
    const goldenIngredients = getIngredientsSection(golden).ingredients;
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
        missingCount: getStepEntries(getStepsSection(golden)).length,
        extraCount: 0,
      },
    };
  }

  const goldenIngredients = getIngredientsSection(golden).ingredients;
  const actualIngredients = getIngredientsSection(actual).ingredients;

  const ingredientResult = compareIngredients(
    goldenIngredients,
    actualIngredients,
    weights
  );

  const stepResult = compareSteps(
    getStepsSection(golden),
    getStepsSection(actual),
    goldenIngredients,
    actualIngredients,
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

  // Frontmatter presence: compare to golden
  let frontmatterScore = 1.0;
  const goldenHasFrontmatter = golden.frontmatter != null;
  const actualHasFrontmatter = actual.frontmatter != null;

  if (!goldenHasFrontmatter && actualHasFrontmatter) {
    // Golden has no frontmatter, actual does - that's wrong
    frontmatterScore = 0.0;
    issues.push("unexpected frontmatter");
  } else if (goldenHasFrontmatter && !actualHasFrontmatter) {
    // Golden has frontmatter, actual doesn't - that's wrong
    frontmatterScore = 0.0;
    issues.push("missing frontmatter");
  }

  // Overall (weighted average): title 50%, source 30%, frontmatter presence 20%
  const overallScore = titleScore * 0.5 + sourceScore * 0.3 + frontmatterScore * 0.2;

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
// Reference Validity Scoring
// ============================================================================

/**
 * Score what fraction of actual's references are valid (resolve to a real ingredient).
 * Each broken reference = one manual fix. The fraction maps to editing burden.
 */
function compareReferences(
  _golden: DocumentParseResult,
  actual: DocumentParseResult
): ReferenceComparison {
  const refs = actual.references;
  const totalRefs = refs.length;

  if (totalRefs === 0) {
    return { totalRefs: 0, brokenRefs: 0, score: 1, issues: [] };
  }

  const totalTargets = refs.reduce((n, r) => n + r.targets.length, 0);
  const resolvedTargets = refs.reduce((n, r) => n + r.resolvedTargets.length, 0);
  const brokenRefs = totalTargets - resolvedTargets;
  const score = totalTargets === 0 ? 1 : resolvedTargets / totalTargets;

  // Deduplicate broken reference issues
  const seen = new Set<string>();
  const issues: string[] = [];
  for (const ref of refs) {
    if (ref.resolvedTargets.length < ref.targets.length && !seen.has(ref.original)) {
      seen.add(ref.original);
      issues.push(`broken reference: ${ref.original}`);
    }
  }

  return { totalRefs, brokenRefs, score, issues };
}

// ============================================================================
// Prose Scoring (Intro + Notes)
// ============================================================================

function joinTextBlocks(blocks: TextBlock[]): string {
  return blocks.map((b) => b.content).join("\n");
}

/**
 * Compare intro and notes prose content between golden and actual recipes.
 * Scores are weighted by golden content length so longer prose matters more.
 */
function compareProse(
  goldenRecipes: Recipe[],
  actualRecipes: Recipe[]
): ProseComparison {
  const issues: string[] = [];
  let introWeightedSum = 0;
  let introWeightTotal = 0;
  let notesWeightedSum = 0;
  let notesWeightTotal = 0;

  for (const goldenRecipe of goldenRecipes) {
    const actualRecipe = actualRecipes.find((r) => r.id === goldenRecipe.id);

    const goldenIntro = joinTextBlocks(goldenRecipe.intro);
    const actualIntro = actualRecipe ? joinTextBlocks(actualRecipe.intro) : "";

    const introScore = scoreProseField(goldenIntro, actualIntro);
    const introWeight = Math.max(goldenIntro.length, 1);
    introWeightedSum += introScore * introWeight;
    introWeightTotal += introWeight;

    if (introScore < 0.9 && goldenIntro) {
      issues.push(`${goldenRecipe.title}: intro differs`);
    }

    const goldenNotes = joinTextBlocks(goldenRecipe.notes);
    const actualNotes = actualRecipe ? joinTextBlocks(actualRecipe.notes) : "";

    const notesScore = scoreProseField(goldenNotes, actualNotes);
    const notesWeight = Math.max(goldenNotes.length, 1);
    notesWeightedSum += notesScore * notesWeight;
    notesWeightTotal += notesWeight;

    if (notesScore < 0.9 && goldenNotes) {
      issues.push(`${goldenRecipe.title}: notes differ`);
    }
  }

  const introScore = introWeightTotal > 0 ? introWeightedSum / introWeightTotal : 1;
  const notesScore = notesWeightTotal > 0 ? notesWeightedSum / notesWeightTotal : 1;

  // Average intro and notes, weighted by total content length
  const totalIntroLen = introWeightTotal;
  const totalNotesLen = notesWeightTotal;
  const totalLen = totalIntroLen + totalNotesLen;
  const overallScore =
    totalLen > 2
      ? (introScore * totalIntroLen + notesScore * totalNotesLen) / totalLen
      : (introScore + notesScore) / 2;

  return { introScore, notesScore, overallScore, issues };
}

/**
 * Score a single prose field (intro or notes).
 * Both empty → 1.0. Golden has content, actual doesn't → 0. Vice versa → 0.7.
 */
function scoreProseField(golden: string, actual: string): number {
  const goldenNorm = normalize(golden);
  const actualNorm = normalize(actual);

  if (!goldenNorm && !actualNorm) return 1.0;
  if (goldenNorm && !actualNorm) return 0;
  if (!goldenNorm && actualNorm) return 0.7;

  return levenshteinRatio(goldenNorm, actualNorm);
}

// ============================================================================
// Main Comparison Function
// ============================================================================

/**
 * Compare two parsed Kniferoll Markdown documents
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
      referenceScore: 0,
      proseScore: 0,
      metadataScore: 0,
      structureScore: 0,
      recipes: [],
      metadata: { titleScore: 0, sourceScore: 0, overallScore: 0, issues: [] },
      references: { totalRefs: 0, brokenRefs: 0, score: 0, issues: [] },
      prose: { introScore: 0, notesScore: 0, overallScore: 0, issues: [] },
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

  // Reference validity comparison
  const references = compareReferences(golden, actual);
  issues.push(...references.issues);

  // Prose comparison (intro + notes)
  const prose = compareProse(golden.recipes, actual.recipes);
  issues.push(...prose.issues);

  // Calculate final weighted score
  const totalWeight =
    w.ingredients + w.steps + w.references + w.metadata + w.structure + w.prose;
  const weightedScore =
    (w.ingredients * avgIngredientScore +
      w.steps * avgStepScore +
      w.references * references.score +
      w.metadata * metadata.overallScore +
      w.structure * structure.score +
      w.prose * prose.overallScore) /
    totalWeight;

  return {
    score: Math.round(weightedScore * 100),
    parsed: true,
    ingredientScore: avgIngredientScore,
    stepScore: avgStepScore,
    referenceScore: references.score,
    proseScore: prose.overallScore,
    metadataScore: metadata.overallScore,
    structureScore: structure.score,
    recipes: recipeComparisons,
    metadata,
    references,
    prose,
    missingRecipes: structure.missingRecipes,
    extraRecipes: structure.extraRecipes,
    issues,
  };
}
