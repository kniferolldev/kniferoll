/**
 * Main inference orchestration for recipe import
 */

import type { InferenceInput, ImportResult, ImportOptions, ExtractionResult, FormatResult, TwoStageMetrics, ResolvedInput, LoadedImage, InferenceMetrics } from "./types";
import { parseModelSpec, formatModelSpec } from "./types";
import { DEFAULT_IMPORT_MODEL, DEFAULT_FORMAT_MODEL, loadSchema, getApiKey, getApiKeyEnvVar } from "./config";
import { buildExtractionPrompt } from "./extract-prompt";
import { buildFormatPrompt } from "./format-prompt";
import { resolveInput } from "./utils";
import { getProvider } from "./providers";
import { decode, encode } from "jpeg-js";
import { buildRotationDetectionPrompt, ROTATION_DETECTION_MODEL, type RotationAngle } from "./rotation-prompt";

/**
 * Rotate a JPEG image by the specified angle (clockwise) using jpeg-js.
 */
function rotateImage(data: ArrayBuffer, angle: RotationAngle): ArrayBuffer {
  if (angle === 0) return data;

  const image = decode(new Uint8Array(data));
  const { width, height, data: pixels } = image;

  const swap = angle === 90 || angle === 270;
  const newWidth = swap ? height : width;
  const newHeight = swap ? width : height;
  const newPixels = Buffer.alloc(newWidth * newHeight * 4);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const srcIdx = (y * width + x) * 4;
      let dstX: number, dstY: number;
      if (angle === 90) { dstX = height - 1 - y; dstY = x; }
      else if (angle === 180) { dstX = width - 1 - x; dstY = height - 1 - y; }
      else { dstX = y; dstY = width - 1 - x; } // 270
      const dstIdx = (dstY * newWidth + dstX) * 4;
      newPixels[dstIdx] = pixels[srcIdx]!;
      newPixels[dstIdx + 1] = pixels[srcIdx + 1]!;
      newPixels[dstIdx + 2] = pixels[srcIdx + 2]!;
      newPixels[dstIdx + 3] = pixels[srcIdx + 3]!;
    }
  }

  const encoded = encode({ data: newPixels, width: newWidth, height: newHeight }, 80);
  return (encoded.data.buffer as ArrayBuffer).slice(
    encoded.data.byteOffset,
    encoded.data.byteOffset + encoded.data.byteLength,
  );
}

/**
 * Strip markdown code fences from a string.
 * Handles ```json, ```, and similar patterns.
 */
function stripCodeFences(text: string): string {
  let result = text.trim();
  // Remove opening fence (```json, ```JSON, ```, etc.)
  result = result.replace(/^```(?:json|JSON)?\s*\n?/, "");
  // Remove closing fence
  result = result.replace(/\n?```\s*$/, "");
  return result.trim();
}

/**
 * Detect if an image needs rotation and return the angle.
 * Returns 0, 90, 180, or 270 degrees clockwise.
 */
async function detectImageRotation(
  image: LoadedImage,
  apiKey: string
): Promise<{ angle: RotationAngle; metrics?: InferenceMetrics }> {
  const modelSpec = parseModelSpec(ROTATION_DETECTION_MODEL);
  if (!modelSpec) {
    throw new Error(`Invalid rotation detection model: ${ROTATION_DETECTION_MODEL}`);
  }

  const provider = getProvider(modelSpec.provider);
  const prompt = buildRotationDetectionPrompt();

  const result = await provider.infer({
    input: { images: [image] },
    systemPrompt: prompt,
    model: modelSpec.model,
    apiKey,
  });

  // Parse the response - should be just a number
  const text = result.text.trim();
  const angle = parseInt(text, 10);

  if (angle === 0 || angle === 90 || angle === 180 || angle === 270) {
    return { angle, metrics: result.metrics };
  }

  // Default to no rotation if we can't parse
  return { angle: 0, metrics: result.metrics };
}

/**
 * Detect and correct rotation for all images.
 * Returns corrected images and combined metrics.
 */
