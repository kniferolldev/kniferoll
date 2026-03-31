/**
 * Import Command - Import recipes from text or images
 *
 * Usage:
 *   kr import <file.txt>           # Text file
 *   kr import <image.jpg> ...      # One or more images
 *   kr import -                    # Read text from stdin
 *   kr import --model openai/gpt-4o image.jpg
 */

import { stat } from "node:fs/promises";
import type { IO } from "../types";
import {
  importRecipe,
  parseModelSpec,
  type InferenceInput,
  type LazyImage,
} from "../import";
import { DEFAULT_IMPORT_MODEL } from "../import/config";

// ============================================================================
// Argument Parsing
// ============================================================================

interface ParsedArgs {
  inputs: string[];
  model: string;
  output: string | null;
  help: boolean;
  quiet: boolean;
}

interface ParseResult {
  args: ParsedArgs;
  error?: string;
}

function parseArgs(args: string[]): ParseResult {
  const inputs: string[] = [];
  let model = DEFAULT_IMPORT_MODEL;
  let output: string | null = null;
  let help = false;
  let quiet = false;
  let error: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;

    if (arg === "--help" || arg === "-h") {
      help = true;
    } else if (arg === "--quiet" || arg === "-q") {
      quiet = true;
    } else if (arg === "--model" || arg === "-m") {
      const value = args[++i];
      if (!value) {
        error = "--model requires a value";
        break;
      }
      const spec = parseModelSpec(value);
      if (!spec) {
        error = `Invalid model format: "${value}"\nExpected format: <provider>/<model> (e.g., openai/gpt-4o)`;
        break;
      }
      model = value;
    } else if (arg === "--output" || arg === "-o") {
      const value = args[++i];
      if (!value) {
        error = "--output requires a value";
        break;
      }
      output = value;
    } else if (!arg.startsWith("-")) {
      inputs.push(arg);
    } else {
      error = `Unknown option: ${arg}`;
      break;
    }
  }

  return { args: { inputs, model, output, help, quiet }, error };
}

const USAGE = `Usage: kr import [options] <input>...

Import recipes from text or images using LLMs.

Arguments:
  <input>...     Input file(s): text files or images
                 Use "-" to read text from stdin

Options:
  -m, --model <provider/model>   Model to use (default: ${DEFAULT_IMPORT_MODEL})
  -o, --output <file>            Write output to file instead of stdout
  -q, --quiet                    Suppress progress output
  -h, --help                     Show this help message

Examples:
  kr import recipe.txt
  kr import photo1.jpg photo2.jpg
  kr import -m anthropic/claude-sonnet-4-5-20250514 recipe.jpg
  echo "1 cup flour..." | kr import -
`;

// ============================================================================
// Input Building
// ============================================================================

async function isImageFile(path: string): Promise<boolean> {
  const ext = path.split(".").pop()?.toLowerCase();
  return ["jpg", "jpeg", "png", "webp"].includes(ext ?? "");
}

async function buildInput(
  inputs: string[],
  io: IO
): Promise<InferenceInput> {
  if (inputs.length === 0) {
    throw new Error("No input files specified");
  }

  // Handle stdin
  if (inputs.length === 1 && inputs[0] === "-") {
    // Read from stdin
    const stdin = io.stdin;
    let text: string;

    if ("text" in stdin && typeof stdin.text === "function") {
      text = await stdin.text();
    } else if (stdin instanceof ReadableStream) {
      const reader = stdin.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
      }
      const decoder = new TextDecoder();
      text = chunks.map((c) => decoder.decode(c, { stream: true })).join("");
    } else {
      throw new Error("Unsupported stdin type");
    }

    return { text };
  }

  // Check if all inputs are images
  const imageChecks = await Promise.all(inputs.map(isImageFile));
  const allImages = imageChecks.every(Boolean);
  const anyImages = imageChecks.some(Boolean);

  if (anyImages && !allImages) {
    throw new Error("Cannot mix image and text files. Provide either all images or a single text file.");
  }

  if (allImages) {
    // Verify files exist
    for (const path of inputs) {
      try {
        await stat(path);
      } catch {
        throw new Error(`File not found: ${path}`);
      }
    }

    const images: LazyImage[] = inputs.map((path) => ({
      kind: "lazy" as const,
      path,
    }));

    return { images };
  }

  // Single text file
  if (inputs.length > 1) {
    throw new Error("Can only process one text file at a time");
  }

  const path = inputs[0]!;
  const text = await io.readFile(path);
  return { text };
}

// ============================================================================
// Main Entry Point
// ============================================================================

export async function runImport(args: string[], io: IO): Promise<number> {
  const write = (s: string) => io.stdout.write(s);
  const writeErr = (s: string) => io.stderr.write(s);

  // Parse arguments
  const parseResult = parseArgs(args);
  if (parseResult.error) {
    writeErr(`Error: ${parseResult.error}\n\n`);
    writeErr(USAGE);
    return 2;
  }

  const { inputs, model, output, help, quiet } = parseResult.args;

  if (help) {
    write(USAGE);
    return 0;
  }

  if (inputs.length === 0) {
    writeErr("Error: No input files specified\n\n");
    writeErr(USAGE);
    return 2;
  }

  try {
    // Build input from files
    const input = await buildInput(inputs, io);

    // Progress callback
    const onProgress = quiet ? undefined : (stage: string, detail?: string) => {
      writeErr(detail ? `${stage} (${detail})...\n` : `${stage}...\n`);
    };

    // Run import
    const start = performance.now();
    const result = await importRecipe(input, { model, onProgress });
    const elapsed = ((performance.now() - start) / 1000).toFixed(1);

    // Write output
    if (output) {
      await Bun.write(output, result.markdown);
      if (!quiet) writeErr(`Wrote ${output} in ${elapsed}s (model: ${result.model})\n`);
    } else {
      write(result.markdown);
      if (!quiet) writeErr(`Done in ${elapsed}s (model: ${result.model})\n`);
    }

    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeErr(`Error: ${message}\n`);
    return 1;
  }
}
