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

IMPORTANT: Output the Recipe Markdown directly. Do not wrap it in code fences like \`\`\`markdown or \`\`\`yaml.

FORMATTING GUIDELINES:
1. Wrap lines at approximately 80 characters for readability. Steps can span multiple lines.
2. When referencing ingredients in steps, prefer the \`[[display text -> ingredient-id]]\` syntax
   for readability when the ingredient name is long or awkward. For example, use
   \`[[soy sauce -> light-soy-sauce-or-shoyu]]\` instead of \`[[light-soy-sauce-or-shoyu]]\`.
3. When using \`also=\` for alternate quantities, do NOT include that quantity in the ingredient
   name. Wrong: \`- sugar (50g) - 1/4 cup :: also=50g\`. Right: \`- sugar - 1/4 cup :: also=50g\`.
4. For frontmatter source, use the cookbook format for books. Always quote strings containing
   colons or special characters:
   \`\`\`
   source:
     cookbook:
       title: "Book Title: Subtitle"
       author: "Author Name"
   \`\`\`
   Or use a simple string/URL for websites: \`source: "https://example.com/recipe"\`

Below is the complete specification for Recipe Markdown. Follow this specification exactly when extracting recipes:

${schema}

Extract the recipe accurately following the specification above. You may have to do some reordering/reformatting
of ingredient names in order to comply with the schema.`;
}