async function correctImageRotation(
  images: Array<Omit<LoadedImage, "kind">>,
  options?: ImportOptions
): Promise<{ images: Array<Omit<LoadedImage, "kind">>; metrics?: InferenceMetrics }> {
  // Get API key for rotation detection model
  const modelSpec = parseModelSpec(ROTATION_DETECTION_MODEL);
  if (!modelSpec) {
    throw new Error(`Invalid rotation detection model: ${ROTATION_DETECTION_MODEL}`);
  }

  const apiKey = options?.apiKey ?? getApiKey(modelSpec.provider);
  if (!apiKey) {
    const envVar = getApiKeyEnvVar(modelSpec.provider);
    throw new Error(
      `${envVar} environment variable is not set (needed for rotation detection).\nSet it with: export ${envVar}=your-key-here`
    );
  }

  const correctedImages: Array<Omit<LoadedImage, "kind">> = [];
  let totalDuration = 0;
  let totalInput = 0;
  let totalOutput = 0;

  for (const image of images) {
    const { angle, metrics } = await detectImageRotation({ kind: "loaded", ...image }, apiKey);

    if (metrics) {
      totalDuration += metrics.durationMs;
      totalInput += metrics.inputTokens;
      totalOutput += metrics.outputTokens;
    }

    if (angle === 0) {
      correctedImages.push(image);
    } else {
      const rotatedData = rotateImage(image.data, angle);
      correctedImages.push({
        ...image,
        data: rotatedData,
      });
    }
  }

  return {
    images: correctedImages,
    metrics: {
      durationMs: totalDuration,
      inputTokens: totalInput,
      outputTokens: totalOutput,
    },
  };
}

/**
 * Import a recipe from text or images.
 *
 * This is the main entry point for all recipe import operations.
 * Works in both browser and CLI environments.
 *
 * For image inputs, uses a two-stage pipeline:
 * - Stage 1: Extract text from images (vision model)
 * - Stage 2: Format extracted text into Kniferoll Markdown (text model)
 *
 * For text inputs, uses single-stage direct conversion.
 *
 * @param input - Text or images to extract recipe from
 * @param options - Model, API key, and schema overrides
 * @returns Generated Kniferoll Markdown and model used
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
  options?: ImportOptions & { formatModel?: string }
): Promise<ImportResult & { twoStageMetrics?: TwoStageMetrics; extractedJson?: string }> {
  // Check if we have images - use two-stage pipeline
  const hasImages = input.images && input.images.length > 0;
  const hasText = input.text && input.text.trim().length > 0;

  if (hasImages && !hasText) {
    // Image-only input: use two-stage pipeline
    return importRecipeTwoStage(input, options);
  }

  // Text input (or mixed): use single-stage direct conversion
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
  const systemPrompt = buildFormatPrompt(schema);

  // Resolve input (load lazy images)
  const resolvedInput = await resolveInput(input);

  // Validate we have something to process
  if (!resolvedInput.text && (!resolvedInput.images || resolvedInput.images.length === 0)) {
    throw new Error("No input provided (text or images required)");
  }

  // Get provider and run inference
  const provider = getProvider(modelSpec.provider);
  const result = await provider.infer({
    input: resolvedInput,
    systemPrompt,
    model: modelSpec.model,
    apiKey,
  });

  return {
    markdown: result.text,
    model: formatModelSpec(modelSpec),
    metrics: result.metrics,
  };
}

/**
 * Extract text from recipe images (stage 1 of two-stage import).
 *
 * This extracts the raw text content from images as structured JSON,
 * without converting to Kniferoll Markdown format.
 *
 * @param input - Images to extract text from
 * @param options - Model, API key, and preprocessing options
 * @returns Extracted structured data and metrics
 */
export async function extractRecipe(
  input: InferenceInput,
  options?: Omit<ImportOptions, "schema">
): Promise<ExtractionResult> {
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

  // Build extraction prompt
  const systemPrompt = buildExtractionPrompt();

  // Resolve input (load lazy images)
  const resolvedInput = await resolveInput(input);

  // Validate we have images
  if (!resolvedInput.images || resolvedInput.images.length === 0) {
    throw new Error("No images provided for extraction");
  }

  // Get provider and run inference
  const provider = getProvider(modelSpec.provider);
  const result = await provider.infer({
    input: resolvedInput,
    systemPrompt,
    model: modelSpec.model,
    apiKey,
  });

  // Strip code fences and parse the JSON response
  const cleanedJson = stripCodeFences(result.text);
  let extracted: ExtractionResult["extracted"];
  try {
    extracted = JSON.parse(cleanedJson);
  } catch {
    // If parsing fails, return a minimal structure with the raw text
    extracted = {
      sections: [{
        type: "other",
        content: [result.text],
      }],
    };
  }

  return {
    extracted,
    rawJson: cleanedJson,
    model: formatModelSpec(modelSpec),
    metrics: result.metrics,
  };
}

