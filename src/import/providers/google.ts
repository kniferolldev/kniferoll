/**
 * Google Gemini provider adapter for recipe import.
 * Uses raw HTTP calls (no SDK) for consistent RECITATION handling.
 */

import type { ProviderAdapter, InferenceResult, InferenceMetrics, ProviderStreamCallback } from "../types";
import { arrayBufferToBase64 } from "../utils";
import { recitationMarkerAppendix, stripMarkers } from "../recitation-workaround";

/** Build content parts in Gemini REST format. */
function buildParts(
  input: { text?: string; images?: Array<{ data: ArrayBuffer; mimeType: string }> },
): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];

  if (input.images && input.images.length > 0) {
    parts.push({ text: "Extract recipe from these images:" });
    for (const image of input.images) {
      parts.push({
        inline_data: {
          mime_type: image.mimeType,
          data: arrayBufferToBase64(image.data),
        },
      });
    }
  } else if (input.text) {
    parts.push({ text: `Extract this recipe:\n\n${input.text}` });
  } else {
    throw new Error("No input provided (text or images required)");
  }

  return parts;
}

/** Build the JSON request body for Gemini API. */
function buildRequestBody(
  model: string,
  systemPrompt: string,
  parts: Array<Record<string, unknown>>,
  temperature?: number,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts }],
  };

  const generationConfig: Record<string, unknown> = {};
  if (model.includes("gemini-3")) {
    generationConfig.thinking_config = { thinking_level: "MINIMAL" };
  }
  if (temperature !== undefined) {
    generationConfig.temperature = temperature;
  }
  if (Object.keys(generationConfig).length > 0) {
    body.generation_config = generationConfig;
  }

  return body;
}

interface GeminiOnceResult {
  text: string;
  finishReason?: string;
  metrics: InferenceMetrics;
}

/** Single raw HTTP call to Gemini. */
async function callOnce(
  model: string,
  systemPrompt: string,
  parts: Array<Record<string, unknown>>,
  apiKey: string,
  temperature?: number,
): Promise<GeminiOnceResult> {
  const body = buildRequestBody(model, systemPrompt, parts, temperature);

  const start = performance.now();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  const data = await response.json() as any;
  const durationMs = performance.now() - start;

  const candidate = data.candidates?.[0];
  const finishReason = candidate?.finishReason;

  const text = candidate?.content?.parts
    ?.filter((p: any) => p.text !== undefined)
    ?.map((p: any) => p.text)
    ?.join("") ?? "";

  if (!text && !candidate) {
    throw new Error(`Gemini returned no candidates: model=${model}`);
  }

  return {
    text,
    finishReason,
    metrics: {
      durationMs,
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    },
  };
}

/** Streaming HTTP call to Gemini using SSE endpoint. */
async function callStream(
  model: string,
  systemPrompt: string,
  parts: Array<Record<string, unknown>>,
  apiKey: string,
  onStream: ProviderStreamCallback,
  temperature?: number,
): Promise<GeminiOnceResult> {
  const body = buildRequestBody(model, systemPrompt, parts, temperature);

  const start = performance.now();
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini API error (${response.status}): ${errorText}`);
  }

  if (!response.body) {
    throw new Error("Gemini streaming response has no body");
  }

  let accumulatedText = "";
  let finishReason: string | undefined;
  let inputTokens = 0;
  let outputTokens = 0;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Parse SSE events from buffer
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? ""; // Keep incomplete line in buffer

    for (const line of lines) {
      if (!line.startsWith("data: ")) continue;
      const jsonStr = line.slice(6).trim();
      if (!jsonStr || jsonStr === "[DONE]") continue;

      try {
        const chunk = JSON.parse(jsonStr) as any;

        // Accumulate text from content parts (skip thinking parts)
        const parts = chunk.candidates?.[0]?.content?.parts;
        if (parts) {
          for (const part of parts) {
            if (part.text !== undefined && !part.thought) {
              accumulatedText += part.text;
            }
          }
        }

        // Track finish reason
        if (chunk.candidates?.[0]?.finishReason) {
          finishReason = chunk.candidates[0].finishReason;
        }

        // Track token counts from usage metadata
        if (chunk.usageMetadata) {
          if (chunk.usageMetadata.promptTokenCount) {
            inputTokens = chunk.usageMetadata.promptTokenCount;
          }
          if (chunk.usageMetadata.candidatesTokenCount) {
            outputTokens = chunk.usageMetadata.candidatesTokenCount;
          }
        }

        // Notify callback
        onStream({
          outputTokens,
          textLength: accumulatedText.length,
          elapsedMs: performance.now() - start,
          text: accumulatedText,
        });
      } catch {
        // Skip malformed JSON chunks
      }
    }
  }

  const durationMs = performance.now() - start;

  if (!accumulatedText && !finishReason) {
    throw new Error(`Gemini returned no candidates: model=${model}`);
  }

  return {
    text: accumulatedText,
    finishReason,
    metrics: {
      durationMs,
      inputTokens,
      outputTokens,
    },
  };
}

export const googleAdapter: ProviderAdapter = {
  name: "google",

  async infer({ input, systemPrompt, model, apiKey, temperature, onStream }): Promise<InferenceResult> {
    const parts = buildParts(input);

    const call = (prompt: string) =>
      onStream
        ? callStream(model, prompt, parts, apiKey, onStream, temperature)
        : callOnce(model, prompt, parts, apiKey, temperature);

    const first = await call(systemPrompt);

    if (first.finishReason && first.finishReason !== "STOP" && first.finishReason !== "MAX_TOKENS") {
      if (first.finishReason !== "RECITATION") {
        throw new Error(
          `Gemini response blocked (${first.finishReason}): model=${model}`,
        );
      }

      // Retry with ★ markers to defeat recitation filter
      const augmentedPrompt = systemPrompt + "\n\n" + recitationMarkerAppendix();
      const retry = await call(augmentedPrompt);

      if (retry.finishReason && retry.finishReason !== "STOP" && retry.finishReason !== "MAX_TOKENS") {
        throw new Error(
          `Gemini response blocked (${retry.finishReason}): model=${model}`,
        );
      }

      return {
        text: stripMarkers(retry.text),
        metrics: {
          durationMs: first.metrics.durationMs + retry.metrics.durationMs,
          inputTokens: first.metrics.inputTokens + retry.metrics.inputTokens,
          outputTokens: first.metrics.outputTokens + retry.metrics.outputTokens,
        },
      };
    }

    return { text: first.text, metrics: first.metrics };
  },
};
