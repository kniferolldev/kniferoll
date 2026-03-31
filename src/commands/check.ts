import type { IO, StdinLike } from "../types";
import { parseDocument } from "../core";

const USAGE = `Usage: kr check <path | ->

Validate a kniferoll markdown file and report diagnostics.

Arguments:
  <path>    Path to a kniferoll markdown file
  -         Read from stdin

Options:
  -h, --help    Show this help message

Output:
  Diagnostics in compiler-style format: <file>:<line>:<col>  <severity>  <code>  <message>

Examples:
  kr check recipe.md
  cat recipe.md | kr check -
`;

const readStdin = async (stdin: StdinLike): Promise<string> => {
  if (typeof (stdin as { text?: unknown }).text === "function") {
    return await (stdin as { text: () => Promise<string> }).text();
  }

  if (stdin instanceof ReadableStream) {
    const response = new Response(stdin);
    return await response.text();
  }

  throw new Error("Unsupported stdin type");
};

export async function runCheck(
  input: string | string[],
  io: IO,
): Promise<number> {
  // Handle array form (from kr.ts dispatcher)
  if (Array.isArray(input)) {
    if (input.includes("--help") || input.includes("-h") || input.length === 0) {
      io.stdout.write(USAGE);
      return 0;
    }
    if (input.length !== 1) {
      io.stderr.write("Error: expected exactly one argument\n\n");
      io.stderr.write(USAGE);
      return 2;
    }
    input = input[0]!;
  }

  try {
    const content =
      input === "-" ? await readStdin(io.stdin) : await io.readFile(input);

    const result = parseDocument(content);
    const pathLabel = input === "-" ? "<stdin>" : input;
    let hasError = false;

    for (const diagnostic of result.diagnostics) {
      if (diagnostic.severity === "error") {
        hasError = true;
      }

      const line = diagnostic.line ?? 1;
      const column = diagnostic.column ?? 1;
      io.stdout.write(
        `${pathLabel}:${line}:${column}  ${diagnostic.severity}  ${diagnostic.code}  ${diagnostic.message}\n`,
      );
    }

    return hasError ? 1 : 0;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown read error";
    io.stderr.write(`${message}\n`);
    return 2;
  }
}
