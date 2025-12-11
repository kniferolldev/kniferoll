# kniferoll

A single-tag web component (`<kr-recipe>`) that renders Recipe Markdown offline in the browser.

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
