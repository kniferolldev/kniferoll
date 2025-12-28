/**
 * Eval Command - Run evaluations and compare to baseline
 *
 * This runs the importer on test case inputs and compares
 * the generated output to the expected (human-edited) version.
 */

import { join } from "path";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { parseDocument } from "../core/parser";
import type { DocumentParseResult } from "../core/types";
import type { IO } from "../types";
import { compareDocuments, formatDetailed, type ComparisonResult } from "../eval";
import {
  importRecipe,
  extractRecipe,
  formatRecipe,
  parseModelSpec,
  formatModelSpec,
  getApiKey,
  getApiKeyEnvVar,
  DEFAULT_IMPORT_MODEL,
  DEFAULT_FORMAT_MODEL,
  DEFAULT_JUDGE_MODEL,
  type ModelSpec,
  type InferenceInput,
  type LazyImage,
  type InferenceMetrics,
  type ImageProcessingOptions,
  type ExtractionResult,
} from "../import";

// ============================================================================
// Types
// ============================================================================

/** Result for a single test case */
interface TestCaseResult {
  id: string;
  parsed: boolean;
  errorCount: number;
  warningCount: number;
  /** Structured comparison score (0-100) */
  score: number;
  /** Detailed comparison result */
  comparison?: ComparisonResult;
  actual: string;
  judgeScore?: number; // 1-10
  judgeIssues?: string;
  importMetrics?: InferenceMetrics;
}

/** Metadata about the eval run */
interface EvalMetadata {
  /** Model used for import, e.g. "openai/gpt-5.2" */
  importerModel?: string;
  /** Model used for judging, e.g. "anthropic/claude-sonnet-4-5" */
  judgeModel?: string;
}

/** Baseline data structure */
interface Baseline {
  timestamp: string;
  metadata: EvalMetadata;
  results: Record<string, TestCaseResult>;
  summary: {
    parseRate: number;
    avgScore: number;
    avgJudgeScore?: number;
    totalDurationMs?: number;
    totalInputTokens?: number;
    totalOutputTokens?: number;
  };
}

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
  judge: boolean;
  regenerate: boolean;
  extractOnly: boolean;
  formatOnly: boolean;
  model: ModelSpec | null;
  judgeModel: ModelSpec | null;
  evalsDir: string;
  preserveImage: boolean;
  only: string | null;
}

interface ParseResult {
  args: ParsedArgs;
  error?: string;
}

/** Default image preprocessing: resize to 1024px wide, 80% quality (~80KB output) */
const DEFAULT_IMAGE_PREPROCESS: ImageProcessingOptions = {
  maxWidth: 1024,
  quality: 80,
};

