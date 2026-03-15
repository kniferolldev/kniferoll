/**
 * Recipe diff: compare two Recipe objects and produce element-level annotations
 * with word-level inline diffs for changed text elements.
 *
 * This is a pure function with no DOM dependencies.
 */

import type { Recipe, TextBlock, Ingredient } from "./types";

export type DiffStatus = "added" | "changed" | "removed";

export type InlineDiffToken =
  | { kind: "equal"; text: string }
  | { kind: "insert"; text: string }
  | { kind: "delete"; text: string };

export interface AttributeDiff {
  key: string;
  status: "added" | "removed";
}

export interface DiffAnnotation {
  /** Which section of the recipe this element belongs to. */
  section: "intro" | "ingredients" | "steps" | "notes";
  /** Element key: block index (intro/steps/notes) or ingredient id (ingredients). */
  key: string;
  status: DiffStatus;
  /** For "changed" text elements, word-level diff tokens for redline display. */
  tokens?: InlineDiffToken[];
  /** For ingredients, per-attribute add/remove info. */
  attributeDiffs?: AttributeDiff[];
}

/**
 * Compare two recipes and return diff annotations for the "after" recipe.
 */
export function diffRecipes(before: Recipe, after: Recipe): DiffAnnotation[] {
  const annotations: DiffAnnotation[] = [];

  diffTextBlocks(before.intro, after.intro, "intro", annotations);
  diffIngredients(before.ingredients.ingredients, after.ingredients.ingredients, annotations);
  diffStepLines(before.steps.lines, after.steps.lines, annotations);
  diffTextBlocks(before.notes, after.notes, "notes", annotations);

  return annotations;
}

// ── Word-level diff (Myers' algorithm) ─────────────────────────────────

/**
 * Tokenize text into words, whitespace, and markup delimiters for diffing.
 * Splits on [[ ]] { } . , so the diff algorithm can see through added
 * recipe markup (ingredient references, scalable values) to the unchanged
 * core text.
 */
function tokenize(text: string): string[] {
  return text.match(/\[\[|\]\]|[{}.,]|[^\s\[\]{}.,]+|\s+/g) ?? [];
}

/**
 * Compute a word-level diff between two strings.
 * Returns an array of equal/insert/delete tokens.
 */
export function wordDiff(before: string, after: string): InlineDiffToken[] {
  const a = tokenize(before);
  const b = tokenize(after);
  const edits = myersDiff(a, b);
  return compactTokens(edits);
}

/**
 * Myers' diff algorithm on token arrays.
 * Returns raw edit operations (equal/insert/delete).
 *
 * Based on "An O(ND) Difference Algorithm" by Eugene W. Myers.
 * We record the frontier array at each step, then backtrack to
 * reconstruct the shortest edit script.
 */
function myersDiff(
  a: string[],
  b: string[],
): InlineDiffToken[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  if (max === 0) return [];

  // offset so diagonal k is stored at index k + max
  const size = 2 * max + 1;
  const v = new Int32Array(size);
  // trace[d] = snapshot of v at the START of iteration d
  const trace: Int32Array[] = [];

  outer:
  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[k - 1 + max]! < v[k + 1 + max]!)) {
        x = v[k + 1 + max]!; // insert: move down from diagonal k+1
      } else {
        x = v[k - 1 + max]! + 1; // delete: move right from diagonal k-1
      }
      let y = x - k;

      // follow diagonal (equal tokens)
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }

      v[k + max] = x;

      if (x >= n && y >= m) {
        // Found the shortest edit path — backtrack
        return backtrack(trace, d, a, b, max);
      }
    }
  }

  // Should never reach here for finite inputs
  return [
    ...a.map((t) => ({ kind: "delete" as const, text: t })),
    ...b.map((t) => ({ kind: "insert" as const, text: t })),
  ];
}

function backtrack(
  trace: Int32Array[],
  finalD: number,
  a: string[],
  b: string[],
  max: number,
): InlineDiffToken[] {
  // Walk backwards through the trace to reconstruct the edit script.
  // At each step d (from finalD down to 1) we figure out which edit
  // (insert or delete) was made, and collect any diagonal (equal) moves.
  const result: InlineDiffToken[] = [];
  let x = a.length;
  let y = b.length;

  for (let d = finalD; d > 0; d--) {
    const vPrev = trace[d]!; // frontier at the START of iteration d (before edits at d)
    const k = x - y;

    // Determine which diagonal we came from
    let prevK: number;
    if (k === -d || (k !== d && vPrev[k - 1 + max]! < vPrev[k + 1 + max]!)) {
      prevK = k + 1; // came via insert (down) from diagonal k+1
    } else {
      prevK = k - 1; // came via delete (right) from diagonal k-1
    }

    // The x-coordinate on the previous diagonal at the end of step d-1
    const prevX = vPrev[prevK + max]!;
    const prevY = prevX - prevK;

    // Diagonal moves (equal) after the edit at step d
    while (x > prevX + (prevK < k ? 1 : 0) && y > prevY + (prevK > k ? 1 : 0)) {
      x--;
      y--;
      result.push({ kind: "equal", text: a[x]! });
    }

    // The edit itself
    if (prevK < k) {
      // delete: moved right (x increased, same y)
      x--;
      result.push({ kind: "delete", text: a[x]! });
    } else {
      // insert: moved down (y increased, same x)
      y--;
      result.push({ kind: "insert", text: b[y]! });
    }
  }

  // Remaining diagonal at d=0 (initial matching run)
  while (x > 0 && y > 0) {
    x--;
    y--;
    result.push({ kind: "equal", text: a[x]! });
  }

  result.reverse();
  return result;
}

