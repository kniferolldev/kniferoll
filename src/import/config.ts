/**
 * Configuration for recipe import (browser/worker-safe)
 */

// Re-export browser-safe constants
export { DEFAULT_IMPORT_MODEL } from "./constants";

/** Default model for formatting stage (text-only, can be smaller/cheaper) */
export const DEFAULT_FORMAT_MODEL = "google/gemini-3-flash-preview";

/**
 * Get API key for a provider from environment variables
 *
 * @param provider - Provider name
 * @returns API key or null if not set
 */
export function getApiKey(provider: "anthropic" | "google" | "openai"): string | null {
  if (typeof process === "undefined") return null;
  const envVar = getApiKeyEnvVar(provider);
  return process.env[envVar] ?? null;
}

/**
 * Get the environment variable name for a provider's API key
 */
export function getApiKeyEnvVar(provider: "anthropic" | "google" | "openai"): string {
  switch (provider) {
    case "anthropic":
      return "ANTHROPIC_API_KEY";
    case "google":
      return "GEMINI_API_KEY";
    case "openai":
      return "OPENAI_API_KEY";
  }
}
