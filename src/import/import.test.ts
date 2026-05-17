import { expect, test, describe, beforeEach, afterEach } from "bun:test";
import {
  parseModelSpec,
  formatModelSpec,
  buildFormatPrompt,
  arrayBufferToBase64,
  blobToLoadedImage,
  resolveInput,
} from "./index";
import { DEFAULT_IMPORT_MODEL, DEFAULT_FORMAT_MODEL, getApiKeyEnvVar, getApiKey } from "./config";
import { loadSchema, clearSchemaCache } from "./load-schema";
import { buildExtractionPrompt } from "./extract-prompt";
import { buildTextExtractionPrompt } from "./text-extract-prompt";
import { buildRotationDetectionPrompt } from "./rotation-prompt";
import {
  importRecipe,
  extractRecipe,
  formatRecipe,
  parseExtractedJson,
} from "./infer";
import { getProvider } from "./providers";
import type { InferenceAdapterRequest } from "./types";

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

describe("buildFormatPrompt", () => {
  test("includes the schema", () => {
    const schema = "# Test Schema\nContent here";
    const prompt = buildFormatPrompt(schema);

    expect(prompt).toContain(schema);
  });

  test("includes recipe formatting context", () => {
    const prompt = buildFormatPrompt("schema");

    expect(prompt).toContain("recipe formatting assistant");
    expect(prompt).toContain("Kniferoll Markdown");
  });

  test("includes conversion guidelines", () => {
    const prompt = buildFormatPrompt("schema");

    expect(prompt).toContain("CONVERSION GUIDELINES");
    expect(prompt).toContain("frontmatter");
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

  test("mentions verbatim copying", () => {
    const prompt = buildExtractionPrompt();

    expect(prompt).toContain("exactly");
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

  test("includes NOT_A_RECIPE sentinel for non-recipe detection", () => {
    const prompt = buildExtractionPrompt();

    expect(prompt).toContain("NOT_A_RECIPE");
  });
});

describe("buildTextExtractionPrompt", () => {
  test("returns a non-empty string", () => {
    const prompt = buildTextExtractionPrompt();

    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(100);
  });

  test("mentions verbatim copying", () => {
    const prompt = buildTextExtractionPrompt();

    expect(prompt).toContain("exactly");
  });

  test("includes JSON output format fields", () => {
    const prompt = buildTextExtractionPrompt();

    expect(prompt).toContain("title");
    expect(prompt).toContain("sections");
    expect(prompt).toContain("content");
  });

  test("includes NOT_A_RECIPE sentinel for non-recipe detection", () => {
    const prompt = buildTextExtractionPrompt();

    expect(prompt).toContain("NOT_A_RECIPE");
  });
});

describe("parseExtractedJson", () => {
  test("parses valid recipe JSON", () => {
    const json = JSON.stringify({
      title: "Chocolate Cake",
      sections: [
        { type: "ingredients", content: ["2 cups flour"] },
        { type: "instructions", content: ["Mix ingredients"] },
      ],
    });

    const result = parseExtractedJson(json);

    expect(result.title).toBe("Chocolate Cake");
    expect(result.sections).toHaveLength(2);
  });

  test("parses code-fenced JSON", () => {
    const inner = JSON.stringify({
      is_recipe: true,
      sections: [{ type: "instructions", content: ["Bake at 350°F"] }],
    });

    const result = parseExtractedJson("```json\n" + inner + "\n```");

    expect(result.sections).toHaveLength(1);
  });

  test("passes through optional fields", () => {
    const json = JSON.stringify({
      title: "Test",
      source: "Test Kitchen",
      servings: "4",
      time: "30 min",
      sections: [],
    });

    const result = parseExtractedJson(json);

    expect(result.source).toBe("Test Kitchen");
    expect(result.servings).toBe("4");
    expect(result.time).toBe("30 min");
  });

  test("throws on NOT_A_RECIPE sentinel", () => {
    expect(() => parseExtractedJson("NOT_A_RECIPE")).toThrow("Not a recipe");
  });

  test("throws on NOT_A_RECIPE sentinel with trailing explanation", () => {
    expect(() => parseExtractedJson("NOT_A_RECIPE: this is a news article")).toThrow("Not a recipe");
  });

  test("throws on invalid JSON", () => {
    expect(() => parseExtractedJson("this is not json at all")).toThrow(
      "non-JSON output"
    );
  });

  test("throws when sections is missing", () => {
    const json = JSON.stringify({ is_recipe: true, title: "Something" });

    expect(() => parseExtractedJson(json)).toThrow("missing required 'sections'");
  });

  test("throws when sections is not an array", () => {
    const json = JSON.stringify({ sections: "flat string" });

    expect(() => parseExtractedJson(json)).toThrow("missing required 'sections'");
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
    delete process.env.GEMINI_API_KEY;

    await expect(
      importRecipe({ text: "test" }, { model: "google/gemini-3-flash-preview" })
    ).rejects.toThrow("GEMINI_API_KEY");
  });

  test("throws error for empty input", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    await expect(
      importRecipe({}, { model: "google/gemini-3-flash-preview", schema: "test schema" })
    ).rejects.toThrow("No text provided for extraction");
  });

  test("uses inference adapter for text imports without API keys", async () => {
    delete process.env.GEMINI_API_KEY;

    const calls: InferenceAdapterRequest[] = [];
    const result = await importRecipe(
      { text: "1 cup flour\nBake it." },
      {
        schema: "test schema",
        inference: {
          infer: async (request) => {
            calls.push(request);
            if (request.stage === "extract") {
              return {
                text: JSON.stringify({
                  title: "Adapter Recipe",
                  sections: [
                    { type: "ingredients", content: ["1 cup flour"] },
                    { type: "instructions", content: ["Bake it."] },
                  ],
                }),
                metrics: { durationMs: 10, inputTokens: 20, outputTokens: 5 },
              };
            }
            if (request.stage === "format") {
              return {
                text: "# Adapter Recipe\n\n## Ingredients\n\n- flour - 1 cup\n\n## Steps\n\n1. Bake it.\n",
                metrics: { durationMs: 5, inputTokens: 12, outputTokens: 8 },
              };
            }
            throw new Error(`unexpected stage: ${request.stage}`);
          },
        },
      },
    );

    expect(result.markdown).toContain("# Adapter Recipe");
    expect(result.extractedJson).toContain("Adapter Recipe");
    expect(result.metrics).toEqual({
      durationMs: 15,
      inputTokens: 32,
      outputTokens: 13,
    });
    expect(calls.map((call) => call.stage)).toEqual(["extract", "format"]);
    expect(calls[0]?.responseFormat).toEqual({ type: "json" });
    expect(calls[0]?.input.text).toBe("1 cup flour\nBake it.");
    expect(calls[1]?.responseFormat).toEqual({ type: "text" });
  });

  test("uses inference adapter for image imports without API keys", async () => {
    delete process.env.GEMINI_API_KEY;

    const image = new ArrayBuffer(4);
    const calls: InferenceAdapterRequest[] = [];
    const result = await importRecipe(
      { images: [{ kind: "loaded", data: image, mimeType: "image/png" }] },
      {
        schema: "test schema",
        inference: {
          infer: async (request) => {
            calls.push(request);
            if (request.stage === "rotation") {
              return {
                text: "0",
                metrics: { durationMs: 1, inputTokens: 2, outputTokens: 1 },
              };
            }
            if (request.stage === "extract") {
              return {
                text: JSON.stringify({
                  title: "Photo Recipe",
                  sections: [
                    { type: "ingredients", content: ["2 eggs"] },
                    { type: "instructions", content: ["Whisk."] },
                  ],
                }),
                metrics: { durationMs: 20, inputTokens: 30, outputTokens: 6 },
              };
            }
            if (request.stage === "format") {
              return {
                text: "# Photo Recipe\n\n## Ingredients\n\n- eggs - 2\n\n## Steps\n\n1. Whisk.\n",
                metrics: { durationMs: 6, inputTokens: 10, outputTokens: 7 },
              };
            }
            throw new Error(`unexpected stage: ${request.stage}`);
          },
        },
      },
    );

    expect(result.markdown).toContain("# Photo Recipe");
    expect(calls.map((call) => call.stage)).toEqual(["rotation", "extract", "format"]);
    expect(calls[0]?.responseFormat).toEqual({ type: "text" });
    expect(calls[0]?.input.images?.[0]?.mimeType).toBe("image/png");
    expect(calls[1]?.responseFormat).toEqual({ type: "json" });
    expect(calls[1]?.input.images?.[0]?.data).toBe(image);
  });

  test("passes opaque (non-provider/model) model alias through to adapter", async () => {
    delete process.env.GEMINI_API_KEY;

    const seenModels: Array<string | undefined> = [];
    const result = await importRecipe(
      { text: "1 cup flour\nBake it." },
      {
        model: "my-host-alias",
        formatModel: "my-host-format-alias",
        schema: "test schema",
        inference: {
          infer: async (request) => {
            seenModels.push(request.model);
            if (request.stage === "extract") {
              return {
                text: JSON.stringify({
                  title: "Alias Recipe",
                  sections: [
                    { type: "ingredients", content: ["1 cup flour"] },
                    { type: "instructions", content: ["Bake it."] },
                  ],
                }),
              };
            }
            return { text: "# Alias Recipe\n" };
          },
        },
      },
    );

    expect(result.markdown).toContain("# Alias Recipe");
    expect(seenModels).toEqual(["my-host-alias", "my-host-format-alias"]);
  });

  test("propagates abort signal to adapter", async () => {
    delete process.env.GEMINI_API_KEY;

    const controller = new AbortController();
    const seenSignals: Array<AbortSignal | undefined> = [];

    await importRecipe(
      { text: "1 cup flour\nBake it." },
      {
        schema: "test schema",
        signal: controller.signal,
        inference: {
          infer: async (request) => {
            seenSignals.push(request.signal);
            if (request.stage === "extract") {
              return {
                text: JSON.stringify({
                  title: "Signal Recipe",
                  sections: [
                    { type: "ingredients", content: ["1 cup flour"] },
                    { type: "instructions", content: ["Bake it."] },
                  ],
                }),
              };
            }
            return { text: "# Signal Recipe\n" };
          },
        },
      },
    );

    expect(seenSignals).toHaveLength(2);
    expect(seenSignals[0]).toBe(controller.signal);
    expect(seenSignals[1]).toBe(controller.signal);
  });

  test("adapter-returned model overrides the requested model string", async () => {
    delete process.env.GEMINI_API_KEY;

    const result = await importRecipe(
      { text: "1 cup flour\nBake it." },
      {
        model: "my-host-alias",
        schema: "test schema",
        inference: {
          infer: async (request) => {
            if (request.stage === "extract") {
              return {
                text: JSON.stringify({
                  title: "Resolved Recipe",
                  sections: [
                    { type: "ingredients", content: ["1 cup flour"] },
                    { type: "instructions", content: ["Bake it."] },
                  ],
                }),
                model: "host-resolved/extract-model-v2",
              };
            }
            return { text: "# Resolved Recipe\n", model: "host-resolved/format-model-v2" };
          },
        },
      },
    );

    expect(result.model).toBe("host-resolved/extract-model-v2");
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
    delete process.env.GEMINI_API_KEY;

    await expect(
      extractRecipe(
        { images: [{ kind: "loaded", data: new ArrayBuffer(10), mimeType: "image/jpeg" }] },
        { model: "google/gemini-3-flash-preview" }
      )
    ).rejects.toThrow("GEMINI_API_KEY");
  });

  test("throws error when no images provided", async () => {
    process.env.GEMINI_API_KEY = "test-key";

    await expect(
      extractRecipe({ text: "just text" }, { model: "google/gemini-3-flash-preview" })
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
  test("returns google adapter", () => {
    const provider = getProvider("google");

    expect(provider).toBeDefined();
    expect(typeof provider.infer).toBe("function");
  });

  test("throws for unsupported provider (anthropic)", () => {
    expect(() => getProvider("anthropic")).toThrow(/Unknown provider/);
  });

  test("throws for unsupported provider (openai)", () => {
    expect(() => getProvider("openai")).toThrow(/Unknown provider/);
  });

  test("throws for unknown provider", () => {
    expect(() => getProvider("unknown" as never)).toThrow(/Unknown provider/);
  });
});
