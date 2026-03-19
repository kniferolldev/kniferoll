/**
 * Configuration for recipe import
 *
 * Workers-safe: no top-level Node imports. `loadSchema()` uses dynamic
 * `await import()` for `node:fs` / `node:path` so the worker (which
 * always passes `schema` explicitly) never triggers the import.
 */

// Re-export browser-safe constants
export { DEFAULT_IMPORT_MODEL } from "./constants";

/** Default model for formatting stage (text-only, can be smaller/cheaper) */
export const DEFAULT_FORMAT_MODEL = "google/gemini-3-flash-preview";

/** Cached schema content */
let cachedSchema: string | null = null;

/**
 * Load the Kniferoll Markdown schema from SCHEMA.md
 *
 * Results are cached after first load.
 * In browser/worker environments, the schema should be passed explicitly
 * via ImportOptions.schema instead of using this function.
 *
 * @param projectRoot - Root directory containing SCHEMA.md. Defaults to cwd.
 * @returns Schema content
 */
export async function loadSchema(projectRoot?: string): Promise<string> {
  if (cachedSchema) return cachedSchema;

  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");

  const root = projectRoot ?? process.cwd();
  const schemaPath = join(root, "SCHEMA.md");

  try {
    cachedSchema = await readFile(schemaPath, "utf-8");
    return cachedSchema;
  } catch (error) {
    throw new Error(
      `Failed to load SCHEMA.md from ${schemaPath}: ${error instanceof Error ? error.message : error}`
    );
  }
}

/**
 * Clear the cached schema (useful for testing)
 */
export function clearSchemaCache(): void {
  cachedSchema = null;
}

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
