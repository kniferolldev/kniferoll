/**
 * Provider registry for recipe import
 */

import type { Provider, ProviderAdapter } from "../types";
import { anthropicAdapter } from "./anthropic";
import { googleAdapter } from "./google";
import { openaiAdapter } from "./openai";

/** Map of provider names to adapters */
const providers: Record<Provider, ProviderAdapter> = {
  anthropic: anthropicAdapter,
  google: googleAdapter,
  openai: openaiAdapter,
};

/**
 * Get a provider adapter by name
 *
 * @param name - Provider name
 * @returns Provider adapter
 * @throws If provider is not found
 */
export function getProvider(name: Provider): ProviderAdapter {
  const provider = providers[name];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}`);
  }
  return provider;
}

export { anthropicAdapter, googleAdapter, openaiAdapter };
