/**
 * Prompts for recipe extraction via LLM
 */

export const RECIPE_EXTRACTION_PROMPT = `You are a recipe extraction assistant. Convert the provided recipe content into Recipe Markdown format.

Recipe Markdown format:
- Use # for recipe title
- Use ## Ingredients and ## Steps for sections
- Ingredients: "name - quantity unit" format (e.g., "flour - 2 cups")
- Steps: Numbered list with [[ingredient-references]], @timers, and °temperatures
- Include frontmatter with YAML metadata if helpful (yield, source, etc.)

Extract the recipe accurately. If the input is unclear, do your best and note issues in comments.`;
