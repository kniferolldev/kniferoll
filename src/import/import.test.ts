import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import {
  parseModelSpec,
  formatModelSpec,
  buildSystemPrompt,
  DEFAULT_IMPORT_MODEL,
  DEFAULT_FORMAT_MODEL,
  DEFAULT_JUDGE_MODEL,
  getApiKeyEnvVar,
  getApiKey,
  loadSchema,
  arrayBufferToBase64,
  blobToLoadedImage,
  resolveInput,
} from "./index";
import { clearSchemaCache } from "./config";
import { buildExtractionPrompt } from "./extract-prompt";
import { buildFormatPrompt } from "./format-prompt";
import { buildRotationDetectionPrompt } from "./rotation-prompt";
import {
  importRecipe,
  extractRecipe,
  formatRecipe,
} from "./infer";
import { getProvider } from "./providers";

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
    expect(result?.provider).toBe("google");
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

describe("blobToLoadedImage", () => {
  test("converts blob to loaded image with correct mime type", async () => {
    const data = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
    const blob = new Blob([data], { type: "image/jpeg" });

    const result = await blobToLoadedImage(blob);

    expect(result.kind).toBe("loaded");
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.data.byteLength).toBe(4);
  });

  test("defaults to image/jpeg for unknown mime type", async () => {
    const data = new Uint8Array([0x00, 0x01, 0x02]);
    const blob = new Blob([data]);

    const result = await blobToLoadedImage(blob);

    expect(result.mimeType).toBe("image/jpeg");
  });

  test("handles png mime type", async () => {
    const data = new Uint8Array([0x89, 0x50, 0x4e, 0x47]); // PNG header
    const blob = new Blob([data], { type: "image/png" });

    const result = await blobToLoadedImage(blob);

    expect(result.mimeType).toBe("image/png");
  });
});

describe("resolveInput", () => {
  test("passes through text input", async () => {
    const result = await resolveInput({ text: "hello world" });

    expect(result.text).toBe("hello world");
    expect(result.images).toBeUndefined();
  });

  test("handles empty input", async () => {
    const result = await resolveInput({});

    expect(result.text).toBeUndefined();
    expect(result.images).toBeUndefined();
  });

  test("handles loaded images without preprocessing", async () => {
    const data = new ArrayBuffer(10);
    const result = await resolveInput({
      images: [{ kind: "loaded", data, mimeType: "image/jpeg" }],
    });

    expect(result.images).toHaveLength(1);
    expect(result.images?.[0]?.mimeType).toBe("image/jpeg");
  });

  test("handles text and images together", async () => {
    const data = new ArrayBuffer(10);
    const result = await resolveInput({
      text: "some text",
      images: [{ kind: "loaded", data, mimeType: "image/png" }],
    });

    expect(result.text).toBe("some text");
    expect(result.images).toHaveLength(1);
  });
});

describe("buildExtractionPrompt", () => {
  test("returns a non-empty string", () => {
    const prompt = buildExtractionPrompt();

    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
  });

  test("mentions OCR/transcription", () => {
    const prompt = buildExtractionPrompt();

    expect(prompt).toContain("OCR");
  });

  test("includes JSON output format", () => {
    const prompt = buildExtractionPrompt();

    expect(prompt).toContain("title");
    expect(prompt).toContain("sections");
    expect(prompt).toContain("content");
  });

  test("warns against generating content", () => {
    const prompt = buildExtractionPrompt();

    expect(prompt).toContain("NEVER");
    expect(prompt.toLowerCase()).toContain("guess");
  });
});

describe("buildFormatPrompt", () => {
  test("includes the provided schema", () => {
    const schema = "# My Test Schema\n\nSome content here";
    const prompt = buildFormatPrompt(schema);

    expect(prompt).toContain(schema);
  });

  test("mentions Recipe Markdown", () => {
    const prompt = buildFormatPrompt("schema");

    expect(prompt).toContain("Recipe Markdown");
  });

  test("includes formatting guidelines", () => {
    const prompt = buildFormatPrompt("schema");

    expect(prompt).toContain("FORMATTING GUIDELINES");
    expect(prompt).toContain("frontmatter");
    expect(prompt).toContain("version:");
  });

  test("describes input format", () => {
    const prompt = buildFormatPrompt("schema");

    expect(prompt).toContain("INPUT FORMAT");
    expect(prompt).toContain("sections");
  });
});

describe("buildRotationDetectionPrompt", () => {
  test("returns a non-empty string", () => {
    const prompt = buildRotationDetectionPrompt();

    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(50);
  });

  test("mentions rotation angles", () => {
    const prompt = buildRotationDetectionPrompt();

    expect(prompt).toContain("0");
    expect(prompt).toContain("90");
    expect(prompt).toContain("180");
    expect(prompt).toContain("270");
  });

  test("asks for a single number response", () => {
    const prompt = buildRotationDetectionPrompt();

    expect(prompt.toLowerCase()).toContain("number");
  });
});

