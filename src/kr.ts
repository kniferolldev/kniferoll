import { runCheck } from "./commands/check";
import { runEval } from "./commands/eval";
import { runImport } from "./commands/import";
import { runPromote } from "./commands/promote";
import type { IO } from "./types";

const defaultReadFile = async (path: string): Promise<string> => {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Unable to read file: ${path}`);
  }
  return await file.text();
};

export async function runCli(
  argv: string[] = Bun.argv,
  io: IO = {
    stdin: Bun.stdin,
    stdout: Bun.stdout,
    stderr: Bun.stderr,
    readFile: defaultReadFile,
  },
): Promise<number> {
  const args = argv.slice(2);

  if (args.length === 0) {
    io.stderr.write("Usage: kr <command> <input>\n");
    return 2;
  }

  const [command, ...rest] = args;

  switch (command) {
    case "check": {
      if (rest.length !== 1) {
        io.stderr.write("Usage: kr check <path | ->\n");
        return 2;
      }
      return await runCheck(rest[0]!, io);
    }

    case "eval": {
      return await runEval(rest, io);
    }

    case "import": {
      return await runImport(rest, io);
    }

    case "promote": {
      return await runPromote(rest, io);
    }

    default:
      io.stderr.write(`Unknown command: ${command}\n`);
      io.stderr.write("Available commands: check, eval, import, promote\n");
      return 2;
  }
}

if (import.meta.main) {
  runCli().then((code) => process.exit(code));
}
