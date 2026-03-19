import { expect, test, describe, afterEach, mock } from "bun:test";
import { callLlm } from "./call-llm";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("callLlm", () => {
  test("routes to google provider", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "result" }] } }],
          usageMetadata: {},
        }),
      ),
    ) as any;

    const result = await callLlm(
      "google/gemini-3-flash-preview",
      "prompt",
      { text: "input" },
      { google: "key" },
    );
    expect(result.text).toBe("result");
  });

  test("throws for missing API key", async () => {
    await expect(
      callLlm("google/model", "prompt", { text: "input" }, {}),
    ).rejects.toThrow(/GEMINI_API_KEY/);
  });

  test("throws for unsupported provider", async () => {
    await expect(
      callLlm("anthropic/model", "prompt", { text: "input" }, {}),
    ).rejects.toThrow(/Unknown provider.*anthropic/);
  });

  test("throws for invalid model format", async () => {
    await expect(
      callLlm("noSlash", "prompt", { text: "input" }, {}),
    ).rejects.toThrow(/Invalid model format/);
  });
});
