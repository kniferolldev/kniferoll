/**
 * Browser-safe constants for recipe import
 * These can be imported in both Node.js and browser environments
 */

/** Default model for recipe import */
export const DEFAULT_IMPORT_MODEL = "google/gemini-3-flash-preview";

/** Provider type */
export type Provider = "anthropic" | "google" | "openai";

/** Get the display name for a provider */
export function getProviderDisplayName(provider: string): string {
  switch (provider) {
    case "google":
      return "Gemini";
    case "anthropic":
      return "Anthropic";
    case "openai":
      return "OpenAI";
    default:
      return provider.charAt(0).toUpperCase() + provider.slice(1);
  }
}

/** Get the URL to obtain an API key for a provider */
export function getProviderApiKeyUrl(provider: string): string {
  switch (provider) {
    case "google":
      return "https://aistudio.google.com/apikey";
    case "anthropic":
      return "https://console.anthropic.com/settings/keys";
    case "openai":
      return "https://platform.openai.com/api-keys";
    default:
      return "";
  }
}
