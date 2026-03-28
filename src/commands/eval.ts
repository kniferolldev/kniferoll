/**
 * Eval Command - Run evaluations and compare to baseline
 *
 * This runs the importer on test case inputs and compares
 * the generated output to the expected (human-edited) version.
 */

import { join } from "path";
import { parseDocument } from "../core";
import type { DocumentParseResult } from "../core";
import type { IO } from "../types";
import { compareDocuments, formatDetailed, type ComparisonResult } from "../eval";
import type { TestCaseResult, Baseline, EvalMetadata } from "../eval/types";
import {
  importRecipe,
  extractRecipe,
  extractRecipeFromText,
  formatRecipe,
  parseModelSpec,
  formatModelSpec,
  getApiKey,
  getApiKeyEnvVar,
  DEFAULT_IMPORT_MODEL,
  DEFAULT_FORMAT_MODEL,
  type ModelSpec,
  type InferenceInput,
  type LazyImage,
  type InferenceMetrics,
  type ExtractionResult,
} from "../import";

// ============================================================================
// Types
// ============================================================================

/** Test case loaded from disk */
interface TestCase {
  id: string;
  input: { kind: "text"; text: string } | { kind: "images"; paths: string[] };
  expected: string;
}

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface ParsedArgs {
  save: boolean;
  diff: boolean;
  explore: boolean;
  regenerate: boolean;
  extractOnly: boolean;
  formatOnly: boolean;
  model: ModelSpec | null;
  evalsDir: string;
  only: string | null;
}

interface ParseResult {
  args: ParsedArgs;
  error?: string;
}

function parseArgs(args: string[]): ParseResult {
  let save = false;
  let diff = false;
  let explore = false;
  let regenerate = false;
  let extractOnly = false;
  let formatOnly = false;
  let model: ModelSpec | null = null;
  let evalsDir = "evals";
  let only: string | null = null;
  let error: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--save") save = true;
    else if (arg === "--diff") diff = true;
    else if (arg === "--explore") explore = true;
    else if (arg === "--regenerate") {
      regenerate = true;
      save = true; // --regenerate implies --save
    }
    else if (arg === "--extract-only") {
      extractOnly = true;
      regenerate = true;
      save = true; // --extract-only implies --regenerate --save
    }
    else if (arg === "--format-only") {
      formatOnly = true;
      save = true; // --format-only implies --save
    }
    else if (arg === "--model" && args[i + 1]) {
      const spec = args[++i]!;
      model = parseModelSpec(spec);
      if (!model) {
        error = `Invalid model format: "${spec}"\nExpected format: <provider>/<model> (e.g., google/gemini-3-flash-preview)`;
      }
    }
    else if (arg === "--only" && args[i + 1]) {
      only = args[++i]!;
    }
    else if (!arg.startsWith("-")) evalsDir = arg;
  }

  return { args: { save, diff, explore, regenerate, extractOnly, formatOnly, model, evalsDir, only }, error };
}

// ============================================================================
// Import Wrapper
// ============================================================================

/** Result from running the importer */
interface ImporterResult {
  markdown: string;
  metrics?: InferenceMetrics;
  /** Extracted JSON from two-stage pipeline (images only) */
  extractedJson?: string;
}

/**
 * Convert test case input to InferenceInput format and run import
 */
async function runImporter(
  model: ModelSpec,
  input: TestCase["input"],
): Promise<ImporterResult> {
  // Convert test case input format to InferenceInput
  let inferInput: InferenceInput;

  if (input.kind === "text") {
    inferInput = { text: input.text };
  } else {
    // Convert file paths to LazyImage format
    const images: LazyImage[] = input.paths.map((path) => ({
      kind: "lazy" as const,
      path,
    }));
    inferInput = { images };
  }

  const result = await importRecipe(inferInput, {
    model: formatModelSpec(model),
  });

  return {
    markdown: result.markdown,
    metrics: result.metrics,
    extractedJson: result.extractedJson,
  };
}

/**
 * Run text extraction only (stage 1 of two-stage import)
 */
