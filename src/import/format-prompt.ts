/**
 * Format prompt for converting recipe content into Kniferoll Markdown.
 *
 * This is the single formatting prompt used by all import paths
 * (images, URL, plain text). The input may be structured JSON from
 * the extraction stage or raw text/HTML — the model handles both.
 */

/**
 * Build the system prompt for formatting recipe content into Kniferoll Markdown.
 *
 * @param schema - The Kniferoll Markdown schema specification
 * @returns System prompt for formatting inference
 */
export function buildFormatPrompt(schema: string): string {
  return `You are a recipe formatting assistant. Convert the provided recipe content into Kniferoll Markdown format.

IMPORTANT: Output the Kniferoll Markdown directly. Do not wrap it in code fences like \`\`\`markdown or \`\`\`yaml.

CONVERSION GUIDELINES:
1. Only include YAML frontmatter when there is real metadata (source attribution, scale presets).
   Do NOT add empty or version-only frontmatter.
2. Wrap lines at approximately 80 characters for readability. Steps can span multiple lines.
3. Normalize ALL CAPS titles to title case (capitalize major words).
   Apply to section headings too. Example: "SPICY CHICKEN TACOS" → "Spicy Chicken Tacos".
4. When the source recipe gives a parenthetical alternate quantity, move it to \`also=\`.
   The original measurement stays in the quantity; the alternate goes to \`also=\`.
   Example: source says "1/2 stick (4 tablespoons) butter" →
   \`- butter - 1/2 stick :: also="4 tbsp"\`.
5. Do NOT tag times or durations with \`{}\`. Only temperatures and scalable amounts get
   curly-brace markup. Wrong: \`rest for {1 hour}\`. Right: \`rest for 1 hour\`.
6. Use natural ingredient names in references — \`[[butter]]\`,
   \`[[all-purpose flour]]\`, not slugified forms like \`[[all-purpose-flour]]\`.
   The reference matching is flexible with case, spacing, and punctuation.

Below is the complete specification for Kniferoll Markdown. Follow this specification exactly when formatting:

${schema}

Convert the recipe content accurately following the specification above. You may have to do some
reordering/reformatting of ingredient names in order to comply with the schema.`;
}
