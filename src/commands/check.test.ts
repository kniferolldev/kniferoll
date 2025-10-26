import { expect, test } from "bun:test";
import { runCheck } from "./check";
import type { IO } from "../types";

const writer = () => {
  let buffer = "";
  return {
    channel: {
      write(text: string) {
        buffer += text;
      },
    },
    read() {
      return buffer;
    },
  };
};

const stubIO = (content: string) => {
  const stdout = writer();
  const stderr = writer();
  const io: IO = {
    stdin: {
      async text() {
        return content;
      },
    },
    stdout: stdout.channel,
    stderr: stderr.channel,
    readFile: async () => content,
  };
  return {
    io,
    stdout,
    stderr,
  };
};

test("runCheck outputs diagnostics and exits 1 on errors", async () => {
  const fileContent = [
    "# Soup",
    "## Ingredients",
    "- salt",
  ].join("\n");

  const { io, stdout } = stubIO(fileContent);
  const exitCode = await runCheck("recipe.md", io);

  expect(exitCode).toBe(1);
  const lines = stdout.read().trim().split("\n");
  expect(lines[0]).toContain("recipe.md:1:1");
  expect(lines[0]).toContain("E0101");
});

test("runCheck exits 0 when no errors are found", async () => {
  const fileContent = [
    "# Salad",
    "## Ingredients",
    "- lettuce",
    "## Steps",
    "1. Toss.",
  ].join("\n");

  const { io, stdout } = stubIO(fileContent);
  const exitCode = await runCheck("recipe.md", io);

  expect(exitCode).toBe(0);
  expect(stdout.read()).toBe("");
});

test("runCheck reads stdin from ReadableStream", async () => {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode("# Salad\n## Ingredients\n- lettuce\n## Steps\n1. Toss.\n"));
      controller.close();
    },
  });

  const stdout = writer();
  const stderr = writer();
  const exitCode = await runCheck("-", {
    stdin: stream,
    stdout: stdout.channel,
    stderr: stderr.channel,
    readFile: async () => {
      throw new Error("Should not read file when stdin is used");
    },
  });

  expect(exitCode).toBe(0);
  expect(stdout.read()).toBe("");
  expect(stderr.read()).toBe("");
});

test("runCheck returns 2 when readFile fails", async () => {
  const stdout = writer();
  const stderr = writer();
  const exitCode = await runCheck("missing.md", {
    stdin: {
      async text() {
        throw new Error("stdin should not be used");
      },
    },
    stdout: stdout.channel,
    stderr: stderr.channel,
    readFile: async () => {
      throw new Error("Unable to read file");
    },
  });

  expect(exitCode).toBe(2);
  expect(stderr.read()).toContain("Unable to read file");
});

test("runCheck errors on unsupported stdin type", async () => {
  const stdout = writer();
  const stderr = writer();
  const exitCode = await runCheck("-", {
    stdin: {},
    stdout: stdout.channel,
    stderr: stderr.channel,
    readFile: async () => {
      throw new Error("readFile should not be used");
    },
  });

  expect(exitCode).toBe(2);
  expect(stderr.read().trim()).toBe("Unsupported stdin type");
});
