/**
 * Eval Command - Run evaluations and compare to baseline
 *
 * This runs the importer on test case inputs and compares
 * the generated output to the expected (human-edited) version.
 */

import { join } from "path";
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { parseDocument } from "../core/parser";
import type { IO } from "../types";
import {
  importRecipe,
  parseModelSpec,
  formatModelSpec,
  getApiKey,
  getApiKeyEnvVar,
  type ModelSpec,
  type InferenceInput,
  type LazyImage,
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
  similarity: number; // 0-100
  actual: string;
  judgeScore?: number; // 1-10
  judgeIssues?: string;
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
    avgSimilarity: number;
    avgJudgeScore?: number;
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
  model: ModelSpec | null;
  evalsDir: string;
}

interface ParseResult {
  args: ParsedArgs;
  error?: string;
}

function parseArgs(args: string[]): ParseResult {
  let save = false;
  let diff = false;
  let judge = false;
  let regenerate = false;
  let model: ModelSpec | null = null;
  let evalsDir = "evals";
  let error: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--save") save = true;
    else if (arg === "--diff") diff = true;
    else if (arg === "--judge") judge = true;
    else if (arg === "--regenerate") regenerate = true;
    else if (arg === "--model" && args[i + 1]) {
      const spec = args[++i]!;
      model = parseModelSpec(spec);
      if (!model) {
        error = `Invalid model format: "${spec}"\nExpected format: <provider>/<model> (e.g., openai/gpt-4o, anthropic/claude-sonnet-4-5)`;
      }
    }
    else if (!arg.startsWith("-")) evalsDir = arg;
  }

  return { args: { save, diff, judge, regenerate, model, evalsDir }, error };
}

// ============================================================================
// String Utilities
// ============================================================================

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

function similarity(a: string, b: string): number {
  if (a === b) return 100;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;
  return Math.round((1 - levenshtein(a, b) / maxLen) * 100);
}

// ============================================================================
// Import Wrapper
// ============================================================================

/**
 * Convert test case input to InferenceInput format and run import
 */
async function runImporter(
  model: ModelSpec,
  input: TestCase["input"]
): Promise<string> {
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

  return result.markdown;
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

  const text = response.content[0].type === "text" ? response.content[0].text : "";
  return parseJudgeResponse(text);
}

async function judgeWithOpenAI(expected: string, actual: string, model: string): Promise<JudgeResult> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not set");

  const client = new OpenAI({ apiKey });
  const prompt = JUDGE_PROMPT.replace("{expected}", expected).replace("{actual}", actual);

  const response = await client.chat.completions.create({
    model,
    max_completion_tokens: 256,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.choices[0]?.message?.content ?? "";
  return parseJudgeResponse(text);
}

function parseJudgeResponse(text: string): JudgeResult {
  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found");
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      score: Math.max(1, Math.min(10, Number(parsed.score) || 5)),
      issues: String(parsed.issues || "unknown"),
    };
  } catch {
    return { score: 5, issues: "failed to parse judge response" };
  }
}

