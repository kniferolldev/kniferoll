/**
 * Provider registry for recipe import
 */

import type { Provider, ProviderAdapter } from "../types";
import { googleAdapter } from "./google";

/** Map of provider names to adapters */
const providers: Partial<Record<Provider, ProviderAdapter>> = {
  google: googleAdapter,
};

/**
 * Get a provider adapter by name
 *
 * @param name - Provider name
 * @returns Provider adapter
 * @throws If provider is not registered
 */
export function getProvider(name: Provider): ProviderAdapter {
  const provider = providers[name];
  if (!provider) {
    throw new Error(`Unknown provider: ${name}. Only "google" is currently supported for importing.`);
  }
  return provider;
}

export { googleAdapter };
