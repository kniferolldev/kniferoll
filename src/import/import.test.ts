import { expect, test, describe } from "bun:test";
import {
  parseModelSpec,
  formatModelSpec,
  buildSystemPrompt,
  DEFAULT_IMPORT_MODEL,
  getApiKeyEnvVar,
  arrayBufferToBase64,
} from "./index";

describe("parseModelSpec", () => {
  test("parses openai model", () => {
    const result = parseModelSpec("openai/gpt-4o");
    expect(result).toEqual({ provider: "openai", model: "gpt-4o" });
  });

  test("parses anthropic model", () => {
    const result = parseModelSpec("anthropic/claude-sonnet-4-5-20250514");
    expect(result).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-4-5-20250514",
    });
  });

  test("parses google model", () => {
    const result = parseModelSpec("google/gemini-2.0-flash");
    expect(result).toEqual({
      provider: "google",
      model: "gemini-2.0-flash",
    });
  });

  test("returns null for missing slash", () => {
    const result = parseModelSpec("gpt-4o");
    expect(result).toBeNull();
  });

  test("returns null for unknown provider", () => {
    const result = parseModelSpec("azure/gpt-4o");
    expect(result).toBeNull();
  });

  test("returns null for empty model", () => {
    const result = parseModelSpec("openai/");
    expect(result).toBeNull();
  });

  test("handles model names with slashes", () => {
    const result = parseModelSpec("openai/gpt-4/turbo");
    expect(result).toEqual({ provider: "openai", model: "gpt-4/turbo" });
  });
});

describe("formatModelSpec", () => {
  test("formats model spec to string", () => {
    const result = formatModelSpec({ provider: "openai", model: "gpt-4o" });
    expect(result).toBe("openai/gpt-4o");
  });

  test("roundtrips with parseModelSpec", () => {
    const original = "anthropic/claude-sonnet-4-5-20250514";
    const parsed = parseModelSpec(original);
    expect(parsed).not.toBeNull();
    const formatted = formatModelSpec(parsed!);
    expect(formatted).toBe(original);
  });
});

describe("DEFAULT_IMPORT_MODEL", () => {
  test("is a valid model spec", () => {
    const result = parseModelSpec(DEFAULT_IMPORT_MODEL);
    expect(result).not.toBeNull();
    expect(result?.provider).toBe("openai");
  });
});

describe("getApiKeyEnvVar", () => {
  test("returns OPENAI_API_KEY for openai", () => {
    expect(getApiKeyEnvVar("openai")).toBe("OPENAI_API_KEY");
  });

  test("returns ANTHROPIC_API_KEY for anthropic", () => {
    expect(getApiKeyEnvVar("anthropic")).toBe("ANTHROPIC_API_KEY");
  });

  test("returns GEMINI_API_KEY for google", () => {
    expect(getApiKeyEnvVar("google")).toBe("GEMINI_API_KEY");
  });
});

describe("buildSystemPrompt", () => {
  test("includes the schema", () => {
    const schema = "# Test Schema\nContent here";
    const prompt = buildSystemPrompt(schema);

    expect(prompt).toContain(schema);
  });

  test("includes recipe extraction context", () => {
    const prompt = buildSystemPrompt("schema");

    expect(prompt).toContain("recipe extraction assistant");
    expect(prompt).toContain("Recipe Markdown format");
  });
});

describe("arrayBufferToBase64", () => {
  test("converts ArrayBuffer to base64", () => {
    const text = "Hello, World!";
    const encoder = new TextEncoder();
    const buffer = encoder.encode(text).buffer;

    const base64 = arrayBufferToBase64(buffer);

    // Decode and verify
    const decoded = Buffer.from(base64, "base64").toString();
    expect(decoded).toBe(text);
  });

  test("handles empty ArrayBuffer", () => {
    const buffer = new ArrayBuffer(0);
    const base64 = arrayBufferToBase64(buffer);
    expect(base64).toBe("");
  });

  test("handles binary data", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]); // JPEG header
    const buffer = bytes.buffer;

    const base64 = arrayBufferToBase64(buffer);

    // Should be valid base64
    expect(base64).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });
});