function parseArgs(args: string[]): ParseResult {
  let save = false;
  let diff = false;
  let judge = false;
  let regenerate = false;
  let extractOnly = false;
  let formatOnly = false;
  let model: ModelSpec | null = null;
  let judgeModel: ModelSpec | null = null;
  let evalsDir = "evals";
  let preserveImage = false;
  let only: string | null = null;
  let error: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "--save") save = true;
    else if (arg === "--diff") diff = true;
    else if (arg === "--judge") judge = true;
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
        error = `Invalid model format: "${spec}"\nExpected format: <provider>/<model> (e.g., openai/gpt-4o, anthropic/claude-sonnet-4-5)`;
      }
    }
    else if (arg === "--judge-model" && args[i + 1]) {
      const spec = args[++i]!;
      judgeModel = parseModelSpec(spec);
      if (!judgeModel) {
        error = `Invalid judge model format: "${spec}"\nExpected format: <provider>/<model> (e.g., openai/gpt-4o, anthropic/claude-sonnet-4-5)`;
      }
    }
    else if (arg === "--preserve-image") {
      preserveImage = true;
    }
    else if (arg === "--only" && args[i + 1]) {
      only = args[++i]!;
    }
    else if (!arg.startsWith("-")) evalsDir = arg;
  }

  return { args: { save, diff, judge, regenerate, extractOnly, formatOnly, model, judgeModel, evalsDir, preserveImage, only }, error };
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
  preprocess?: ImageProcessingOptions | null
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
    preprocess: preprocess ?? undefined,
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
  preprocess?: ImageProcessingOptions | null
): Promise<ExtractionResult> {
  if (input.kind === "text") {
    throw new Error("Extraction requires images, not text input");
  }

  // Convert file paths to LazyImage format
  const images: LazyImage[] = input.paths.map((path) => ({
    kind: "lazy" as const,
    path,
  }));

  return extractRecipe({ images }, {
    model: formatModelSpec(model),
    preprocess: preprocess ?? undefined,
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
// Judge Functions
// ============================================================================

const JUDGE_PROMPT = `You are evaluating a recipe import. Compare the actual output to the expected (human-edited) version.

Rate the quality from 1-10:
- 10: Identical or trivially different (whitespace, minor formatting)
- 7-9: Good, minor issues (missing optional fields, slight rewording)
- 4-6: Usable but needs editing (wrong quantities, missing ingredients)
- 1-3: Significant problems (missing sections, wrong recipe)

Expected:
<expected>
{expected}
</expected>

Actual:
<actual>
{actual}
</actual>

Respond with JSON only, no other text:
{"score": <1-10>, "issues": "<brief list of what needs fixing, or 'none'>"}`;

interface JudgeResult {
  score: number;
  issues: string;
}

async function judgeWithAnthropic(expected: string, actual: string, model: string): Promise<JudgeResult> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY not set");

  const client = new Anthropic({ apiKey });
  const prompt = JUDGE_PROMPT.replace("{expected}", expected).replace("{actual}", actual);

  const response = await client.messages.create({
    model,
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  const first = response.content[0];
  const text = first?.type === "text" ? first.text : "";
  return parseJudgeResponse(text);
}

async function judgeWithOpenAI(expected: string, actual: string, model: string): Promise<JudgeResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const client = new OpenAI({ apiKey });
  const prompt = JUDGE_PROMPT.replace("{expected}", expected).replace("{actual}", actual);

  const response = await client.chat.completions.create({
    model,
    max_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.choices[0]?.message?.content ?? "";
  return parseJudgeResponse(text);
}

async function judgeWithGoogle(expected: string, actual: string, model: string): Promise<JudgeResult> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY not set");

  const genAI = new GoogleGenerativeAI(apiKey);
  const geminiModel = genAI.getGenerativeModel({ model });
  const prompt = JUDGE_PROMPT.replace("{expected}", expected).replace("{actual}", actual);

  const result = await geminiModel.generateContent(prompt);
  const text = result.response.text();
  return parseJudgeResponse(text);
}

function parseJudgeResponse(text: string): JudgeResult {
  try {
    // Try to find JSON in the response
    const jsonMatch = text.match(/\{[\s\S]*?\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        score: Math.max(1, Math.min(10, Number(parsed.score) || 5)),
        issues: String(parsed.issues || "unknown"),
      };
    }

    // Fallback: try to extract score from text like "Score: 7" or "7/10"
    const scoreMatch = text.match(/(?:score[:\s]*)?(\d+)(?:\/10)?/i);
    if (scoreMatch) {
      const score = Math.max(1, Math.min(10, Number(scoreMatch[1])));
      // Try to extract issues after the score
      const issuesMatch = text.match(/issues?[:\s]*["']?([^"'\n]+)/i);
      return {
        score,
        issues: issuesMatch?.[1]?.trim() || "extracted from non-JSON response",
      };
    }

    throw new Error("No score found");
  } catch (err) {
    const preview = text.slice(0, 100).replace(/\n/g, " ");
    return { score: 5, issues: `parse error: ${preview}...` };
  }
}

async function runJudge(
  spec: ModelSpec,
  expected: string,
  actual: string
): Promise<JudgeResult> {
  switch (spec.provider) {
    case "anthropic":
      return judgeWithAnthropic(expected, actual, spec.model);
    case "google":
      return judgeWithGoogle(expected, actual, spec.model);
    case "openai":
      return judgeWithOpenAI(expected, actual, spec.model);
    default:
      throw new Error(`Unsupported judge provider: ${spec.provider}`);
  }
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
    new Bun.Glob("*/golden.md").scan({ cwd: evalsDir })
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

  const { save, diff, judge, regenerate, extractOnly, formatOnly, model, judgeModel, evalsDir, preserveImage, only } = parseResult.args;

  // Apply default preprocessing unless --preserve-image is set
  const preprocess = preserveImage ? null : DEFAULT_IMAGE_PREPROCESS;

  // Resolve models: use defaults when not specified
  const importModel = regenerate
    ? (model ?? parseModelSpec(DEFAULT_IMPORT_MODEL)!)
    : null;
  const resolvedJudgeModel = judge
    ? (judgeModel ?? model ?? parseModelSpec(DEFAULT_JUDGE_MODEL)!)
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

  if (resolvedJudgeModel) {
    const apiKey = getApiKey(resolvedJudgeModel.provider);
    if (!apiKey) {
      const envVar = getApiKeyEnvVar(resolvedJudgeModel.provider);
      writeErr(`Error: ${envVar} environment variable is not set (for judging).\n`);
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
    // Filter to only image-based test cases
    const imageTestCases = testCases.filter(tc => tc.input.kind === "images");
    if (imageTestCases.length === 0) {
      writeErr(`No image-based test cases found for extraction.\n`);
      return 1;
    }

    write(`Extracting text from ${imageTestCases.length} image test case(s)...`);
    write(` [model: ${formatModelSpec(importModel!)}]`);
    if (preserveImage) {
      write(` [preserve-image]`);
    }
    write("\n\n");

    const extractResults: ExtractionTestResult[] = [];

    for (const tc of imageTestCases) {
      write(`  ${tc.id}... `);

      try {
        const result = await runExtractor(importModel!, tc.input, preprocess);
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
  write(`Running ${testCases.length} test case(s)...`);
  if (regenerate && importModel) {
    write(` [regenerating with ${formatModelSpec(importModel)}]`);
  }
  if (preserveImage) {
    write(` [preserve-image]`);
  }
  if (baselineDate) {
    write(` (comparing to baseline from ${baselineDate})`);
  }
  if (judge && resolvedJudgeModel) {
    write(` [judging with ${formatModelSpec(resolvedJudgeModel)}]`);
  }
  write("\n\n");

  // Run evaluations
  const results: Record<string, TestCaseResult> = {};

  for (const tc of testCases) {
    write(`  ${tc.id}... `);

    try {
      let actual: string;
      let importMetrics: InferenceMetrics | undefined;

      if (regenerate) {
        // Re-run the importer and save to actual.md
        const importResult = await runImporter(importModel!, tc.input, preprocess);
        actual = importResult.markdown;
        importMetrics = importResult.metrics;
        const testCaseDir = join(evalsDir, tc.id);
        await Bun.write(join(testCaseDir, "actual.md"), actual);
        // Save extracted.json if two-stage pipeline was used
        if (importResult.extractedJson) {
          await Bun.write(join(testCaseDir, "extracted.json"), importResult.extractedJson);
        }
        write(`regenerated... `);
      } else {
        // Use cached actual.md
        actual = tc.actualCached!;
      }

      const result = evaluateOutput(tc.id, actual, tc.expected);
      result.importMetrics = importMetrics;

      // Run judge if requested
      if (judge && result.parsed && resolvedJudgeModel) {
        try {
          const judgeResult = await runJudge(resolvedJudgeModel, tc.expected, actual);
          result.judgeScore = judgeResult.score;
          result.judgeIssues = judgeResult.issues;
        } catch (err) {
          result.judgeIssues = `judge error: ${err instanceof Error ? err.message : err}`;
        }
      }

      results[tc.id] = result;
      write(`done\n`);
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
        judgeIssues: `import error: ${msg}`,
      };
    }
  }

  // Display results
  write("\nResults:\n");
  for (const tc of testCases) {
    const r = results[tc.id]!;
    const prev = baseline?.results[tc.id];

    const parseIcon = r.parsed ? "✓" : "✗";
    const scoreStr = r.parsed ? `${r.score}%` : "-";
    const delta = formatDelta(r.score, prev?.score, "%");

    let line = `  ${tc.id.padEnd(20)} ${parseIcon} parse  ${scoreStr.padEnd(10)}`;

    if (judge) {
      if (r.judgeScore !== undefined) {
        line += `  ${r.judgeScore}/10`;
      } else {
        line += `  -/10`;
      }
    }

    line += `  ${delta}`;

    if (judge && r.judgeIssues && r.judgeIssues !== "none" && r.judgeIssues.length < 40) {
      line += `  (${r.judgeIssues})`;
    }

    write(line + "\n");

    // Display metrics if available
    if (r.importMetrics) {
      const m = r.importMetrics;
      const durationSec = (m.durationMs / 1000).toFixed(1);
      write(`    Duration: ${durationSec}s | Tokens: ${m.inputTokens.toLocaleString()} in / ${m.outputTokens.toLocaleString()} out\n`);
    }

    if (judge && r.judgeIssues && r.judgeIssues !== "none" && r.judgeIssues.length >= 40) {
      write(`    Issues: ${r.judgeIssues}\n`);
    }

    if (diff && r.parsed && r.comparison) {
      write(`\n`);
      for (const line of formatDetailed(r.comparison)) {
        write(`    ${line}\n`);
      }
      write("\n");
    }
  }

  // Calculate summary
  const resultList = Object.values(results);
  const parsedCount = resultList.filter(r => r.parsed).length;
  const parseRate = Math.round((parsedCount / resultList.length) * 100);
  const avgScore = Math.round(
    resultList.filter(r => r.parsed).reduce((sum, r) => sum + r.score, 0) /
    Math.max(parsedCount, 1)
  );

  let avgJudgeScore: number | undefined;
  if (judge) {
    const judgedResults = resultList.filter(r => r.judgeScore !== undefined);
    if (judgedResults.length > 0) {
      avgJudgeScore = Math.round(
        judgedResults.reduce((sum, r) => sum + (r.judgeScore ?? 0), 0) /
        judgedResults.length * 10
      ) / 10;
    }
  }

  // Calculate aggregate metrics
  const resultsWithMetrics = resultList.filter(r => r.importMetrics);
  const totalDurationMs = resultsWithMetrics.reduce((sum, r) => sum + (r.importMetrics?.durationMs ?? 0), 0);
  const totalInputTokens = resultsWithMetrics.reduce((sum, r) => sum + (r.importMetrics?.inputTokens ?? 0), 0);
  const totalOutputTokens = resultsWithMetrics.reduce((sum, r) => sum + (r.importMetrics?.outputTokens ?? 0), 0);

  // Display summary
  write("\nSummary:\n");
  const parseRateDelta = formatDelta(parseRate, baseline?.summary.parseRate, "%");
  const scoreDelta = formatDelta(avgScore, baseline?.summary.avgScore, "%");
  write(`  Parse rate:   ${parsedCount}/${resultList.length} (${parseRate}%)   ${parseRateDelta}\n`);
  write(`  Avg score:    ${avgScore}%          ${scoreDelta}\n`);

  if (judge && avgJudgeScore !== undefined) {
    const judgeDelta = baseline?.summary.avgJudgeScore !== undefined
      ? formatDelta(avgJudgeScore, baseline.summary.avgJudgeScore, "")
      : "(new)";
    write(`  Avg quality:  ${avgJudgeScore}/10       ${judgeDelta}\n`);
  }

  // Display aggregate metrics if any were collected
  if (resultsWithMetrics.length > 0) {
    const totalDurationSec = (totalDurationMs / 1000).toFixed(1);
    write(`\n  Total time:   ${totalDurationSec}s\n`);
    write(`  Total tokens: ${totalInputTokens.toLocaleString()} in / ${totalOutputTokens.toLocaleString()} out\n`);
  }

  // Save baseline if requested
  if (save) {
    const metadata: EvalMetadata = {};
    if (importModel) {
      metadata.importerModel = formatModelSpec(importModel);
    }
    if (resolvedJudgeModel) {
      metadata.judgeModel = formatModelSpec(resolvedJudgeModel);
    }

    const newBaseline: Baseline = {
      timestamp: new Date().toISOString(),
      metadata,
      results,
      summary: {
        parseRate,
        avgScore,
        avgJudgeScore,
        totalDurationMs: resultsWithMetrics.length > 0 ? totalDurationMs : undefined,
        totalInputTokens: resultsWithMetrics.length > 0 ? totalInputTokens : undefined,
        totalOutputTokens: resultsWithMetrics.length > 0 ? totalOutputTokens : undefined,
      },
    };
    await saveBaseline(evalsDir, newBaseline);
    write(`\nSaved baseline to ${evalsDir}/baseline.json\n`);
    write("(remember to commit this file)\n");
  } else if (!baseline) {
    write(`\nNo baseline found. Run \`kr eval --save\` to create one.\n`);
  } else {
    write(`\nRun \`kr eval --save\` to update baseline.\n`);
  }

  return parseRate > 0 ? 0 : 1;
}
