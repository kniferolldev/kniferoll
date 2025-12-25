/**
 * Google Gemini provider adapter for recipe import
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import type { ProviderAdapter, ResolvedInput } from "../types";
import { arrayBufferToBase64 } from "../utils";

export const googleAdapter: ProviderAdapter = {
  name: "google",

  async infer({ input, systemPrompt, model, apiKey }): Promise<string> {
    const genAI = new GoogleGenerativeAI(apiKey);
    const geminiModel = genAI.getGenerativeModel({
      model,
      systemInstruction: systemPrompt,
    });

    // Build content parts
    const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];

    if (input.images && input.images.length > 0) {
      parts.push({ text: "Extract recipe from these images:" });

      for (const image of input.images) {
        const base64 = arrayBufferToBase64(image.data);
        parts.push({
          inlineData: {
            mimeType: image.mimeType,
            data: base64,
          },
        });
      }
    } else if (input.text) {
      parts.push({ text: `Extract this recipe:\n\n${input.text}` });
    } else {
      throw new Error("No input provided (text or images required)");
    }

    const result = await geminiModel.generateContent(parts);
    const response = result.response;
    const text = response.text();

    return text;
  },
};
