# Recipe Importer Evaluation System

This directory contains the evaluation (eval) system for measuring and improving the quality of the recipe importer.

## Philosophy

The goal is to **minimize manual editing** after importing a recipe. The ideal outcome is: throw anything into the importer and get a perfect Kniferoll Markdown file that needs no editing.

The eval system helps achieve this by:
- **Measuring progress** through deterministic metrics (parser pass/fail, structured similarity score)
- **Tracking improvement** over time via git-committed baselines
- **Enabling iteration** with fast, cached evaluations
- **Minimizing API costs** by caching importer outputs and only regenerating when the prompt changes

## Workflow

### 1. Import a Recipe

Use homeplate's Import Inbox to convert a recipe from any source:

```bash
cd apps/homeplate && bun run dev
```

Open the `/inbox` page and import a recipe from text, images, or URL. The import is stored in Convex.

### 2. Review and Edit in the Inbox

Use the inbox's side-by-side markdown editor and live preview to fix the importer output into a perfect "golden" version. This becomes your ground truth for what the importer should produce.

### 3. Promote to Eval

Click "Create Eval" in the inbox to mark the import as promoted (saves `goldenMarkdown` alongside the original `recipeMarkdown` in Convex).

### 4. Pull Evals to Disk

Export promoted imports from Convex into the `evals/` directory:

```bash
cd apps/homeplate && bun run pull-evals
```

This creates `evals/<slug>/` for each promoted import with:
- `golden.md` — Human-edited ground truth
- `actual.md` — Original importer output
- `image*.jpg` — Source images (if any)
- `input.txt` — Source text/HTML (if any)
- `extracted.json` — Extracted JSON from vision model (if any)
- `metadata.json` — Model info, token counts, timing, source URL

Existing eval directories are skipped, so it's safe to re-run.

### 5. Run Evaluations

Run evals against all test cases:

```bash
kr eval
```

This uses **cached outputs** from `actual.md` files (fast, no API calls) and shows:
- Parser pass/fail status
- Structured similarity score (0-100%)
- Comparison to previous baseline

#### Optional Flags

```bash
kr eval --save                                    # Save results as new baseline
kr eval --diff                                    # Show detailed breakdown per test case
kr eval --regenerate                              # Re-run importer, update actual.md, save baseline
kr eval --regenerate --model google/gemini-3-flash-preview  # Use specific model
kr eval --only <test-name>                        # Run a single test case
kr eval --extract-only                            # Run image extraction only (stage 1)
kr eval --format-only                             # Run formatting only from extracted.json (stage 2)
```

The default import model is `google/gemini-3-flash-preview`. Use `--model <provider>/<model-id>` to override.

### 6. Iterate on the Importer

When you update the importer prompt or logic:

```bash
kr eval --regenerate   # Re-run importer on all test cases + save new baseline
kr eval --save         # Save new baseline from cached outputs (no re-import)
```

### 7. Track Progress

The `baseline.json` file is committed to git and tracks:
- **Timestamp** — When the baseline was created
- **Metadata** — Which provider/model was used for import
- **Results** — Per-test-case scores (parse status, structured score)
- **Summary** — Aggregate metrics (parse rate, avg score, token usage)

Each eval run compares current results to the baseline and shows deltas:
```
  fried-rice           ✓ parse  95%         (was 85%, +10%)
  simple-pasta         ✓ parse  100%        (=)
```

## Test Case Structure

Each test case lives in `evals/<test-name>/` with:

```
evals/
├── fried-rice/
│   ├── image1.jpg         # Source images
│   ├── golden.md          # Golden version (human-edited)
│   └── actual.md          # Cached importer output
├── simple-pasta/
│   ├── input.txt          # Source text/HTML
│   ├── golden.md          # Golden version (human-edited)
│   └── actual.md          # Cached importer output
└── baseline.json          # Latest eval results (committed to git)
```

## Metrics

All metrics run on every eval with no API costs:

1. **Parser Pass/Fail** — Does the output parse as valid Kniferoll Markdown?
2. **Error/Warning Count** — How many schema validation issues?
3. **Structured Similarity** — Weighted comparison of parsed recipe structure (0-100%). See `SCORING.md` for details.

## Best Practices

1. **Start small** — Add 3-5 high-quality test cases representing different recipe types
2. **Make golden versions perfect** — The quality of your eval set determines the quality of your importer
3. **Commit baselines** — Track progress in git so you can see improvements over time
4. **Regenerate when needed** — Only use `--regenerate` when you change the importer prompt/logic
5. **Name tests clearly** — Use descriptive names like `thai-curry`, `sourdough-bread`, `simple-pasta`

## Troubleshooting

### "Missing actual.md for: ..."

Run `kr eval --regenerate` to generate `actual.md` files for all test cases.

### Low Similarity Scores

- Run `kr eval --diff` to see detailed breakdowns per category (ingredients, steps, metadata, structure)
- Check for missing or extra ingredients (heavily penalized)
- Verify ingredient reference format in steps (`[[ingredient-id]]`)
- See `SCORING.md` for how weights and penalties work
