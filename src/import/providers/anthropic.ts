/**
 * Anthropic provider adapter for recipe import
 */

import Anthropic from "@anthropic-ai/sdk";
import type { ProviderAdapter, InferenceResult } from "../types";
import { arrayBufferToBase64 } from "../utils";

export const anthropicAdapter: ProviderAdapter = {
  name: "anthropic",

  async infer({ input, systemPrompt, model, apiKey }): Promise<InferenceResult> {
    const client = new Anthropic({ apiKey });

    // Build user content
    const userContent: Anthropic.MessageParam["content"] = [];

    if (input.images && input.images.length > 0) {
      userContent.push({
        type: "text",
        text: "Extract recipe from these images:",
      });

      for (const image of input.images) {
        const base64 = arrayBufferToBase64(image.data);
        // Map generic mimeType to Anthropic's expected format
        const mediaType = image.mimeType as "image/jpeg" | "image/png" | "image/webp" | "image/gif";
        userContent.push({
          type: "image",
          source: {
            type: "base64",
            media_type: mediaType,
            data: base64,
          },
        });
      }
    } else if (input.text) {
      userContent.push({
        type: "text",
        text: `Extract this recipe:\n\n${input.text}`,
      });
    } else {
      throw new Error("No input provided (text or images required)");
    }

    const start = performance.now();
    const response = await client.messages.create({
      model,
      max_tokens: 4096,
      system: systemPrompt,
      messages: [{ role: "user", content: userContent }],
    });
    const durationMs = performance.now() - start;

    // Extract text from response
    const textBlock = response.content.find((block) => block.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("No text response from Anthropic");
    }

    return {
      text: textBlock.text,
      metrics: {
        durationMs,
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
      },
    };
  },
};
