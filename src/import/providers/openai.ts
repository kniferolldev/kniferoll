/**
 * OpenAI provider adapter for recipe import
 */

import OpenAI from "openai";
import type { ProviderAdapter, ResolvedInput } from "../types";
import { arrayBufferToBase64 } from "../utils";

export const openaiAdapter: ProviderAdapter = {
  name: "openai",

  async infer({ input, systemPrompt, model, apiKey }): Promise<string> {
    const client = new OpenAI({ apiKey });

    // Build user content
    const userContent: any[] = [];

    if (input.images && input.images.length > 0) {
      userContent.push({
        type: "input_text",
        text: "Extract recipe from these images:",
      });

      for (const image of input.images) {
        const base64 = arrayBufferToBase64(image.data);
        userContent.push({
          type: "input_image",
          image_url: `data:${image.mimeType};base64,${base64}`,
        });
      }
    } else if (input.text) {
      userContent.push({
        type: "input_text",
        text: `Extract this recipe:\n\n${input.text}`,
      });
    } else {
      throw new Error("No input provided (text or images required)");
    }

    // Use the responses API
    const response = await (client as any).responses.create({
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
    });

    return response.output_text;
  },
};