describe("DEFAULT_FORMAT_MODEL", () => {
  test("is a valid model spec", () => {
    const result = parseModelSpec(DEFAULT_FORMAT_MODEL);

    expect(result).not.toBeNull();
  });
});

describe("DEFAULT_JUDGE_MODEL", () => {
  test("is a valid model spec", () => {
    const result = parseModelSpec(DEFAULT_JUDGE_MODEL);

    expect(result).not.toBeNull();
    expect(result?.provider).toBe("anthropic");
  });
});

describe("getApiKey", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv };
  });

  test("returns null when env var is not set", () => {
    delete process.env.OPENAI_API_KEY;

    const result = getApiKey("openai");

    expect(result).toBeNull();
  });

  test("returns api key from environment", () => {
    process.env.ANTHROPIC_API_KEY = "test-key-123";

    const result = getApiKey("anthropic");

    expect(result).toBe("test-key-123");
  });

  test("returns google api key", () => {
    process.env.GEMINI_API_KEY = "gemini-key";

    const result = getApiKey("google");

    expect(result).toBe("gemini-key");
  });
});

describe("loadSchema", () => {
  beforeEach(() => {
    clearSchemaCache();
  });

  test("loads schema from project root", async () => {
    const schema = await loadSchema();

    expect(typeof schema).toBe("string");
    expect(schema.length).toBeGreaterThan(100);
  });

  test("caches schema after first load", async () => {
    const schema1 = await loadSchema();
    const schema2 = await loadSchema();

    expect(schema1).toBe(schema2);
  });

  test("throws error for non-existent path", async () => {
    await expect(loadSchema("/nonexistent/path")).rejects.toThrow();
  });
});

describe("importRecipe", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("throws error for invalid model format", async () => {
    await expect(
      importRecipe({ text: "test" }, { model: "invalid-model" })
    ).rejects.toThrow("Invalid model format");
  });

  test("throws error when API key is missing", async () => {
    delete process.env.OPENAI_API_KEY;

    await expect(
      importRecipe({ text: "test" }, { model: "openai/gpt-4o" })
    ).rejects.toThrow("OPENAI_API_KEY");
  });

  test("throws error for empty input", async () => {
    process.env.OPENAI_API_KEY = "test-key";

    await expect(
      importRecipe({}, { model: "openai/gpt-4o", schema: "test schema" })
    ).rejects.toThrow("No input provided");
  });
});

describe("extractRecipe", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("throws error for invalid model format", async () => {
    await expect(
      extractRecipe(
        { images: [{ kind: "loaded", data: new ArrayBuffer(10), mimeType: "image/jpeg" }] },
        { model: "bad-model" }
      )
    ).rejects.toThrow("Invalid model format");
  });

  test("throws error when API key is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    await expect(
      extractRecipe(
        { images: [{ kind: "loaded", data: new ArrayBuffer(10), mimeType: "image/jpeg" }] },
        { model: "anthropic/claude-sonnet-4-5-20250514" }
      )
    ).rejects.toThrow("ANTHROPIC_API_KEY");
  });

  test("throws error when no images provided", async () => {
    process.env.OPENAI_API_KEY = "test-key";

    await expect(
      extractRecipe({ text: "just text" }, { model: "openai/gpt-4o" })
    ).rejects.toThrow("No images provided");
  });
});

describe("formatRecipe", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  test("throws error for invalid model format", async () => {
    await expect(
      formatRecipe('{"title": "Test"}', { model: "not-a-valid-model" })
    ).rejects.toThrow("Invalid model format");
  });

  test("throws error when API key is missing", async () => {
    delete process.env.GEMINI_API_KEY;

    await expect(
      formatRecipe('{"title": "Test"}', { model: "google/gemini-2.0-flash" })
    ).rejects.toThrow("GEMINI_API_KEY");
  });
});

describe("getProvider", () => {
  test("returns anthropic adapter", () => {
    const provider = getProvider("anthropic");

    expect(provider).toBeDefined();
    expect(typeof provider.infer).toBe("function");
  });

  test("returns openai adapter", () => {
    const provider = getProvider("openai");

    expect(provider).toBeDefined();
    expect(typeof provider.infer).toBe("function");
  });

  test("returns google adapter", () => {
    const provider = getProvider("google");

    expect(provider).toBeDefined();
    expect(typeof provider.infer).toBe("function");
  });

  test("throws for unknown provider", () => {
    expect(() => getProvider("unknown" as never)).toThrow("Unknown provider");
  });
});
