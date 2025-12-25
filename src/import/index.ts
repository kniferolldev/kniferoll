/**
 * Recipe Import Module
 *
 * Unified infrastructure for importing recipes from text or images
 * using LLMs. Supports both Anthropic and OpenAI providers.
 *
 * @example
 * import { importRecipe } from "./import";
 *
 * // Import from text
 * const result = await importRecipe({ text: "1 cup flour..." });
 * console.log(result.markdown);
 * console.log(`Used model: ${result.model}`);
 *
 * @example
 * // Import from images (CLI)
 * const result = await importRecipe({
 *   images: [{ kind: "lazy", path: "recipe.jpg" }]
 * }, { model: "anthropic/claude-sonnet-4-5-20250514" });
 */

// Main function
export { importRecipe } from "./infer";

// Types
export type {
  Provider,
  ModelSpec,
  LoadedImage,
  LazyImage,
  ImageSource,
  InferenceInput,
  ImportResult,
  ImportOptions,
  ResolvedInput,
  ProviderAdapter,
} from "./types";

// Type utilities
export { parseModelSpec, formatModelSpec } from "./types";

// Configuration
export { DEFAULT_IMPORT_MODEL, loadSchema, getApiKey, getApiKeyEnvVar } from "./config";

// Prompt (exported for transparency/debugging)
export { buildSystemPrompt } from "./prompt";

// Utilities (for consumers that need to convert Blobs)
export { blobToLoadedImage, arrayBufferToBase64, resolveInput } from "./utils";
