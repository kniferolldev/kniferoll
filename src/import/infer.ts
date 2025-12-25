/**
 * Main inference orchestration for recipe import
 */

import type { InferenceInput, ImportResult, ImportOptions } from "./types";
import { parseModelSpec, formatModelSpec } from "./types";
import { DEFAULT_IMPORT_MODEL, loadSchema, getApiKey, getApiKeyEnvVar } from "./config";
import { buildSystemPrompt } from "./prompt";
import { resolveInput } from "./utils";
import { getProvider } from "./providers";

/**
 * Import a recipe from text or images.
 *
 * This is the main entry point for all recipe import operations.
 * Works in both browser and CLI environments.
 *
 * @param input - Text or images to extract recipe from
 * @param options - Model, API key, and schema overrides
 * @returns Generated Recipe Markdown and model used
 *
 * @example
 * // With text
 * const result = await importRecipe({ text: "1 cup flour..." });
 *
 * @example
 * // With images (CLI)
 * const result = await importRecipe({
 *   images: [{ kind: "lazy", path: "recipe.jpg" }]
 * });
 *
 * @example
 * // With images (browser)
 * const result = await importRecipe({
 *   images: [{ kind: "loaded", data: arrayBuffer, mimeType: "image/jpeg" }]
 * });
 */
export async function importRecipe(
  input: InferenceInput,
  options?: ImportOptions
): Promise<ImportResult> {
  // Parse model specification
  const modelString = options?.model ?? DEFAULT_IMPORT_MODEL;
  const modelSpec = parseModelSpec(modelString);
  if (!modelSpec) {
    throw new Error(
      `Invalid model format: "${modelString}". Expected format: <provider>/<model> (e.g., openai/gpt-4o)`
    );
  }

  // Get API key
  const apiKey = options?.apiKey ?? getApiKey(modelSpec.provider);
  if (!apiKey) {
    const envVar = getApiKeyEnvVar(modelSpec.provider);
    throw new Error(
      `${envVar} environment variable is not set.\nSet it with: export ${envVar}=your-key-here`
    );
  }

  // Get schema
  const schema = options?.schema ?? (await loadSchema());

  // Build system prompt
  const systemPrompt = buildSystemPrompt(schema);

  // Resolve input (load lazy images)
  const resolvedInput = await resolveInput(input);

  // Validate we have something to process
  if (!resolvedInput.text && (!resolvedInput.images || resolvedInput.images.length === 0)) {
    throw new Error("No input provided (text or images required)");
  }

  // Get provider and run inference
  const provider = getProvider(modelSpec.provider);
  const markdown = await provider.infer({
    input: resolvedInput,
    systemPrompt,
    model: modelSpec.model,
    apiKey,
  });

  return {
    markdown,
    model: formatModelSpec(modelSpec),
  };
}
