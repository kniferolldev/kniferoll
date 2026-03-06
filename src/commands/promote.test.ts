import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import { runPromote } from "./promote";
import type { IO } from "../types";
import { mkdir, mkdtemp, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";

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

const stubIO = () => {
  const stdout = writer();
  const stderr = writer();
  const io: IO = {
    stdin: {
      async text() {
        return "";
      },
    },
    stdout: stdout.channel,
    stderr: stderr.channel,
    readFile: async () => "",
  };
  return { io, stdout, stderr };
};

// Run promote tests in a temp directory so file writes don't trigger
// Vite's file watcher and cause dev server reloads.
let tempDir: string;
let originalCwd: string;

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "kniferoll-promote-test-"));
  originalCwd = process.cwd();
  process.chdir(tempDir);
});

afterEach(async () => {
  process.chdir(originalCwd);
  await rm(tempDir, { recursive: true, force: true });
});

describe("runPromote", () => {
  describe("argument validation", () => {
    test("returns 2 when source path is missing", async () => {
      const { io, stderr } = stubIO();
      const exitCode = await runPromote([], io);

      expect(exitCode).toBe(2);
      expect(stderr.read()).toContain("Usage: kr promote");
    });

    test("returns 2 when --name is missing", async () => {
      const { io, stderr } = stubIO();
      const exitCode = await runPromote(["imports/test-dir"], io);

      expect(exitCode).toBe(2);
      expect(stderr.read()).toContain("--name is required");
    });

    test("parses --name flag correctly", async () => {
      const { io, stderr } = stubIO();
      // Will fail on source check, but should get past arg parsing
      const exitCode = await runPromote(
        ["imports/nonexistent", "--name", "test-name"],
        io
      );

      expect(exitCode).toBe(1); // Should fail on source check, not arg parsing
      expect(stderr.read()).toContain("output.md not found");
    });

    test("handles --name at different positions", async () => {
      const { io, stderr } = stubIO();
      const exitCode = await runPromote(
        ["--name", "test-name", "imports/nonexistent"],
        io
      );

      expect(exitCode).toBe(1);
      expect(stderr.read()).toContain("output.md not found");
    });
  });

  describe("source validation", () => {
    test("returns 1 when source directory does not contain output.md", async () => {
      const { io, stderr } = stubIO();
      const exitCode = await runPromote(
        ["imports/does-not-exist", "--name", "test"],
        io
      );

      expect(exitCode).toBe(1);
      expect(stderr.read()).toContain("output.md not found");
    });
  });

  describe("successful promotion", () => {
    const testImportDir = "test-imports-temp";
    const testEvalDir = "evals/test-promote-temp";

    beforeEach(async () => {
      // Create test import directory with output.md (inside temp dir)
      await mkdir(testImportDir, { recursive: true });
      await writeFile(
        join(testImportDir, "output.md"),
        "# Test Recipe\n\n## Ingredients\n\n- salt\n\n## Steps\n\n1. Add salt."
      );
    });

    test("creates eval directory with golden.md and actual.md", async () => {
      const { io, stdout } = stubIO();
      const exitCode = await runPromote(
        [testImportDir, "--name", "test-promote-temp"],
        io
      );

      expect(exitCode).toBe(0);
      expect(stdout.read()).toContain("Created evals/test-promote-temp/");

      // Verify files were created
      const goldenFile = Bun.file(join(testEvalDir, "golden.md"));
      const actualFile = Bun.file(join(testEvalDir, "actual.md"));

      expect(await goldenFile.exists()).toBe(true);
      expect(await actualFile.exists()).toBe(true);

      // Verify content
      const content = await goldenFile.text();
      expect(content).toContain("# Test Recipe");
    });

    test("copies input.txt when present", async () => {
      // Add input.txt to test import
      await writeFile(join(testImportDir, "input.txt"), "Original recipe text");

      const { io } = stubIO();
      const exitCode = await runPromote(
        [testImportDir, "--name", "test-promote-temp"],
        io
      );

      expect(exitCode).toBe(0);

      const inputFile = Bun.file(join(testEvalDir, "input.txt"));
      expect(await inputFile.exists()).toBe(true);
      expect(await inputFile.text()).toBe("Original recipe text");
    });

    test("returns 1 when eval already exists", async () => {
      // First promote
      const { io: io1 } = stubIO();
      await runPromote([testImportDir, "--name", "test-promote-temp"], io1);

      // Second promote to same name
      const { io: io2, stderr } = stubIO();
      const exitCode = await runPromote(
        [testImportDir, "--name", "test-promote-temp"],
        io2
      );

      expect(exitCode).toBe(1);
      expect(stderr.read()).toContain("already exists");
    });

    test("slugifies the name", async () => {
      const { io, stdout } = stubIO();
      const exitCode = await runPromote(
        [testImportDir, "--name", "Test Recipe Name"],
        io
      );

      expect(exitCode).toBe(0);
      expect(stdout.read()).toContain("evals/test-recipe-name/");
    });
  });
});