async function runExtractor(
  model: ModelSpec,
  input: TestCase["input"],
): Promise<ExtractionResult> {
  if (input.kind === "text") {
    return extractRecipeFromText({ text: input.text }, {
      model: formatModelSpec(model),
    });
  }

  // Convert file paths to LazyImage format
  const images: LazyImage[] = input.paths.map((path) => ({
    kind: "lazy" as const,
    path,
  }));

  return extractRecipe({ images }, {
    model: formatModelSpec(model),
  });
}

/** Result for extraction-only evaluation */
interface ExtractionTestResult {
  id: string;
  success: boolean;
  sectionCount: number;
  totalChars: number;
  rawJson: string;
  metrics?: InferenceMetrics;
  error?: string;
}

// ============================================================================
// Test Case Loading
// ============================================================================

interface LoadedTestCase extends TestCase {
  actualCached?: string; // cached importer output from actual.md
}

async function loadTestCases(evalsDir: string): Promise<LoadedTestCase[]> {
  const testCases: LoadedTestCase[] = [];

  const entries = await Array.fromAsync(
    new Bun.Glob("**/golden.md").scan({ cwd: evalsDir })
  );

  for (const entry of entries) {
    const id = entry.replace("/golden.md", "");
    const testCaseDir = join(evalsDir, id);

    const goldenFile = Bun.file(join(testCaseDir, "golden.md"));
    if (!(await goldenFile.exists())) continue;
    const expected = await goldenFile.text();

    // Load cached actual.md if it exists
    const actualFile = Bun.file(join(testCaseDir, "actual.md"));
    const actualCached = (await actualFile.exists()) ? await actualFile.text() : undefined;

    const inputTextFile = Bun.file(join(testCaseDir, "input.txt"));
    if (await inputTextFile.exists()) {
      const text = await inputTextFile.text();
      testCases.push({ id, input: { kind: "text", text }, expected, actualCached });
    } else {
      const imageFiles = await Array.fromAsync(
        new Bun.Glob("image*.{jpg,jpeg,png,webp}").scan({ cwd: testCaseDir })
      );
      if (imageFiles.length > 0) {
        testCases.push({
          id,
          input: { kind: "images", paths: imageFiles.sort().map(f => join(testCaseDir, f)) },
          expected,
          actualCached,
        });
      }
    }
  }

  return testCases.sort((a, b) => a.id.localeCompare(b.id));
}

// ============================================================================
// Baseline Loading/Saving
// ============================================================================

async function loadBaseline(evalsDir: string): Promise<Baseline | null> {
  const file = Bun.file(join(evalsDir, "baseline.json"));
  if (!(await file.exists())) return null;
  try {
    return await file.json();
  } catch {
    return null;
  }
}

async function saveBaseline(evalsDir: string, baseline: Baseline): Promise<void> {
  await Bun.write(
    join(evalsDir, "baseline.json"),
    JSON.stringify(baseline, null, 2) + "\n"
  );
}

// ============================================================================
// Evaluation
// ============================================================================

function evaluateOutput(id: string, actual: string, expected: string): TestCaseResult {
  const actualParsed = parseDocument(actual);
  const expectedParsed = parseDocument(expected);
  const errors = actualParsed.diagnostics.filter(d => d.severity === "error");
  const warnings = actualParsed.diagnostics.filter(d => d.severity === "warning");

  // Use structured comparison
  const comparison = compareDocuments(
    expectedParsed,
    errors.length === 0 ? actualParsed : null
  );

  return {
    id,
    parsed: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    score: comparison.score,
    comparison,
    actual,
  };
}

