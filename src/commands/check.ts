import type { IO, StdinLike } from "../types";
import { parseDocument } from "../core";

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
  input: string,
  io: IO,
): Promise<number> {
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