/**
 * Format extracted JSON into Kniferoll Markdown (stage 2 of two-stage import).
 *
 * This takes the structured JSON from extractRecipe() and converts it
 * to Kniferoll Markdown format. Since this is text-only, it can use a
 * smaller/cheaper model than extraction.
 *
 * @param extractedJson - JSON string from extraction stage
 * @param options - Model, API key, and schema options
 * @returns Formatted Kniferoll Markdown and metrics
 */
export async function formatRecipe(
  extractedJson: string,
  options?: ImportOptions
): Promise<FormatResult> {
  // Parse model specification - use format model by default
  const modelString = options?.model ?? DEFAULT_FORMAT_MODEL;
  const modelSpec = parseModelSpec(modelString);
  if (!modelSpec) {
    throw new Error(
      `Invalid model format: "${modelString}". Expected format: <provider>/<model> (e.g., openai/gpt-4o-mini)`
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

  // Build format prompt
  const systemPrompt = buildFormatPrompt(schema);

  // Get provider and run inference (text-only, no images)
  const provider = getProvider(modelSpec.provider);
  const result = await provider.infer({
    input: { text: extractedJson },
    systemPrompt,
    model: modelSpec.model,
    apiKey,
  });

  return {
    markdown: result.text,
    model: formatModelSpec(modelSpec),
    metrics: result.metrics,
  };
}

/**
 * Import a recipe using two-stage pipeline (extract → format).
 *
 * Stage 1: Extract text from images using vision model
 * Stage 2: Format extracted JSON into Kniferoll Markdown using text model
 *
 * @param input - Images to process
 * @param options - Options for both stages
 * @returns Import result with combined metrics
 */
export async function importRecipeTwoStage(
  input: InferenceInput,
  options?: ImportOptions & { formatModel?: string }
): Promise<ImportResult & { twoStageMetrics?: TwoStageMetrics; extractedJson?: string }> {
  // Resolve input first (load lazy images)
  const resolvedInput = await resolveInput(input);

  if (!resolvedInput.images || resolvedInput.images.length === 0) {
    throw new Error("No images provided for two-stage import");
  }

  // Stage 0: Rotation detection and correction
  const rotationResult = await correctImageRotation(resolvedInput.images, options);
  const correctedImages = rotationResult.images;

  // Stage 1: Extract (using corrected images)
  const extractResult = await extractRecipe(
    { images: correctedImages.map(img => ({ kind: "loaded" as const, ...img })) },
    options
  );

  // Stage 2: Format
  const formatOptions: ImportOptions = {
    ...options,
    model: options?.formatModel ?? DEFAULT_FORMAT_MODEL,
  };
  const formatResult = await formatRecipe(extractResult.rawJson, formatOptions);

  // Combine metrics (including rotation)
  let twoStageMetrics: TwoStageMetrics | undefined;
  if (extractResult.metrics && formatResult.metrics) {
    const rotationMs = rotationResult.metrics?.durationMs ?? 0;
    const rotationIn = rotationResult.metrics?.inputTokens ?? 0;
    const rotationOut = rotationResult.metrics?.outputTokens ?? 0;

    twoStageMetrics = {
      rotation: rotationResult.metrics,
      extract: extractResult.metrics,
      format: formatResult.metrics,
      totalDurationMs: rotationMs + extractResult.metrics.durationMs + formatResult.metrics.durationMs,
      totalInputTokens: rotationIn + extractResult.metrics.inputTokens + formatResult.metrics.inputTokens,
      totalOutputTokens: rotationOut + extractResult.metrics.outputTokens + formatResult.metrics.outputTokens,
    };
  }

  // Return combined result
  // Use extract model as primary since that's where the heavy lifting happens
  return {
    markdown: formatResult.markdown,
    model: extractResult.model,
    metrics: twoStageMetrics ? {
      durationMs: twoStageMetrics.totalDurationMs,
      inputTokens: twoStageMetrics.totalInputTokens,
      outputTokens: twoStageMetrics.totalOutputTokens,
    } : undefined,
    twoStageMetrics,
    extractedJson: extractResult.rawJson,
  };
}
