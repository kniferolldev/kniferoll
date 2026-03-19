import { expect, test, describe, afterEach, mock } from "bun:test";
import { googleAdapter } from "./google";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("googleAdapter request format", () => {
  test("sends correct request format for text input", async () => {
    let capturedBody: any;
    globalThis.fetch = mock(async (_url: string, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "# Test Recipe\n" }] } }],
          usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 },
        }),
      );
    }) as any;

    const result = await googleAdapter.infer({
      input: { text: "recipe text" },
      systemPrompt: "system prompt",
      model: "gemini-3-flash-preview",
      apiKey: "test-key",
    });

    expect(result.text).toBe("# Test Recipe\n");
    expect(result.metrics.inputTokens).toBe(100);
    expect(result.metrics.outputTokens).toBe(50);
    expect(capturedBody.system_instruction.parts[0].text).toBe("system prompt");
  });

  test("adds thinking config for gemini-3 models", async () => {
    let capturedBody: any;
    globalThis.fetch = mock(async (_url: string, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "result" }] } }],
          usageMetadata: {},
        }),
      );
    }) as any;

    await googleAdapter.infer({
      input: { text: "input" },
      systemPrompt: "prompt",
      model: "gemini-3-flash-preview",
      apiKey: "key",
    });
    expect(capturedBody.generation_config.thinking_config.thinking_level).toBe("MINIMAL");
  });

  test("sends image data as inline_data", async () => {
    let capturedBody: any;
    globalThis.fetch = mock(async (_url: string, init: any) => {
      capturedBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: "result" }] } }],
          usageMetadata: {},
        }),
      );
    }) as any;

    const imageData = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]).buffer;
    await googleAdapter.infer({
      input: { images: [{ data: imageData, mimeType: "image/jpeg" }] },
      systemPrompt: "prompt",
      model: "gemini-2.5-flash-lite",
      apiKey: "key",
    });

    const parts = capturedBody.contents[0].parts;
    expect(parts[0].text).toBe("Extract recipe from these images:");
    expect(parts[1].inline_data.mime_type).toBe("image/jpeg");
    expect(parts[1].inline_data.data).toBeTypeOf("string"); // base64
  });

  test("throws on API error", async () => {
    globalThis.fetch = mock(async () =>
      new Response("Bad request", { status: 400 }),
    ) as any;

    await expect(
      googleAdapter.infer({
        input: { text: "input" },
        systemPrompt: "prompt",
        model: "model",
        apiKey: "key",
      }),
    ).rejects.toThrow(/Gemini API error \(400\)/);
  });

  test("throws on empty response with no candidates", async () => {
    globalThis.fetch = mock(async () =>
      new Response(
        JSON.stringify({
          usageMetadata: { promptTokenCount: 100, totalTokenCount: 100 },
          modelVersion: "gemini-3-flash-preview",
        }),
      ),
    ) as any;

    await expect(
      googleAdapter.infer({
        input: { text: "input" },
        systemPrompt: "prompt",
        model: "gemini-3-flash-preview",
        apiKey: "key",
      }),
    ).rejects.toThrow(/Gemini returned no candidates/);
  });
});

describe("googleAdapter RECITATION handling", () => {
  const recitationResponse = {
    candidates: [
      {
        content: {},
        finishReason: "RECITATION",
        index: 0,
      },
    ],
    usageMetadata: {
      promptTokenCount: 1507,
      totalTokenCount: 2613,
      promptTokensDetails: [
        { modality: "TEXT", tokenCount: 443 },
        { modality: "IMAGE", tokenCount: 1064 },
      ],
      thoughtsTokenCount: 1106,
    },
    modelVersion: "gemini-3-flash-preview",
  };

  const successResponse = {
    candidates: [
      {
        content: { parts: [{ text: "Chicken ★ Parmesan" }] },
        finishReason: "STOP",
      },
    ],
    usageMetadata: {
      promptTokenCount: 1600,
      candidatesTokenCount: 60,
      totalTokenCount: 1660,
    },
  };

  test("retries with markers on RECITATION then succeeds", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async (_url: string, init: any) => {
      callCount++;
      if (callCount === 1) {
        return new Response(JSON.stringify(recitationResponse));
      }
      // Verify retry prompt contains marker instructions
      const body = JSON.parse(init.body);
      expect(body.system_instruction.parts[0].text).toContain("★");
      return new Response(JSON.stringify(successResponse));
    }) as any;

    const result = await googleAdapter.infer({
      input: { text: "some recipe" },
      systemPrompt: "Extract recipe",
      model: "gemini-3-flash-preview",
      apiKey: "test-key",
    });

    expect(callCount).toBe(2);
    expect(result.text).toBe("Chicken Parmesan"); // markers stripped
  });

  test("throws on non-RECITATION block without retry", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      return new Response(
        JSON.stringify({
          candidates: [
            { content: {}, finishReason: "SAFETY", index: 0 },
          ],
          usageMetadata: { promptTokenCount: 100 },
        }),
      );
    }) as any;

    await expect(
      googleAdapter.infer({
        input: { text: "some recipe" },
        systemPrompt: "Extract recipe",
        model: "gemini-3-flash-preview",
        apiKey: "test-key",
      }),
    ).rejects.toThrow(/SAFETY/);

    expect(callCount).toBe(1); // no retry
  });

  test("successful response passes through without retry", async () => {
    let callCount = 0;
    globalThis.fetch = mock(async () => {
      callCount++;
      return new Response(JSON.stringify(successResponse));
    }) as any;

    const result = await googleAdapter.infer({
      input: { text: "some recipe" },
      systemPrompt: "Extract recipe",
      model: "gemini-3-flash-preview",
      apiKey: "test-key",
    });

    expect(callCount).toBe(1);
    expect(result.text).toBe("Chicken ★ Parmesan"); // no stripping on first pass
  });

  test("throws early on empty content", async () => {
    globalThis.fetch = mock(async () => {
      throw new Error("fetch should not be called");
    }) as any;

    await expect(
      googleAdapter.infer({
        input: { text: "" },
        systemPrompt: "Extract recipe",
        model: "gemini-3-flash-preview",
        apiKey: "test-key",
      }),
    ).rejects.toThrow(/no input/i);
  });
});
