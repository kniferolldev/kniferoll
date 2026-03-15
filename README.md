# kniferoll

A single-tag web component (`<kr-recipe>`) that renders Kniferoll Markdown offline in the browser.

## Getting Started

### Basic Usage

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>My Recipe</title>
  <script type="module" src="kniferoll.min.js"></script>
</head>
<body>
  <kr-recipe>
# Pasta Aglio e Olio

## Ingredients
- spaghetti - 400 g
- garlic - 4 cloves, thinly sliced
- olive oil - 1/2 cup
- red pepper flakes - 1 tsp
- parsley - 1/4 cup, chopped

## Steps
1. Boil [[spaghetti]] @10m until al dente.
2. Sauté [[garlic]] in [[olive-oil]] until fragrant, about 2 minutes.
3. Add [[red-pepper-flakes]] and drained pasta.
4. Toss and garnish with [[parsley]].
  </kr-recipe>
</body>
</html>
```

**Note:** Distribution method (CDN, npm, self-hosted) is TBD. For now, build locally or use the demo server.

### Interactive Playground

Try the [interactive playground](http://127.0.0.1:5173/) (`bun run demo`) to:
- Edit recipes in real-time
- Customize appearance with CSS variables
- Test different layouts
- Export embed-ready HTML snippets

## API Reference

### Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| (content) | Markdown | Recipe content as child text or via `content` property |
| `scale` | number | Multiplicative scale factor (default: `1`) |
| `preset` | string \| number | Select frontmatter scale preset by name or index |
| `quantity-display` | `native` \| `metric` \| `imperial` | Which quantity representation to show |
| `layout` | `stacked` \| `two-column` \| `steps-left` \| `ingredients-left` \| `print-compact` | Layout mode |
| `diagnostics` | `off` \| `inline` \| `summary` \| `panel` | Diagnostics visibility (default: `summary`) |

### CSS Custom Properties

Customize appearance by setting CSS variables on the `<kr-recipe>` element:

```css
kr-recipe {
  /* Typography */
  --kr-font-family: 'Inter', system-ui, sans-serif;
  --kr-font-size-base: 1rem;
  --kr-line-height: 1.6;

  /* Colors */
  --kr-color-text: #1a1a1a;
  --kr-color-muted: #666;
  --kr-color-accent: #2563eb;
  --kr-color-surface: #fff;
  --kr-color-border: #e5e5e5;

  /* Spacing */
  --kr-section-gap: 2rem;
  --kr-header-gap: 1rem;
  --kr-item-gap: 0.5rem;

  /* Card */
  --kr-card-radius: 0.5rem;
  --kr-card-padding: 2rem;

  /* Chips */
  --kr-color-temperature: #dbeafe;
  --kr-color-temperature-text: #1e40af;
}
```

See the playground for a complete list of customizable properties.

## Examples

### Scaling Recipes

```html
<kr-recipe scale="2">
# Pancakes
## Ingredients
- flour - 1 cup
- milk - 1 cup
- eggs - 2
</kr-recipe>
```

Displays doubled quantities (2 cups flour, 2 cups milk, 4 eggs).

### Custom Layout

```html
<kr-recipe layout="two-column">
<!-- kniferoll markdown -->
</kr-recipe>
```

### Programmatic Content

```javascript
const recipe = document.querySelector('kr-recipe');
recipe.content = `
# Soup
## Ingredients
- broth - 4 cups
## Steps
1. Heat and serve.
`;
```

## Installation

```bash
bun install
```

## Build

Build production bundles:

```bash
bun run build
```

This creates:
- `dist/kniferoll.js` - Development bundle with inline source maps
- `dist/kniferoll.min.js` - Minified production bundle (~154 KB)

## Development

### CLI linter

```bash
bun run kr check recipes/granola.md
```

### Demo server

```bash
bun run demo
```

Then open:

- `http://127.0.0.1:5173/` - Interactive playground with live editing and theming
- `http://127.0.0.1:5173/minimal` - Minimal embed example (script tag + inline markdown)

### Testing

```bash
bun test                    # All tests
bun test src/core          # Core tests only
bun test tests/e2e         # E2E tests (requires browsers)
```

### Screenshots

```bash
bun run screenshot                  # Capture current playground state
bun run screenshot --all-layouts   # Capture all layout variants
```

---

This project uses [Bun](https://bun.com), a fast all-in-one JavaScript runtime.
