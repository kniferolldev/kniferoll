# Structured Eval Scoring

## Design Principle

The score should reflect **editing burden** — how much work a human needs to fix the import before publishing. 100% = publish as-is; 0% = start over.

## Overview

Scoring compares two parsed Kniferoll Markdown documents (golden vs actual) using structure-aware Levenshtein similarity. Rather than diffing raw text, it parses both documents and compares ingredients, steps, references, metadata, structure, and prose independently with category-specific weights.

## Architecture

```
ParsedDocument (golden) ──┐
                          ├──► compareDocuments() ──► ComparisonResult
ParsedDocument (actual) ──┘                              │
                                                         ├──► scalar score (0-100)
                                                         └──► detailed breakdown
```

Implementation: `src/eval/compare.ts`, weights in `src/eval/weights.ts`.

## Scoring Model

### Final Score
```
score = Σ(weight_i × subscore_i) / Σ(weight_i)
```

All subscores normalized to 0-1, final score scaled to 0-100.

### Category Weights

| Category | Weight | % of Total | What it measures |
|----------|--------|-----------|-----------------|
| `ingredients` | 3.0 | 37.5% | Are the right ingredients present with correct quantities? |
| `steps` | 2.0 | 25.0% | Is the step text faithful? Are the right ingredients referenced? |
| `references` | 1.5 | 18.75% | Do `[[...]]` links actually resolve to real ingredients? |
| `metadata` | 0.5 | 6.25% | Title, source, frontmatter |
| `structure` | 0.5 | 6.25% | Subrecipe organization |
| `prose` | 0.5 | 6.25% | Intro headnote + notes section content |

Total weight: 8.0

---

## Ingredient Scoring

Ingredients are the core of a recipe. Missing or wrong ingredients are serious errors.

### Matching

Match ingredients between golden and actual by name similarity. An ingredient in golden with no match in actual is "missing". An ingredient in actual with no match in golden is "extra".

### Per-Ingredient Score (0-1)

For each matched pair:

```
ingredient_score = (name_weight × name_sim)
                 + (qty_weight × qty_sim)
                 + (notes_weight × notes_sim)
                 + (attrs_weight × attrs_sim)

Default weights: name=0.25, qty=0.45, notes=0.15, attrs=0.15
```

All similarity scores use **Levenshtein ratio** (0-1 where 1.0 = exact match).

### Missing/Extra Penalties

```
missing_penalty = missing_count × 1.0   # Full point per missing ingredient
extra_penalty = extra_count × 0.3       # Smaller penalty for extras

final_ingredient_score = max(0, matched_score - missing_penalty - extra_penalty)
                         / golden_count
```

---

## Step Scoring

### Matching

Steps are aligned using **sliding-window greedy matching** (±2 index positions). For each golden step (in order), the algorithm finds the best-matching actual step within ±2 positions using Levenshtein distance on resolved text. Matched actual steps are claimed and cannot be reused. A minimum similarity threshold (0.35) prevents forcing bad matches.

This prevents one step split or merge from cascading misalignment across all subsequent steps.

### Per-Step Score (0-1)

```
step_score = (text_weight × text_sim) + (refs_weight × refs_acc)

Default weights: text=0.7, refs=0.3
```

- `text_sim`: Levenshtein ratio of step text (with `[[...]]` references resolved to display text)
- `refs_acc`: Ingredient reference accuracy (fuzzy matching of reference display texts)

### Count Mismatch Penalties

```
missing_step_penalty = 0.5 per missing step
extra_step_penalty = 0.2 per extra step
```

---

## Reference Scoring

Measures what fraction of actual's `[[...]]` references resolve to real ingredients.

Each broken reference represents one manual fix a human must make — the fraction directly maps to editing burden. This catches the common importer error of reversing `[[display -> target]]` syntax.

```
reference_score = valid_refs / total_refs   (1.0 if no refs)
```

The parser's `ReferenceToken.resolvedTargets` array is used to determine validity. Each target in a reference's `targets` array is checked independently — a multi-ingredient reference like `[[accompaniments -> a, b, c]]` counts as three targets. The score is `resolved_targets / total_targets`.

---

## Prose Scoring

Compares intro (headnote) and notes section content between golden and actual.

### Scoring Rules

- Both empty → 1.0 (no content to compare)
- Golden has content, actual doesn't → 0 (missing prose = editing work)
- Golden empty, actual has content → 0.7 (extra prose is less bad)
- Both have content → Levenshtein ratio

### Weighting

Intro and notes sub-scores are weighted by golden content length, so a long headnote matters more than a one-line note.

---

## Metadata Scoring

Weighted field comparison:

| Field | Weight | Comparison |
|-------|--------|------------|
| title | 0.5 | Levenshtein ratio |
| source | 0.3 | Levenshtein ratio (stringified) |
| frontmatter presence | 0.2 | 1.0 if match, 0.0 if mismatch |

---

## Structure Scoring

Evaluates whether the document structure matches:

- **Subrecipe organization**: Does actual have the same subrecipes as golden?
- Missing subrecipes penalized at 1.0 each, extra at 0.3 each.

---

## Edge Cases

- **Parse failure**: If actual fails to parse, score = 0 with issue "failed to parse"
- **Empty sections**: Missing ingredients section = 0 for ingredients subscore
- **No references**: If actual has no `[[...]]` references, reference score = 1.0
- **Name similarity clamping**: `nameSimilarityScore` is clamped to [0, 1] to prevent containment bonus from exceeding 1.0
