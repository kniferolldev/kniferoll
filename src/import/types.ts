/**
 * Minimal type definitions for recipe import
 */

export interface ImportInput {
  text?: string;
  images?: Blob[];
  url?: string;
}

/**
 * RecipeImporter function type - takes input and returns Recipe Markdown.
 *
 * Consumers implement this however they want - we don't prescribe how
 * to call LLMs, what format to use, or which provider to choose.
 *
 * @example
 * const myImporter: RecipeImporter = async (input) => {
 *   // Build messages, call your LLM, return markdown
 *   const response = await fetch(...);
 *   return response.markdown;
 * };
 */
export type RecipeImporter = (input: ImportInput) => Promise<string>;
