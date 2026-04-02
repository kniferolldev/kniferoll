/**
 * Convenience wrapper for calling LLMs via the provider registry.
 *
 * Matches the worker's old `callLlm(providerModel, systemPrompt, content, apiKeys)`
 * signature so callers (like doctor-handler) can migrate with minimal changes.
 */

import type { InferenceResult, Provider } from "./types";
import { parseModelSpec } from "./types";
import { getProvider } from "./providers";
import { getApiKeyEnvVar } from "./config";

export interface CallLlmContent {
  text?: string;
  images?: Array<{ data: ArrayBuffer; mimeType: "image/jpeg" | "image/png" | "image/webp" }>;
}

export interface CallLlmApiKeys {
  google?: string;
  anthropic?: string;
  openai?: string;
}

function resolveKey(apiKeys: CallLlmApiKeys, provider: Provider): string {
  // Check both "google" and "gemini" keys for the google provider
  const key = provider === "google"
    ? (apiKeys.google ?? (apiKeys as Record<string, string | undefined>).gemini)
    : apiKeys[provider];
  if (!key) {
    throw new Error(`${getApiKeyEnvVar(provider)} not configured`);
  }
  return key;
}

/**
 * Parse a "provider/model" string and call the appropriate provider.
 *
 * Drop-in replacement for the worker's old `callLlm` from `./llm.ts`.
 */
export async function callLlm(
  providerModel: string,
  systemPrompt: string,
  content: CallLlmContent,
  apiKeys: CallLlmApiKeys,
): Promise<InferenceResult> {
  const spec = parseModelSpec(providerModel);
  if (!spec) {
    throw new Error(`Invalid model format: "${providerModel}"`);
  }

  const provider = getProvider(spec.provider);
  const apiKey = resolveKey(apiKeys, spec.provider);

  return provider.infer({
    input: content,
    systemPrompt,
    model: spec.model,
    apiKey,
  });
}
