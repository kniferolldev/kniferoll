/**
 * Google Gemini provider adapter for recipe import.
 * Uses raw HTTP calls (no SDK) for consistent RECITATION handling.
 */

import type { ProviderAdapter, InferenceResult, InferenceMetrics } from "../types";
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
): Promise<GeminiOnceResult> {
  const body: Record<string, unknown> = {
    system_instruction: { parts: [{ text: systemPrompt }] },
    contents: [{ parts }],
  };

  if (model.includes("gemini-3")) {
    body.generation_config = {
      thinking_config: { thinking_level: "MINIMAL" },
    };
  }

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

export const googleAdapter: ProviderAdapter = {
  name: "google",

  async infer({ input, systemPrompt, model, apiKey }): Promise<InferenceResult> {
    const parts = buildParts(input);
    const first = await callOnce(model, systemPrompt, parts, apiKey);

    if (first.finishReason && first.finishReason !== "STOP" && first.finishReason !== "MAX_TOKENS") {
      if (first.finishReason !== "RECITATION") {
        throw new Error(
          `Gemini response blocked (${first.finishReason}): model=${model}`,
        );
      }

      // Retry with ★ markers to defeat recitation filter
      const augmentedPrompt = systemPrompt + "\n\n" + recitationMarkerAppendix();
      const retry = await callOnce(model, augmentedPrompt, parts, apiKey);

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