function formatDelta(current: number, previous: number | undefined, suffix = ""): string {
  if (previous === undefined) return "(new)";
  const delta = current - previous;
  if (delta === 0) return "(=)";
  const sign = delta > 0 ? "+" : "";
  return `(was ${previous}${suffix}, ${sign}${delta}${suffix})`;
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function runEval(args: string[], io: IO): Promise<number> {
  const write = (s: string) => io.stdout.write(s);
  const writeErr = (s: string) => io.stderr.write(s);

  const parseResult = parseArgs(args);
  if (parseResult.error) {
    writeErr(`Error: ${parseResult.error}\n`);
    return 2;
  }

  const { save, diff, explore, regenerate, extractOnly, formatOnly, model, evalsDir, only } = parseResult.args;

  // --explore: generate HTML visualization and open in browser
  if (explore) {
    const baseline = await loadBaseline(evalsDir);
    if (!baseline) {
      writeErr(`No baseline.json found in ${evalsDir}/. Run \`kr eval --save\` first.\n`);
      return 1;
    }
    const { generateExplorerHtml } = await import("../eval/explorer");
    const html = await generateExplorerHtml(baseline, evalsDir);
    const outPath = join(evalsDir, "explorer.html");
    await Bun.write(outPath, html);
    write(`Wrote ${outPath}\n`);
    const proc = Bun.spawn(["open", outPath]);
    await proc.exited;
    return 0;
  }

  // Resolve models: use defaults when not specified
  const importModel = regenerate
    ? (model ?? parseModelSpec(DEFAULT_IMPORT_MODEL)!)
    : null;

  // Check API keys early if we need models
  if (importModel) {
    const apiKey = getApiKey(importModel.provider);
    if (!apiKey) {
      const envVar = getApiKeyEnvVar(importModel.provider);
      writeErr(`Error: ${envVar} environment variable is not set.\n`);
      writeErr(`Set it with: export ${envVar}=your-key-here\n`);
      return 1;
    }
  }

  // Load test cases
  let testCases = await loadTestCases(evalsDir);
  if (testCases.length === 0) {
    writeErr(`No test cases found in ${evalsDir}/\n`);
    return 1;
  }

  // Filter to specific test case if --only is specified
  if (only) {
    const filtered = testCases.filter(tc => tc.id === only || tc.id.includes(only));
    if (filtered.length === 0) {
      writeErr(`No test case matching "${only}" found.\n`);
      writeErr(`Available test cases: ${testCases.map(tc => tc.id).join(", ")}\n`);
      return 1;
    }
    testCases = filtered;
  }

  // Check for missing actual.md files
  const missingActual = testCases.filter(tc => !tc.actualCached);
  if (missingActual.length > 0 && !regenerate) {
    writeErr(`Missing actual.md for: ${missingActual.map(tc => tc.id).join(", ")}\n`);
    writeErr(`Run with --regenerate to generate them.\n`);
    return 1;
  }

  // Load baseline
  const baseline = await loadBaseline(evalsDir);
  const baselineDate = baseline?.timestamp
    ? new Date(baseline.timestamp).toLocaleDateString()
    : null;

  // ========================================================================
  // Extract-only mode: just run text extraction and save JSON
  // ========================================================================
  if (extractOnly) {
    write(`Extracting from ${testCases.length} test case(s)...`);
    write(` [model: ${formatModelSpec(importModel!)}]`);
    write("\n\n");

    const extractResults: ExtractionTestResult[] = [];

    for (const tc of testCases) {
      write(`  ${tc.id}... `);

      try {
        const result = await runExtractor(importModel!, tc.input);
        const testCaseDir = join(evalsDir, tc.id);

        // Save the raw JSON
        await Bun.write(join(testCaseDir, "extracted.json"), result.rawJson);

        // Count extracted content
        const sectionCount = result.extracted.sections?.length ?? 0;
        const totalChars = result.rawJson.length;

        extractResults.push({
          id: tc.id,
          success: true,
          sectionCount,
          totalChars,
          rawJson: result.rawJson,
          metrics: result.metrics,
        });

        write(`done (${sectionCount} sections, ${totalChars} chars)\n`);

        // Display metrics
        if (result.metrics) {
          const m = result.metrics;
          const durationSec = (m.durationMs / 1000).toFixed(1);
          write(`    Duration: ${durationSec}s | Tokens: ${m.inputTokens.toLocaleString()} in / ${m.outputTokens.toLocaleString()} out\n`);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        write(`error: ${msg}\n`);
        extractResults.push({
          id: tc.id,
          success: false,
          sectionCount: 0,
          totalChars: 0,
          rawJson: "",
          error: msg,
        });
      }
    }

    // Summary
    write("\nExtraction Summary:\n");
    const successCount = extractResults.filter(r => r.success).length;
    const totalDuration = extractResults.reduce((sum, r) => sum + (r.metrics?.durationMs ?? 0), 0);
    const totalInput = extractResults.reduce((sum, r) => sum + (r.metrics?.inputTokens ?? 0), 0);
    const totalOutput = extractResults.reduce((sum, r) => sum + (r.metrics?.outputTokens ?? 0), 0);
    const avgSections = Math.round(extractResults.reduce((sum, r) => sum + r.sectionCount, 0) / extractResults.length);
    const avgChars = Math.round(extractResults.reduce((sum, r) => sum + r.totalChars, 0) / extractResults.length);

    write(`  Success rate: ${successCount}/${extractResults.length}\n`);
    write(`  Avg sections: ${avgSections}\n`);
    write(`  Avg chars:    ${avgChars}\n`);
    write(`  Total time:   ${(totalDuration / 1000).toFixed(1)}s\n`);
    write(`  Total tokens: ${totalInput.toLocaleString()} in / ${totalOutput.toLocaleString()} out\n`);

    write(`\nExtracted JSON saved to evals/<test>/extracted.json\n`);
    return successCount === extractResults.length ? 0 : 1;
  }

  // ========================================================================
  // Format-only mode: run stage 2 on existing extracted.json
  // ========================================================================
  if (formatOnly) {
    const formatModel = model ?? parseModelSpec(DEFAULT_FORMAT_MODEL)!;

    // Check API key for format model
    const apiKey = getApiKey(formatModel.provider);
    if (!apiKey) {
      const envVar = getApiKeyEnvVar(formatModel.provider);
      writeErr(`Error: ${envVar} environment variable is not set.\n`);
      writeErr(`Set it with: export ${envVar}=your-key-here\n`);
      return 1;
    }

    write(`Formatting ${testCases.length} test case(s)...`);
    write(` [model: ${formatModelSpec(formatModel)}]`);
    if (baselineDate) {
      write(` (comparing to baseline from ${baselineDate})`);
    }
    write("\n\n");

    const results: Record<string, TestCaseResult> = {};

    for (const tc of testCases) {
      write(`  ${tc.id}... `);
      const testCaseDir = join(evalsDir, tc.id);
      const extractedFile = Bun.file(join(testCaseDir, "extracted.json"));

      if (!(await extractedFile.exists())) {
        write(`skipped (no extracted.json)\n`);
        continue;
      }

      try {
        const extractedJson = await extractedFile.text();
        const formatResult = await formatRecipe(extractedJson, {
          model: formatModelSpec(formatModel),
        });

        // Save to actual.md
        await Bun.write(join(testCaseDir, "actual.md"), formatResult.markdown);

        // Evaluate
        const result = evaluateOutput(tc.id, formatResult.markdown, tc.expected);
        result.importMetrics = formatResult.metrics;
        results[tc.id] = result;

        const prev = baseline?.results[tc.id];
        const delta = formatDelta(result.score, prev?.score, "%");
        write(`done ${result.score}% ${delta}\n`);

        // Display metrics
        if (formatResult.metrics) {
          const m = formatResult.metrics;
          const durationSec = (m.durationMs / 1000).toFixed(1);
          write(`    Duration: ${durationSec}s | Tokens: ${m.inputTokens.toLocaleString()} in / ${m.outputTokens.toLocaleString()} out\n`);
        }

        if (diff && result.parsed && result.comparison) {
          write(`\n`);
          for (const line of formatDetailed(result.comparison)) {
            write(`    ${line}\n`);
          }
          write("\n");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        write(`error: ${msg}\n`);
        results[tc.id] = {
          id: tc.id,
          parsed: false,
          errorCount: 1,
          warningCount: 0,
          score: 0,
          actual: "",
        };
      }
    }

    // Summary
    const resultList = Object.values(results);
    if (resultList.length === 0) {
      writeErr(`\nNo test cases had extracted.json files.\n`);
      writeErr(`Run with --extract-only first to generate them.\n`);
      return 1;
    }

    const parsedCount = resultList.filter(r => r.parsed).length;
    const parseRate = Math.round((parsedCount / resultList.length) * 100);
    const avgScore = Math.round(
      resultList.filter(r => r.parsed).reduce((sum, r) => sum + r.score, 0) /
      Math.max(parsedCount, 1)
    );

    write("\nSummary:\n");
    const parseRateDelta = formatDelta(parseRate, baseline?.summary.parseRate, "%");
    const scoreDelta = formatDelta(avgScore, baseline?.summary.avgScore, "%");
    write(`  Parse rate:   ${parsedCount}/${resultList.length} (${parseRate}%)   ${parseRateDelta}\n`);
    write(`  Avg score:    ${avgScore}%          ${scoreDelta}\n`);

    // Aggregate metrics
    const resultsWithMetrics = resultList.filter(r => r.importMetrics);
    if (resultsWithMetrics.length > 0) {
      const totalDurationMs = resultsWithMetrics.reduce((sum, r) => sum + (r.importMetrics?.durationMs ?? 0), 0);
      const totalInputTokens = resultsWithMetrics.reduce((sum, r) => sum + (r.importMetrics?.inputTokens ?? 0), 0);
      const totalOutputTokens = resultsWithMetrics.reduce((sum, r) => sum + (r.importMetrics?.outputTokens ?? 0), 0);
      write(`\n  Total time:   ${(totalDurationMs / 1000).toFixed(1)}s\n`);
      write(`  Total tokens: ${totalInputTokens.toLocaleString()} in / ${totalOutputTokens.toLocaleString()} out\n`);
    }

    // Save baseline if requested (save is implied by formatOnly)
    if (save && resultList.length > 0) {
      const metadata: EvalMetadata = {
        importerModel: formatModelSpec(formatModel),
      };

      const totalDurationMs = resultsWithMetrics.reduce((sum, r) => sum + (r.importMetrics?.durationMs ?? 0), 0);
      const totalInputTokens = resultsWithMetrics.reduce((sum, r) => sum + (r.importMetrics?.inputTokens ?? 0), 0);
      const totalOutputTokens = resultsWithMetrics.reduce((sum, r) => sum + (r.importMetrics?.outputTokens ?? 0), 0);

      const newBaseline: Baseline = {
        timestamp: new Date().toISOString(),
        metadata,
        results,
        summary: {
          parseRate,
          avgScore,
          totalDurationMs: resultsWithMetrics.length > 0 ? totalDurationMs : undefined,
          totalInputTokens: resultsWithMetrics.length > 0 ? totalInputTokens : undefined,
          totalOutputTokens: resultsWithMetrics.length > 0 ? totalOutputTokens : undefined,
        },
      };
      await saveBaseline(evalsDir, newBaseline);
      write(`\nSaved baseline to ${evalsDir}/baseline.json\n`);
    }

    return parseRate > 0 ? 0 : 1;
  }

  // ========================================================================
  // Normal eval mode
  // ========================================================================

  // Header line with mode info
  if (regenerate && importModel) {
    write(`[regenerating with ${formatModelSpec(importModel)}]\n`);
  }

  // Find column width for test case names
  const maxIdLen = Math.max(...testCases.map(tc => tc.id.length));

  // Run evaluations and display results in one pass
  const results: Record<string, TestCaseResult> = {};

  for (const tc of testCases) {
    try {
      let actual: string;
      let importMetrics: InferenceMetrics | undefined;

      if (regenerate) {
        const importResult = await runImporter(importModel!, tc.input);
        actual = importResult.markdown;
        importMetrics = importResult.metrics;
        const testCaseDir = join(evalsDir, tc.id);
        await Bun.write(join(testCaseDir, "actual.md"), actual);
        if (importResult.extractedJson) {
          await Bun.write(join(testCaseDir, "extracted.json"), importResult.extractedJson);
        }
      } else {
        actual = tc.actualCached!;
      }

      const result = evaluateOutput(tc.id, actual, tc.expected);
      result.importMetrics = importMetrics;

      results[tc.id] = result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results[tc.id] = {
        id: tc.id,
        parsed: false,
        errorCount: 1,
        warningCount: 0,
        score: 0,
        actual: "",
      };
    }

    // Display result line immediately
    const r = results[tc.id]!;
    const prev = baseline?.results[tc.id];

    const scoreStr = r.parsed ? `${r.score}%`.padStart(4) : "FAIL";

    let line = `  ${tc.id.padEnd(maxIdLen)}  ${scoreStr}`;

    if (prev !== undefined) {
      line += `  ${formatDelta(r.score, prev.score, "%")}`;
    }

    write(line + "\n");

    if (r.importMetrics) {
      const m = r.importMetrics;
      const durationSec = (m.durationMs / 1000).toFixed(1);
      write(`${"".padEnd(maxIdLen + 4)}${durationSec}s | ${m.inputTokens.toLocaleString()} in / ${m.outputTokens.toLocaleString()} out\n`);
    }

    if (diff && r.parsed && r.comparison) {
      write("\n");
      for (const line of formatDetailed(r.comparison)) {
        write(`    ${line}\n`);
      }
      write("\n");
    }
  }

  // Calculate summary
  const resultList = Object.values(results);
  const parsedCount = resultList.filter(r => r.parsed).length;
  const avgScore = Math.round(
    resultList.filter(r => r.parsed).reduce((sum, r) => sum + r.score, 0) /
    Math.max(parsedCount, 1)
  );

  // Calculate aggregate metrics
  const resultsWithMetrics = resultList.filter(r => r.importMetrics);
  const totalDurationMs = resultsWithMetrics.reduce((sum, r) => sum + (r.importMetrics?.durationMs ?? 0), 0);
  const totalInputTokens = resultsWithMetrics.reduce((sum, r) => sum + (r.importMetrics?.inputTokens ?? 0), 0);
  const totalOutputTokens = resultsWithMetrics.reduce((sum, r) => sum + (r.importMetrics?.outputTokens ?? 0), 0);

  // Summary line
  write("\n");
  const failCount = resultList.length - parsedCount;
  let summaryLine = `  avg ${avgScore}%`;
  if (baseline) {
    summaryLine += `  ${formatDelta(avgScore, baseline.summary.avgScore, "%")}`;
  }
  if (failCount > 0) {
    summaryLine += `  (${failCount} parse failed)`;
  }
  write(summaryLine + "\n");

  if (resultsWithMetrics.length > 0) {
    const totalDurationSec = (totalDurationMs / 1000).toFixed(1);
    write(`  ${totalDurationSec}s | ${totalInputTokens.toLocaleString()} in / ${totalOutputTokens.toLocaleString()} out\n`);
  }

  // Save baseline if requested
  const parseRate = Math.round((parsedCount / resultList.length) * 100);
  if (save) {
    const metadata: EvalMetadata = {};
    if (importModel) {
      metadata.importerModel = formatModelSpec(importModel);
    }

    const newBaseline: Baseline = {
      timestamp: new Date().toISOString(),
      metadata,
      results,
      summary: {
        parseRate,
        avgScore,
        totalDurationMs: resultsWithMetrics.length > 0 ? totalDurationMs : undefined,
        totalInputTokens: resultsWithMetrics.length > 0 ? totalInputTokens : undefined,
        totalOutputTokens: resultsWithMetrics.length > 0 ? totalOutputTokens : undefined,
      },
    };
    await saveBaseline(evalsDir, newBaseline);
    write(`\n  Saved to ${evalsDir}/baseline.json\n`);
  }

  return parsedCount > 0 ? 0 : 1;
}
