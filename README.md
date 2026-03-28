<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="logo/logo-white.svg">
    <img src="logo/logo-black.svg" alt="Kniferoll" width="120">
  </picture>
</p>

# Kniferoll

A structured markdown format for recipes — parser, web component, and import engine.

## Quick Start

Drop a single script tag, then write your recipe:

```html
<script type="module" src="https://kniferoll.dev/kr@1.js"></script>

<kr-recipe>
# Pasta Aglio e Olio

## Ingredients
- spaghetti - 400 g
- garlic - 4 cloves, thinly sliced
- olive oil - 1/2 cup
- red pepper flakes - 1 tsp
- parsley - 1/4 cup, chopped

## Steps
1. Boil [[spaghetti]] in salted water until al dente.
2. Sauté [[garlic]] in [[olive-oil]] over medium-low heat until golden.
3. Add [[red-pepper-flakes]] and toss with drained pasta.
4. Finish with [[parsley]] and a splash of pasta water.
</kr-recipe>
```

That's it. No build step, no framework, no dependencies.

## What You Get

- **Scaling** — Click to scale recipes up or down. Quantities update everywhere.
- **Unit conversion** — Toggle between metric and imperial.
- **Ingredient linking** — References in steps highlight the corresponding ingredient.
- **Inline editing** — Click any ingredient or step to edit in place.
- **Theming** — CSS custom properties for full visual control.
- **Five layouts** — Stacked, two-column, steps-left, ingredients-left, print-compact.
- **Diagnostics** — Parser warnings shown inline to help fix formatting issues.

## The Format

Kniferoll Markdown is designed to be readable as plain text while enabling rich rendering. See [SCHEMA.md](SCHEMA.md) for the full specification.

Key syntax:
- `- ingredient - quantity unit, modifier :: attribute` for ingredients
- `[[ingredient-id]]` to reference ingredients in steps
- `{350F}` or `{1 cup | 240ml}` for inline temperatures and quantities
- YAML frontmatter for metadata, source attribution, and scale presets

## Programmatic Use

```bash
bun add kniferoll
```

```typescript
// Parse a recipe
import { parseDocument } from "kniferoll/core";
const result = parseDocument(markdown);

// Import from text or images via LLM
import { importRecipe } from "kniferoll/import";
const result = await importRecipe({ text: html }, { apiKeys: { google: key } });

// Register the web component
import "kniferoll/component";
```

## CLI

```bash
bun run kr check recipe.md     # Lint a recipe
bun run kr import recipe.jpg   # Import from image via LLM
bun run kr eval                # Run import quality evaluations
```

## Development

```bash
bun install          # Install dependencies
bun test             # Run tests
bun run build        # Build dist/kniferoll.js and dist/kniferoll.min.js
bun run typecheck    # TypeScript checking
```

## CSS Custom Properties

Style the component to match your site:

```css
kr-recipe {
  --kr-font-family: 'Inter', system-ui, sans-serif;
  --kr-color-text: #1a1a1a;
  --kr-color-accent: #2563eb;
  --kr-color-surface: #fff;
  --kr-card-radius: 0.5rem;
  --kr-card-padding: 2rem;
}
```

## License

MIT
