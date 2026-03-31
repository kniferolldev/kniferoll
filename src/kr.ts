import { runCheck } from "./commands/check";
import { runEval } from "./commands/eval";
import { runImport } from "./commands/import";
import type { IO } from "./types";

const HELP = `Usage: kr <command> [options]

Commands:
  check    Validate a kniferoll markdown file
  import   Convert text or images to kniferoll markdown
  eval     Run import quality evaluations

Options:
  -h, --help       Show help (or kr <command> --help)
  -V, --version    Show version

Run 'kr <command> --help' for command-specific help.
`;

const defaultReadFile = async (path: string): Promise<string> => {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Unable to read file: ${path}`);
  }
  return await file.text();
};

async function getVersion(): Promise<string> {
  const pkg = await Bun.file(new URL("../package.json", import.meta.url)).json();
  return pkg.version;
}

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
    io.stderr.write(HELP);
    return 2;
  }

  const [command, ...rest] = args;

  switch (command) {
    case "--help":
    case "-h":
      io.stdout.write(HELP);
      return 0;

    case "--version":
    case "-V":
      io.stdout.write(`kr ${await getVersion()}\n`);
      return 0;

    case "help": {
      // kr help <command> → kr <command> --help
      const subcommand = rest[0];
      if (!subcommand) {
        io.stdout.write(HELP);
        return 0;
      }
      return runCli(["", "", subcommand, "--help"], io);
    }

    case "check": {
      return await runCheck(rest, io);
    }

    case "eval": {
      return await runEval(rest, io);
    }

    case "import": {
      return await runImport(rest, io);
    }

    default:
      io.stderr.write(`Unknown command: ${command}\n`);
      io.stderr.write("Run 'kr --help' for available commands.\n");
      return 2;
  }
}

if (import.meta.main) {
  runCli().then((code) => process.exit(code));
}
