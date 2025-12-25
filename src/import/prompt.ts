/**
 * System prompt for recipe import - SINGLE SOURCE OF TRUTH
 *
 * This is the only place the recipe extraction prompt is defined.
 * Both the web importer and CLI tools use this.
 */

/**
 * Build the system prompt for recipe extraction.
 *
 * @param schema - The Recipe Markdown schema specification
 * @returns Complete system prompt for the LLM
 */
export function buildSystemPrompt(schema: string): string {
  return `You are a recipe extraction assistant. Convert the provided recipe content into Recipe Markdown format.

Below is the complete specification for Recipe Markdown. Follow this specification exactly when extracting recipes:

${schema}

Extract the recipe accurately following the specification above. You may have to do some reordering/reformatting
of ingredient names in order to comply with the schema.`;
}
