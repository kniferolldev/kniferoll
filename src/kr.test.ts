import { expect, test } from "bun:test";
import { runCli } from "./kr";

const stdinFrom = (value: string) => ({
  async text() {
    return value;
  },
});

const writer = () => {
  let text = "";
  return {
    channel: {
      write(chunk: string) {
        text += chunk;
      },
    },
    read() {
      return text;
    },
  };
};

// Helper to create common test setup
const createTestIO = () => {
  const out = writer();
  const err = writer();
  return { out, err };
};

// Helper for running CLI with configurable stdin
const runCliWithArgs = async (
  args: string[],
  stdinInput = "",
  fileReader?: (path: string) => Promise<string>,
) => {
  const { out, err } = createTestIO();
  const code = await runCli(args, {
    stdin: stdinFrom(stdinInput),
    stdout: out.channel,
    stderr: err.channel,
    readFile: fileReader || (async (path: string) => {
      throw new Error(`Test file reader not provided for path: ${path}`);
    }),
  });
  return { code, out, err };
};

test("missing command fails", async () => {
  const { code, err } = await runCliWithArgs(["bun", "src/kr.ts"]);

  expect(code).toBe(2);
  expect(err.read()).toBeTruthy(); // Should write something to stderr
});

test("unknown command fails", async () => {
  const { code, err } = await runCliWithArgs(["bun", "src/kr.ts", "banana"]);

  expect(code).toBe(2);
  expect(err.read()).toBeTruthy(); // Should write something to stderr
});

test("check '-' reads stdin", async () => {
  const { out, err } = createTestIO();
  let tapped = false;

  const code = await runCli(["bun", "src/kr.ts", "check", "-"], {
    stdin: {
      async text() {
        tapped = true;
        return "recipe";
      },
    },
    stdout: out.channel,
    stderr: err.channel,
    readFile: async (path: string) => {
      throw new Error(`Should not read file when using stdin: ${path}`);
    },
  });

  expect(code).toBe(0);
  expect(tapped).toBe(true);
});

test("check path uses provided reader", async () => {
  let seen = "";
  const { code } = await runCliWithArgs(
    ["bun", "src/kr.ts", "check", "recipes/sample.md"],
    "",
    async (path) => {
      seen = path;
      return "recipe";
    }
  );

  expect(code).toBe(0);
  expect(seen).toBe("recipes/sample.md");
});

const defaultStyleReadFile = async (path: string): Promise<string> => {
  const file = Bun.file(path);
  if (!(await file.exists())) {
    throw new Error(`Unable to read file: ${path}`);
  }
  return await file.text();
};

test("default readFile reads existing recipe files", async () => {
  const { code, err } = await runCliWithArgs(
    ["bun", "src/kr.ts", "check", "recipes/granola.md"],
    "",
    defaultStyleReadFile,
  );

  expect(code).toBe(0);
  expect(err.read()).toBe("");
});

test("default readFile reports missing files", async () => {
  const { code, err } = await runCliWithArgs(
    ["bun", "src/kr.ts", "check", "recipes/does-not-exist.md"],
    "",
    defaultStyleReadFile,
  );

  expect(code).toBe(2);
  expect(err.read()).toContain("Unable to read file: recipes/does-not-exist.md");
});
