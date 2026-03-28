/**
 * Filesystem-based schema loading (Node/Bun CLI only)
 *
 * Separated from config.ts so that browser/worker consumers of the import
 * barrel never pull in node:fs/promises or node:path through the module graph.
 */

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
