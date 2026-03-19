import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runEval } from "./eval";
import type { IO } from "../types";

let emptyEvalsDir: string;

beforeAll(async () => {
  emptyEvalsDir = await mkdtemp(join(tmpdir(), "kniferoll-eval-test-"));
});

afterAll(async () => {
  await rm(emptyEvalsDir, { recursive: true, force: true });
});

const writer = () => {
  let buffer = "";
  return {
    channel: {
      write(text: Uint8Array | string) {
        if (typeof text === "string") {
          buffer += text;
        } else {
          buffer += new TextDecoder().decode(text);
        }
      },
    },
    read() {
      return buffer;
    },
  };
};

const stubIO = (): { io: IO; stdout: ReturnType<typeof writer>; stderr: ReturnType<typeof writer> } => {
  const stdout = writer();
  const stderr = writer();
  const io: IO = {
    stdin: { async text() { return ""; } },
    stdout: stdout.channel,
    stderr: stderr.channel,
    readFile: async () => "",
  };
  return { io, stdout, stderr };
};

describe("eval argument parsing", () => {
  test("--regenerate without --model uses default model", async () => {
    // Save and clear API key to trigger early exit (default model is Gemini)
    const savedKey = process.env.GEMINI_API_KEY;
    delete process.env.GEMINI_API_KEY;

    try {
      const { io, stderr } = stubIO();
      const exitCode = await runEval(["--regenerate"], io);

      // Should fail due to missing API key, not missing --model
      expect(exitCode).toBe(1);
      expect(stderr.read()).toContain("GEMINI_API_KEY");
      expect(stderr.read()).not.toContain("--model is required");
    } finally {
      if (savedKey) process.env.GEMINI_API_KEY = savedKey;
    }
  });

  test("--model with invalid format fails", async () => {
    const { io, stderr } = stubIO();
    const exitCode = await runEval(["--regenerate", "--model", "gpt-4o"], io);

    expect(exitCode).toBe(2);
    expect(stderr.read()).toContain('Invalid model format: "gpt-4o"');
    expect(stderr.read()).toContain("<provider>/<model>");
  });

  test("--model with unsupported provider fails", async () => {
    const { io, stderr } = stubIO();
    const exitCode = await runEval(["--regenerate", "--model", "unsupported/model"], io);

    expect(exitCode).toBe(2);
    expect(stderr.read()).toContain('Invalid model format: "unsupported/model"');
  });

  test("--model with valid format but missing API key fails", async () => {
    // Save and clear API key
    const savedKey = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;

    try {
      const { io, stderr } = stubIO();
      const exitCode = await runEval(["--regenerate", "--model", "openai/gpt-4o"], io);

      expect(exitCode).toBe(1);
      expect(stderr.read()).toContain("OPENAI_API_KEY");
      expect(stderr.read()).toContain("not set");
    } finally {
      // Restore API key
      if (savedKey) process.env.OPENAI_API_KEY = savedKey;
    }
  });

  test("--model with anthropic provider checks ANTHROPIC_API_KEY", async () => {
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      const { io, stderr } = stubIO();
      const exitCode = await runEval(["--regenerate", "--model", "anthropic/claude-sonnet-4-5"], io);

      expect(exitCode).toBe(1);
      expect(stderr.read()).toContain("ANTHROPIC_API_KEY");
    } finally {
      if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });

  test("basic eval without --regenerate does not require --model", async () => {
    const { io, stderr } = stubIO();
    const exitCode = await runEval([emptyEvalsDir], io);

    expect(exitCode).toBe(1);
    expect(stderr.read()).toContain("No test cases found");
    expect(stderr.read()).not.toContain("--model is required");
  });
});

describe("InferenceMetrics", () => {
  test("metrics type has required fields", async () => {
    // Create a mock metrics object to verify the shape
    const metrics: import("../import").InferenceMetrics = {
      durationMs: 1500,
      inputTokens: 1000,
      outputTokens: 500,
    };

    expect(metrics.durationMs).toBe(1500);
    expect(metrics.inputTokens).toBe(1000);
    expect(metrics.outputTokens).toBe(500);
  });

  test("ImportResult includes optional metrics", async () => {
    const result: import("../import").ImportResult = {
      markdown: "# Test Recipe",
      model: "openai/gpt-4o",
      metrics: {
        durationMs: 2000,
        inputTokens: 1500,
        outputTokens: 800,
      },
    };

    expect(result.metrics).toBeDefined();
    expect(result.metrics?.durationMs).toBe(2000);
  });

  test("ImportResult works without metrics", async () => {
    const result: import("../import").ImportResult = {
      markdown: "# Test Recipe",
      model: "openai/gpt-4o",
    };

    expect(result.metrics).toBeUndefined();
  });
});