/** Merge consecutive tokens of the same kind. */
function compactTokens(tokens: InlineDiffToken[]): InlineDiffToken[] {
  if (tokens.length === 0) return [];
  const result: InlineDiffToken[] = [{ ...tokens[0]! }];
  for (let i = 1; i < tokens.length; i++) {
    const curr = tokens[i]!;
    const last = result[result.length - 1]!;
    if (curr.kind === last.kind) {
      last.text += curr.text;
    } else {
      result.push({ ...curr });
    }
  }
  return result;
}

// ── Section diffing ────────────────────────────────────────────────────

function blockContent(block: TextBlock): string {
  return block.content.trim();
}

function diffTextBlocks(
  before: TextBlock[],
  after: TextBlock[],
  section: "intro" | "notes",
  annotations: DiffAnnotation[],
): void {
  const maxLen = Math.max(before.length, after.length);
  for (let i = 0; i < maxLen; i++) {
    const b = before[i];
    const a = after[i];
    if (!b && a) {
      annotations.push({ section, key: String(i), status: "added" });
    } else if (b && !a) {
      annotations.push({ section, key: String(i), status: "removed" });
    } else if (b && a) {
      if (blockContent(b) !== blockContent(a) || b.kind !== a.kind) {
        const tokens = wordDiff(blockContent(b), blockContent(a));
        annotations.push({ section, key: String(i), status: "changed", tokens });
      }
    }
  }
}

function diffIngredients(
  before: Ingredient[],
  after: Ingredient[],
  annotations: DiffAnnotation[],
): void {
  const beforeMap = new Map<string, Ingredient>();
  for (const ing of before) {
    beforeMap.set(ing.id, ing);
  }

  const afterMap = new Map<string, Ingredient>();
  for (const ing of after) {
    afterMap.set(ing.id, ing);
  }

  for (const ing of after) {
    const prev = beforeMap.get(ing.id);
    if (!prev) {
      annotations.push({ section: "ingredients", key: ing.id, status: "added" });
    } else if (ingredientChanged(prev, ing)) {
      const attrDiffs = diffAttributes(prev, ing);
      // Diff content (qty/name/mods) separately from attributes
      const beforeContent = ingredientContentText(prev);
      const afterContent = ingredientContentText(ing);
      const contentChanged = beforeContent !== afterContent;
      const tokens = contentChanged ? wordDiff(beforeContent, afterContent) : undefined;
      annotations.push({
        section: "ingredients",
        key: ing.id,
        status: "changed",
        ...(tokens && { tokens }),
        ...(attrDiffs.length > 0 && { attributeDiffs: attrDiffs }),
      });
    }
  }

  for (const ing of before) {
    if (!afterMap.has(ing.id)) {
      annotations.push({ section: "ingredients", key: ing.id, status: "removed" });
    }
  }
}

/** Build a text representation of ingredient content (qty/name/mods) for diffing. */
function ingredientContentText(ing: Ingredient): string {
  const parts: string[] = [];
  if (ing.quantityText) parts.push(ing.quantityText);
  parts.push(ing.name);
  if (ing.modifiers) parts.push(`, ${ing.modifiers}`);
  return parts.join(" ");
}

function ingredientChanged(a: Ingredient, b: Ingredient): boolean {
  return (
    a.name !== b.name ||
    a.quantityText !== b.quantityText ||
    a.modifiers !== b.modifiers ||
    attributesChanged(a, b)
  );
}

function attributesChanged(a: Ingredient, b: Ingredient): boolean {
  const aAttrs = a.attributes
    .filter((attr) => attr.key !== "id")
    .map((attr) => `${attr.key}=${attr.value ?? ""}`)
    .sort()
    .join(",");
  const bAttrs = b.attributes
    .filter((attr) => attr.key !== "id")
    .map((attr) => `${attr.key}=${attr.value ?? ""}`)
    .sort()
    .join(",");
  return aAttrs !== bAttrs;
}

/** Compare attributes between two ingredients, returning per-key add/remove diffs. */
function diffAttributes(before: Ingredient, after: Ingredient): AttributeDiff[] {
  const diffs: AttributeDiff[] = [];
  const beforeKeys = new Set(
    before.attributes.filter((a) => a.key !== "id").map((a) => a.key),
  );
  const afterKeys = new Set(
    after.attributes.filter((a) => a.key !== "id").map((a) => a.key),
  );
  for (const key of afterKeys) {
    if (!beforeKeys.has(key)) {
      diffs.push({ key, status: "added" });
    }
  }
  for (const key of beforeKeys) {
    if (!afterKeys.has(key)) {
      diffs.push({ key, status: "removed" });
    }
  }
  return diffs;
}

function diffStepLines(
  before: { content: string; line: number }[],
  after: { content: string; line: number }[],
  annotations: DiffAnnotation[],
): void {
  const beforeSteps = before.filter((l) => l.content.trim() !== "");
  const afterSteps = after.filter((l) => l.content.trim() !== "");
  const maxLen = Math.max(beforeSteps.length, afterSteps.length);
  for (let i = 0; i < maxLen; i++) {
    const b = beforeSteps[i];
    const a = afterSteps[i];
    if (!b && a) {
      annotations.push({ section: "steps", key: String(i), status: "added" });
    } else if (b && !a) {
      annotations.push({ section: "steps", key: String(i), status: "removed" });
    } else if (b && a) {
      if (b.content.trim() !== a.content.trim()) {
        const tokens = wordDiff(b.content.trim(), a.content.trim());
        annotations.push({ section: "steps", key: String(i), status: "changed", tokens });
      }
    }
  }
}
