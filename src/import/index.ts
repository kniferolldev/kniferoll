/**
 * Recipe Import Module
 *
 * Unified infrastructure for importing recipes from text or images
 * using LLMs. Uses Google Gemini via raw HTTP (no SDK dependencies).
 *
 * Works in Node, Bun, and Cloudflare Workers. In Workers, pass
 * `schema` and `apiKeys` explicitly (no filesystem / process.env).
 *
 * @example
 * import { importRecipe } from "./import";
 *
 * // Import from text
 * const result = await importRecipe({ text: "1 cup flour..." });
 * console.log(result.markdown);
 *
 * @example
 * // Import from images (CLI)
 * const result = await importRecipe({
 *   images: [{ kind: "lazy", path: "recipe.jpg" }]
 * });
 *
 * @example
 * // Import in a Worker
 * const result = await importRecipe(
 *   { text: htmlContent },
 *   { apiKeys: { google: env.GEMINI_API_KEY }, schema: env.SCHEMA_MD },
 * );
 */

// Main functions
export { importRecipe, extractRecipe, extractRecipeFromText, formatRecipe, importRecipeTwoStage } from "./infer";

// Image rotation
export { rotateImage } from "./rotate";
export type { RotationAngle } from "./rotate";

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
export { DEFAULT_IMPORT_MODEL, DEFAULT_FORMAT_MODEL, loadSchema, getApiKey, getApiKeyEnvVar } from "./config";

// Browser-safe helpers
export { getProviderDisplayName, getProviderApiKeyUrl } from "./constants";

// Prompts (exported for transparency/debugging)
export { buildFormatPrompt } from "./format-prompt";
export { buildTextExtractionPrompt } from "./text-extract-prompt";

// Utilities (for consumers that need to convert Blobs)
export { blobToLoadedImage, arrayBufferToBase64, resolveInput } from "./utils";

// LLM call wrapper (for consumers that need direct provider access)
export { callLlm } from "./call-llm";
export type { CallLlmContent, CallLlmApiKeys } from "./call-llm";
