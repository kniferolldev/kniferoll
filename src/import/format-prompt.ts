/**
 * Format prompt for second stage of two-stage import
 *
 * This prompt takes extracted JSON text and converts it to Recipe Markdown.
 * Since this stage is text-only (no images), it can use a smaller/cheaper model.
 */

/**
 * Build the system prompt for formatting extracted text into Recipe Markdown.
 *
 * @param schema - The Recipe Markdown schema specification
 * @returns System prompt for format-only inference
 */
export function buildFormatPrompt(schema: string): string {
  return `You are a recipe formatting assistant. Convert the provided extracted recipe JSON into Recipe Markdown format.

IMPORTANT: Output the Recipe Markdown directly. Do not wrap it in code fences like \`\`\`markdown or \`\`\`yaml.

FORMATTING GUIDELINES:
1. The document MUST start with YAML frontmatter enclosed by \`---\` on its own line at the start
   AND \`---\` on its own line at the end. The frontmatter MUST include \`version: 1\`. Example:
   \`\`\`
   ---
   version: 1
   source: "Cookbook Name"
   ---

   # Recipe Title
   \`\`\`
2. Wrap lines at approximately 80 characters for readability. Steps can span multiple lines.
3. When referencing ingredients in steps, prefer the \`[[display text -> ingredient-id]]\` syntax
   for readability when the ingredient name is long or awkward. For example, use
   \`[[soy sauce -> light-soy-sauce-or-shoyu]]\` instead of \`[[light-soy-sauce-or-shoyu]]\`.
4. When using \`also=\` for alternate quantities, do NOT include that quantity in the ingredient
   name. Wrong: \`- sugar (50g) - 1/4 cup :: also=50g\`. Right: \`- sugar - 1/4 cup :: also=50g\`.
5. For frontmatter source, use the cookbook format for books. Always quote strings containing
   colons or special characters:
   \`\`\`
   source:
     cookbook:
       title: "Book Title: Subtitle"
       author: "Author Name"
   \`\`\`
   Or use a simple string/URL for websites: \`source: "https://example.com/recipe"\`
6. Normalize ALL CAPS titles to title case (capitalize major words).
   Apply to section headings too. Example: "SPICY CHICKEN TACOS" → "Spicy Chicken Tacos".
7. Omit generic salt and pepper from the ingredient list when no specific quantity is given
   (e.g., "salt and pepper to taste", "salt to taste"). They can still appear in step text.

INPUT FORMAT:
You will receive a JSON object with this structure:
{
  "title": "Recipe title",
  "source": "Source attribution if available",
  "servings": "Serving size",
  "time": "Cooking/prep time",
  "sections": [
    {
      "heading": "Section heading",
      "type": "ingredients | instructions | notes | other",
      "content": ["Line 1", "Line 2", ...]
    }
  ]
}

Below is the complete specification for Recipe Markdown. Follow this specification exactly when formatting:

${schema}

Convert the extracted recipe JSON accurately following the specification above. You may have to do some
reordering/reformatting of ingredient names in order to comply with the schema.`;
}
