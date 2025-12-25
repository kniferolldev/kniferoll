/**
 * Configuration for recipe import
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";

/** Default model for recipe import */
export const DEFAULT_IMPORT_MODEL = "openai/gpt-5.1";

/** Cached schema content */
let cachedSchema: string | null = null;

/**
 * Load the Recipe Markdown schema from SCHEMA.md
 *
 * Results are cached after first load.
 * In browser environments, the schema should be passed explicitly
 * via ImportOptions.schema instead of using this function.
 *
 * @param projectRoot - Root directory containing SCHEMA.md. Defaults to cwd.
 * @returns Schema content
 */
export async function loadSchema(projectRoot?: string): Promise<string> {
  if (cachedSchema) return cachedSchema;

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
