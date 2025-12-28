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

// Main functions
export { importRecipe, extractRecipe, formatRecipe, importRecipeTwoStage } from "./infer";

// Types
export type {
  Provider,
  ModelSpec,
  LoadedImage,
  LazyImage,
  ImageSource,
  InferenceInput,
  InferenceMetrics,
  InferenceResult,
  ImportResult,
  ImportOptions,
  ImageProcessingOptions,
  ResolvedInput,
  ProviderAdapter,
  ExtractedSection,
  ExtractionResult,
  FormatResult,
  TwoStageMetrics,
} from "./types";

// Type utilities
export { parseModelSpec, formatModelSpec } from "./types";

// Configuration
export { DEFAULT_IMPORT_MODEL, DEFAULT_FORMAT_MODEL, DEFAULT_JUDGE_MODEL, loadSchema, getApiKey, getApiKeyEnvVar } from "./config";

// Prompt (exported for transparency/debugging)
export { buildSystemPrompt } from "./prompt";

// Utilities (for consumers that need to convert Blobs)
export { blobToLoadedImage, arrayBufferToBase64, resolveInput } from "./utils";

// Image preprocessing
export { parsePreprocessOptions } from "./image-processing";
