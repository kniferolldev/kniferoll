/**
 * Shared filesystem and string utilities
 */

import { stat } from "node:fs/promises";

/**
 * Check if a file or directory exists at the given path.
 */
export async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Convert a string to a URL-friendly slug.
 * - Lowercases the text
 * - Removes apostrophes
 * - Replaces non-alphanumeric characters with hyphens
 * - Removes leading/trailing hyphens
 * - Limits length to 60 characters
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .substring(0, 60);
}