async function runJudge(
  spec: ModelSpec,
  expected: string,
  actual: string
): Promise<JudgeResult> {
  if (spec.provider === "anthropic") {
    return judgeWithAnthropic(expected, actual, spec.model);
  } else {
    return judgeWithOpenAI(expected, actual, spec.model);
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
    new Bun.Glob("*/expected.md").scan({ cwd: evalsDir })
  );

  for (const entry of entries) {
    const id = entry.replace("/expected.md", "");
    const testCaseDir = join(evalsDir, id);

    const expectedFile = Bun.file(join(testCaseDir, "expected.md"));
    if (!(await expectedFile.exists())) continue;
    const expected = await expectedFile.text();

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
  const parseResult = parseDocument(actual);
  const errors = parseResult.diagnostics.filter(d => d.severity === "error");
  const warnings = parseResult.diagnostics.filter(d => d.severity === "warning");

  return {
    id,
    parsed: errors.length === 0,
    errorCount: errors.length,
    warningCount: warnings.length,
    similarity: similarity(actual, expected),
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
  const encoder = new TextEncoder();
  const write = (s: string) => io.stdout.write(encoder.encode(s));
  const writeErr = (s: string) => io.stderr.write(encoder.encode(s));

  const parseResult = parseArgs(args);
  if (parseResult.error) {
    writeErr(`Error: ${parseResult.error}\n`);
    return 2;
  }

  const { save, diff, judge, regenerate, model, evalsDir } = parseResult.args;

  // Require --model when using LLM features
  const needsModel = regenerate || judge;
  if (needsModel && !model) {
    writeErr("Error: --model is required when using --regenerate or --judge\n\n");
    writeErr("Usage: kr eval --regenerate --model <provider/model>\n");
    writeErr("       kr eval --judge --model <provider/model>\n\n");
    writeErr("Examples:\n");
    writeErr("  kr eval --regenerate --model openai/gpt-4o\n");
    writeErr("  kr eval --regenerate --model anthropic/claude-sonnet-4-5-20250514\n");
    return 2;
  }

  // Check API key early if we need a model
  if (needsModel && model) {
    const apiKey = getApiKey(model.provider);
    if (!apiKey) {
      const envVar = getApiKeyEnvVar(model.provider);
      writeErr(`Error: ${envVar} environment variable is not set.\n`);
      writeErr(`Set it with: export ${envVar}=your-key-here\n`);
      return 1;
    }
  }

  // Load test cases
  const testCases = await loadTestCases(evalsDir);
  if (testCases.length === 0) {
    writeErr(`No test cases found in ${evalsDir}/\n`);
    return 1;
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

  write(`Running ${testCases.length} test case(s)...`);
  if (regenerate && model) {
    write(` [regenerating with ${formatModelSpec(model)}]`);
  }
  if (baselineDate) {
    write(` (comparing to baseline from ${baselineDate})`);
  }
  if (judge) {
    write(` [+judge]`);
  }
  write("\n\n");

  // Run evaluations
  const results: Record<string, TestCaseResult> = {};

  for (const tc of testCases) {
    write(`  ${tc.id}... `);

    try {
      let actual: string;

      if (regenerate) {
        // Re-run the importer and save to actual.md
        actual = await runImporter(model!, tc.input);
        const testCaseDir = join(evalsDir, tc.id);
        await Bun.write(join(testCaseDir, "actual.md"), actual);
        write(`regenerated... `);
      } else {
        // Use cached actual.md
        actual = tc.actualCached!;
      }

      const result = evaluateOutput(tc.id, actual, tc.expected);

      // Run judge if requested
      if (judge && result.parsed) {
        try {
          const judgeResult = await runJudge(model!, tc.expected, actual);
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
        similarity: 0,
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
    const simStr = r.parsed ? `${r.similarity}% sim` : "-";
    const delta = formatDelta(r.similarity, prev?.similarity, "%");

    let line = `  ${tc.id.padEnd(20)} ${parseIcon} parse  ${simStr.padEnd(10)}`;

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

    if (judge && r.judgeIssues && r.judgeIssues !== "none" && r.judgeIssues.length >= 40) {
      write(`    Issues: ${r.judgeIssues}\n`);
    }

    if (diff && r.parsed) {
      write(`\n    --- expected.md\n    +++ actual.md\n`);
      if (r.similarity === 100) {
        write(`    (identical)\n`);
      } else {
        write(`    (${100 - r.similarity}% different)\n`);
      }
      write("\n");
    }
  }

  // Calculate summary
  const resultList = Object.values(results);
  const parsedCount = resultList.filter(r => r.parsed).length;
  const parseRate = Math.round((parsedCount / resultList.length) * 100);
  const avgSimilarity = Math.round(
    resultList.filter(r => r.parsed).reduce((sum, r) => sum + r.similarity, 0) /
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

  // Display summary
  write("\nSummary:\n");
  const parseRateDelta = formatDelta(parseRate, baseline?.summary.parseRate, "%");
  const simDelta = formatDelta(avgSimilarity, baseline?.summary.avgSimilarity, "%");
  write(`  Parse rate:   ${parsedCount}/${resultList.length} (${parseRate}%)   ${parseRateDelta}\n`);
  write(`  Avg similar:  ${avgSimilarity}%          ${simDelta}\n`);

  if (judge && avgJudgeScore !== undefined) {
    const judgeDelta = baseline?.summary.avgJudgeScore !== undefined
      ? formatDelta(avgJudgeScore, baseline.summary.avgJudgeScore, "")
      : "(new)";
    write(`  Avg quality:  ${avgJudgeScore}/10       ${judgeDelta}\n`);
  }

  // Save baseline if requested
  if (save) {
    const metadata: EvalMetadata = {};
    if (model) {
      metadata.importerModel = formatModelSpec(model);
      if (judge) {
        metadata.judgeModel = formatModelSpec(model);
      }
    }

    const newBaseline: Baseline = {
      timestamp: new Date().toISOString(),
      metadata,
      results,
      summary: { parseRate, avgSimilarity, avgJudgeScore },
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
