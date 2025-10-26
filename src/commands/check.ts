import type { IO, StdinLike } from "../types";
import { parseDocument } from "../checker/parser";

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

    const parseResult = parseDocument(content);
    void parseResult;
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown read error";
    io.stderr.write(`${message}\n`);
    return 2;
  }

  return 0;
}
