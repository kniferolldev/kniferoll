/**
 * Eval Command - Run evaluations and compare to baseline
 */

import { join } from "path";
import { parseDocument } from "../core/parser";
import type { IO } from "../types";

/** Result for a single test case */
interface TestCaseResult {
  id: string;
  parsed: boolean;
  errorCount: number;
  warningCount: number;
  similarity: number; // 0-100
  actual: string;
}

/** Baseline data structure */
interface Baseline {
  timestamp: string;
  results: Record<string, TestCaseResult>;
  summary: {
    parseRate: number;
    avgSimilarity: number;
  };
}

/** Parse CLI arguments */
function parseArgs(args: string[]): {
  save: boolean;
  diff: boolean;
  evalsDir: string;
} {
  let save = false;
  let diff = false;
  let evalsDir = "evals";

  for (const arg of args) {
    if (arg === "--save") save = true;
    else if (arg === "--diff") diff = true;
    else if (!arg.startsWith("-")) evalsDir = arg;
  }

  return { save, diff, evalsDir };
}

/** Calculate Levenshtein distance between two strings */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Use two rows instead of full matrix for memory efficiency
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);

  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/** Calculate similarity as percentage (0-100) */
function similarity(a: string, b: string): number {
  if (a === b) return 100;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 100;
  const dist = levenshtein(a, b);
  return Math.round((1 - dist / maxLen) * 100);
}

/** Load test cases from directory */
async function loadTestCases(evalsDir: string): Promise<Array<{
  id: string;
  input: { kind: "text"; text: string } | { kind: "images"; paths: string[] };
  expected: string;
}>> {
  const testCases: Array<{
    id: string;
    input: { kind: "text"; text: string } | { kind: "images"; paths: string[] };
    expected: string;
  }> = [];

  const entries = await Array.fromAsync(
    new Bun.Glob("*/expected.md").scan({ cwd: evalsDir })
  );

  for (const entry of entries) {
    const id = entry.replace("/expected.md", "");
    const testCaseDir = join(evalsDir, id);

    // Load expected.md
    const expectedFile = Bun.file(join(testCaseDir, "expected.md"));
    if (!(await expectedFile.exists())) continue;
    const expected = await expectedFile.text();

    // Determine input type
    const inputTextFile = Bun.file(join(testCaseDir, "input.txt"));
    if (await inputTextFile.exists()) {
      const text = await inputTextFile.text();
      testCases.push({ id, input: { kind: "text", text }, expected });
    } else {
      // Check for images
      const imageFiles = await Array.fromAsync(
        new Bun.Glob("image*.{jpg,jpeg,png,webp}").scan({ cwd: testCaseDir })
      );
      if (imageFiles.length > 0) {
        testCases.push({
          id,
          input: { kind: "images", paths: imageFiles.map(f => join(testCaseDir, f)) },
          expected,
        });
      }
    }
  }

  return testCases.sort((a, b) => a.id.localeCompare(b.id));
}

/** Load baseline from file */
async function loadBaseline(evalsDir: string): Promise<Baseline | null> {
  const file = Bun.file(join(evalsDir, "baseline.json"));
  if (!(await file.exists())) return null;
  try {
    return await file.json();
  } catch {
    return null;
  }
}

/** Save baseline to file */
async function saveBaseline(evalsDir: string, baseline: Baseline): Promise<void> {
  await Bun.write(
    join(evalsDir, "baseline.json"),
    JSON.stringify(baseline, null, 2) + "\n"
  );
}

/** Evaluate a single test case (using expected as actual for now - importer integration comes later) */
function evaluateTestCase(
  id: string,
  actual: string,
  expected: string
): TestCaseResult {
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

/** Format delta string */
function formatDelta(current: number, previous: number | undefined, suffix = ""): string {
  if (previous === undefined) return "(new)";
  const delta = current - previous;
  if (delta === 0) return "(=)";
  const sign = delta > 0 ? "+" : "";
  return `(was ${previous}${suffix}, ${sign}${delta}${suffix})`;
}

/** Main eval runner */
export async function runEval(
  args: string[],
  io: IO
): Promise<number> {
  const encoder = new TextEncoder();
  const write = (s: string) => io.stdout.write(encoder.encode(s));
  const writeErr = (s: string) => io.stderr.write(encoder.encode(s));

  const { save, diff, evalsDir } = parseArgs(args);

  // Load test cases
  const testCases = await loadTestCases(evalsDir);
  if (testCases.length === 0) {
    writeErr(`No test cases found in ${evalsDir}/\n`);
    return 1;
  }

  // Load baseline
  const baseline = await loadBaseline(evalsDir);
  const baselineDate = baseline?.timestamp
    ? new Date(baseline.timestamp).toLocaleDateString()
    : null;

  write(`Running ${testCases.length} test case(s)...`);
  if (baselineDate) {
    write(` (comparing to baseline from ${baselineDate})`);
  }
  write("\n\n");

  // Run evaluations
  // NOTE: For now, we use expected as actual. Real importer integration comes in Phase 3.
  // This lets us test the infrastructure with the existing test case.
  const results: Record<string, TestCaseResult> = {};

  for (const tc of testCases) {
    // TODO: Call actual importer here when provider integration is ready
    // For now, use expected as actual to test the infrastructure
    const actual = tc.expected;
    results[tc.id] = evaluateTestCase(tc.id, actual, tc.expected);
  }

  // Display results
  write("Results:\n");
  for (const tc of testCases) {
    const r = results[tc.id]!;
    const prev = baseline?.results[tc.id];

    const parseIcon = r.parsed ? "✓" : "✗";
    const simStr = r.parsed ? `${r.similarity}% sim` : "-";
    const delta = formatDelta(r.similarity, prev?.similarity, "%");

    write(`  ${tc.id.padEnd(20)} ${parseIcon} parse  ${simStr.padEnd(10)} ${delta}\n`);

    if (diff && r.parsed) {
      // Show diff (simplified - just show first few lines of difference)
      write(`\n    --- expected.md\n    +++ actual.md\n`);
      // For now just indicate if they're identical
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

  // Display summary
  write("\nSummary:\n");
  const parseRateDelta = formatDelta(parseRate, baseline?.summary.parseRate, "%");
  const simDelta = formatDelta(avgSimilarity, baseline?.summary.avgSimilarity, "%");
  write(`  Parse rate:   ${parsedCount}/${resultList.length} (${parseRate}%)   ${parseRateDelta}\n`);
  write(`  Avg similar:  ${avgSimilarity}%          ${simDelta}\n`);

  // Save baseline if requested
  if (save) {
    const newBaseline: Baseline = {
      timestamp: new Date().toISOString(),
      results,
      summary: { parseRate, avgSimilarity },
    };
    await saveBaseline(evalsDir, newBaseline);
    write(`\nSaved baseline to ${evalsDir}/baseline.json\n`);
    write("(remember to commit this file)\n");
  } else if (!baseline) {
    write(`\nNo baseline found. Run \`kr eval --save\` to create one.\n`);
  } else {
    write(`\nRun \`kr eval --save\` to update baseline.\n`);
  }

  // Return success if parse rate is good
  return parseRate >= 80 ? 0 : 1;
}
