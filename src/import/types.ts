/**
 * Type definitions for recipe import infrastructure
 */

// ============================================================================
// Model Specification
// ============================================================================

/** Supported LLM providers */
export type Provider = "anthropic" | "google" | "openai";

/** Parsed model specification like "openai/gpt-4o" */
export interface ModelSpec {
  provider: Provider;
  model: string;
}

/** Parse a model string like "openai/gpt-4o" into provider and model */
export function parseModelSpec(spec: string): ModelSpec | null {
  const slash = spec.indexOf("/");
  if (slash === -1) return null;

  const provider = spec.slice(0, slash);
  const model = spec.slice(slash + 1);

  if (provider !== "anthropic" && provider !== "google" && provider !== "openai") return null;
  if (!model) return null;

  return { provider, model };
}

/** Format a ModelSpec back to "provider/model" string */
export function formatModelSpec(spec: ModelSpec): string {
  return `${spec.provider}/${spec.model}`;
}

// ============================================================================
// Image Sources
// ============================================================================

/** Image that's already loaded into memory (browser Blobs, Node Buffers) */
export interface LoadedImage {
  kind: "loaded";
  data: ArrayBuffer;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}

/** Image to be loaded from a file path (CLI only) */
export interface LazyImage {
  kind: "lazy";
  path: string;
}

/** Image source - either already loaded or a path to load */
export type ImageSource = LoadedImage | LazyImage;

// ============================================================================
// Import Input/Output
// ============================================================================

/** Input for recipe import */
export interface InferenceInput {
  /** Text content (recipe text, OCR output, etc.) */
  text?: string;
  /** Images to extract recipe from */
  images?: ImageSource[];
}

/** Metrics captured during inference */
export interface InferenceMetrics {
  /** Wall clock time in milliseconds */
  durationMs: number;
  /** Input tokens (prompt + images) */
  inputTokens: number;
  /** Output tokens (generated response) */
  outputTokens: number;
}

/** Result from a provider's infer() call */
export interface InferenceResult {
  /** Generated text */
  text: string;
  /** Metrics from the inference */
  metrics: InferenceMetrics;
}

/** Result of recipe import */
export interface ImportResult {
  /** Generated Kniferoll Markdown */
  markdown: string;
  /** Model that was used, e.g. "openai/gpt-4o" */
  model: string;
  /** Metrics from the inference */
  metrics?: InferenceMetrics;
}

/** Extracted section from recipe image */
export interface ExtractedSection {
  heading?: string;
  type: "ingredients" | "instructions" | "notes" | "other";
  content: string[];
}

/** Result of text extraction (stage 1 of two-stage import) */
export interface ExtractionResult {
  /** Extracted structured data */
  extracted: {
    title?: string;
    source?: string;
    servings?: string;
    time?: string;
    sections: ExtractedSection[];
  };
  /** Raw JSON string from the model */
  rawJson: string;
  /** Model that was used */
  model: string;
  /** Metrics from the inference */
  metrics?: InferenceMetrics;
}

/** Result of formatting (stage 2 of two-stage import) */
export interface FormatResult {
  /** Generated Kniferoll Markdown */
  markdown: string;
  /** Model that was used */
  model: string;
  /** Metrics from the inference */
  metrics?: InferenceMetrics;
}

/** Combined metrics from two-stage import */
export interface TwoStageMetrics {
  /** Rotation detection metrics (if images were checked) */
  rotation?: InferenceMetrics;
  /** Stage 1 (extraction) metrics */
  extract: InferenceMetrics;
  /** Stage 2 (format) metrics */
  format: InferenceMetrics;
  /** Total duration (sum of all stages) */
  totalDurationMs: number;
  /** Total input tokens (sum of all stages) */
  totalInputTokens: number;
  /** Total output tokens (sum of all stages) */
  totalOutputTokens: number;
}

/** Options for importRecipe() */
export interface ImportOptions {
  /** Model to use, e.g. "openai/gpt-4o". Defaults to DEFAULT_IMPORT_MODEL */
  model?: string;
  /** API key. Defaults to environment variable based on provider */
  apiKey?: string;
  /** Schema content. Defaults to loading from SCHEMA.md */
  schema?: string;
}

// ============================================================================
// Provider Interface
// ============================================================================

/** Resolved input with all images loaded into memory */
export interface ResolvedInput {
  text?: string;
  images?: Array<Omit<LoadedImage, "kind">>;
}

/** Provider adapter interface */
export interface ProviderAdapter {
  readonly name: Provider;

  /** Run inference with this provider */
  infer(params: {
    input: ResolvedInput;
    systemPrompt: string;
    model: string;
    apiKey: string;
  }): Promise<InferenceResult>;
}
