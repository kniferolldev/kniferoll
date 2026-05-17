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

/** Result from a host-provided inference adapter. */
export interface InferenceAdapterResult {
  /** Generated text */
  text: string;
  /** Metrics from the inference, if surfaced by the host runtime */
  metrics?: InferenceMetrics;
  /** Model that actually handled the request, if known */
  model?: string;
  /** Provider finish reason, if surfaced by the adapter */
  finishReason?: string;
  /** Billing/accounting metadata, if surfaced by the host runtime */
  billing?: {
    unit: string;
    amount: number;
    correlationId?: string;
  };
  /** Adapter-specific diagnostics for logs/debugging */
  diagnostics?: Record<string, unknown>;
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
  /** Model to use, e.g. "google/gemini-3-flash-preview". Defaults to DEFAULT_IMPORT_MODEL */
  model?: string;
  /** Host-provided inference adapter. When present, Kniferoll does not resolve provider API keys. */
  inference?: InferenceAdapter;
  /** Abort signal propagated to the inference adapter. */
  signal?: AbortSignal;
  /** API key (single provider). Defaults to environment variable based on provider */
  apiKey?: string;
  /** API keys keyed by provider. Takes precedence over apiKey for matching provider */
  apiKeys?: Partial<Record<Provider, string>>;
  /** Schema content. Defaults to loading from SCHEMA.md */
  schema?: string;
  /** Progress callback, called at each pipeline stage boundary */
  onProgress?: (stage: string, detail?: string) => void;
  /** Callback for streaming progress during LLM calls */
  onStream?: StreamCallback;
}

// ============================================================================
// Streaming
// ============================================================================

/** Pipeline stage for streaming progress */
export type StreamStage = "rotating" | "extracting" | "formatting";

/** Provider-level stream event (no stage — the pipeline wrapper adds that) */
export interface ProviderStreamEvent {
  /** Output tokens generated so far */
  outputTokens: number;
  /** Characters of text generated so far */
  textLength: number;
  /** Elapsed time in milliseconds */
  elapsedMs: number;
  /** The full accumulated text so far */
  text: string;
}

/** Provider-level streaming callback */
export type ProviderStreamCallback = (event: ProviderStreamEvent) => void;

/** Progress event emitted during streaming inference */
export interface StreamEvent extends ProviderStreamEvent {
  /** Current pipeline stage */
  stage: StreamStage;
}

/** Callback for streaming progress updates (includes stage context) */
export type StreamCallback = (event: StreamEvent) => void;

// ============================================================================
// Inference Adapter Interface
// ============================================================================

/**
 * Semantic inference stage requested by Kniferoll.
 *
 * `rotation`, `extract`, and `format` are emitted by the import pipeline.
 * `doctor` is emitted by the low-level `callLlm` wrapper (used by external
 * doctor-handler workers); it is the default when no stage is supplied.
 */
export type InferenceStage = "rotation" | "extract" | "format" | "doctor";

/** Requested response shape for adapters that can constrain output. */
export type InferenceResponseFormat =
  | { type: "text" }
  | { type: "json"; schema?: unknown };

/** Host-provided model inference request. */
export interface InferenceAdapterRequest {
  /** Pipeline stage making the request. */
  stage: InferenceStage;
  /** Opaque model identifier or alias. Built-in providers expect provider/model strings; adapters may not. */
  model?: string;
  /** System/developer prompt authored by Kniferoll. */
  systemPrompt: string;
  /** Resolved text and image input for the model. */
  input: ResolvedInput;
  /** Optional response shape hint. */
  responseFormat?: InferenceResponseFormat;
  /** Caller cancellation signal. */
  signal?: AbortSignal;
}

/**
 * Host-provided inference implementation.
 *
 * When supplied via `ImportOptions.inference` (or `CallLlmOptions.inference`),
 * Kniferoll skips its own provider/API-key plumbing and delegates each model
 * call to the host. This lets embedding apps route through a managed AI gateway,
 * apply their own auth/billing, or substitute mocks in tests.
 *
 * Contract:
 * - `request.model` is the string Kniferoll would otherwise parse as
 *   `<provider>/<model>`. Adapters may treat it as an opaque alias.
 * - Returning `metrics` is optional; if omitted, `twoStageMetrics` will be
 *   undefined for that import.
 * - Streaming events (`onStream`) are not currently propagated to adapters.
 *   Use `onProgress` for stage-level UI updates instead.
 * - Implementations should respect `request.signal` for cancellation.
 */
export interface InferenceAdapter {
  infer(request: InferenceAdapterRequest): Promise<InferenceAdapterResult>;
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
    temperature?: number;
    /** Optional callback for streaming progress */
    onStream?: ProviderStreamCallback;
  }): Promise<InferenceResult>;
}
