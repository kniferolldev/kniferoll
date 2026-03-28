# Kniferoll Development Guide

## What Is This

Kniferoll is a structured markdown format for recipes, plus the tools to work with it:

- **Kniferoll Markdown** — The format itself. Ingredients use a specific syntax for quantities, units, modifiers, and attributes. Steps contain inline references, temperatures, and scalable quantities. Documents have YAML frontmatter for metadata and scale presets. See `SCHEMA.md` for the full specification.
- **Parser + core** (`src/core/`) — Parses Kniferoll Markdown into a typed AST. Also handles scaling, formatting, unit conversion, and diffing. Zero DOM dependencies.
- **Web component** (`src/web/`) — `<kr-recipe>` custom element that renders recipes in the browser with Shadow DOM. Supports inline editing, scaling UI, diagnostics, and theming via CSS custom properties.
- **Import engine** (`src/import/`) — LLM-powered conversion of text, HTML, and images into Kniferoll Markdown. Multi-provider (Gemini, Anthropic, OpenAI). Two-stage pipeline: extraction then formatting.
- **Eval framework** (`src/eval/`) — Measures import quality by comparing LLM output against human-edited golden files.
- **CLI** (`src/commands/`) — `kr check`, `kr import`, `kr eval` commands.

## Architecture

```
src/
├── core/           Parsing, scaling, formatting, diffing (no DOM)
│   ├── parser.ts   Kniferoll Markdown → AST
│   ├── index.ts    Public API barrel export
│   └── ...         frontmatter, ingredients, quantity, units, scale, format, diff, slug
├── web/            <kr-recipe> web component
│   ├── component.ts   Main custom element (~2600 lines)
│   ├── edit.ts        Inline editing
│   ├── styles.css     Shadow DOM styles
│   └── index.ts       Public API barrel export
├── import/         LLM-powered import engine
│   ├── infer.ts    Main entry: importRecipe, extractRecipe, formatRecipe
│   ├── providers/  Anthropic, Google, OpenAI adapters
│   ├── index.ts    Public API barrel export
│   └── ...         prompts, types, utils
├── eval/           Import quality evaluation
├── commands/       CLI (check, import, eval)
└── utils/          Filesystem helpers

tests/
├── build/          Bundle build tests
└── e2e/            Playwright rendering tests

scripts/
├── build.ts        Produces dist/kniferoll.js and dist/kniferoll.min.js
└── screenshot.ts   Capture playground screenshots

recipes/            Example recipes in Kniferoll Markdown
```

### Module boundaries

- `src/core/` has zero DOM dependencies. It can run anywhere (Node, Bun, Workers, browser).
- `src/web/` depends on `src/core/` and the DOM. It imports core internals directly (not through the barrel).
- `src/import/` depends on `src/core/` types only. No DOM.
- `src/eval/` depends on `src/core/` and `src/import/`.
- External consumers should import from the barrel exports: `src/core/index.ts`, `src/import/index.ts`, `src/web/index.ts`.

## Key Commands

```bash
bun install                  # Install dependencies
bun run build                # Build distribution bundles
bun test                     # Run all tests
bun run typecheck            # TypeScript type checking
bun run kr check <file>      # Lint a kniferoll markdown file
bun run kr import <file>     # Import a recipe via LLM
bun run kr eval              # Run import quality evaluations
```

## Environment Variables

```
GEMINI_API_KEY=       # Default import model (Google Gemini)
ANTHROPIC_API_KEY=    # Alternative import model
OPENAI_API_KEY=       # Alternative import model
```

## Shadow DOM Gotchas (`src/web/`)

`<kr-recipe>` uses Shadow DOM. This has recurring implications:

- **Event retargeting**: Events that bubble out of the shadow root have their `e.target` retargeted to the host element. Use `e.composedPath()[0]` to find the actual originating element.
- **Keyboard handlers on the host**: `keydown`/`keyup` listeners on the host intercept keys from inputs inside the shadow root. Always check `composedPath()[0]` to skip when the real target is an `<input>` or `<textarea>`.
- **`querySelector` scope**: From outside the component, `querySelector` cannot reach into the shadow tree. Use `element.shadowRoot.querySelector(...)`.

## Testing

Tests use Bun's built-in test runner. E2E tests use Playwright with `linkedom` for DOM simulation.

```bash
bun test                     # All tests
bun test src/core            # Core parser/formatter tests only
bun test src/import          # Import engine tests
bun test tests/e2e           # E2E rendering tests
```

Prefer red/green TDD: write a failing test first, then implement.

## Build

The build script (`scripts/build.ts`) uses Bun's bundler to produce:
- `dist/kniferoll.js` — Development bundle with inline source maps (~640 KB)
- `dist/kniferoll.min.js` — Minified production bundle (~107 KB)

Entry point is `index.ts` at the repo root, which re-exports the web component. The bundle is self-contained with zero runtime dependencies.

## Pre-commit Verification

Before considering any task complete, run:

```bash
bun run typecheck
bun run build
bun test
```

## The Schema

`SCHEMA.md` is the canonical specification for Kniferoll Markdown. Read it before modifying the parser, import prompts, or web component rendering. Key concepts:

- **Ingredients**: `- name - quantity unit, modifier :: attribute`
- **References**: `[[ingredient-id]]` in steps links to an ingredient
- **Inline values**: `{350F}` or `{1 cup | 240ml}` for temperatures and scalable quantities in prose
- **Frontmatter**: YAML with `version`, `source`, `yield`, `scale_presets`
- **Attributes**: `:: noscale`, `:: also=100g`, `:: anchor` modify ingredient behavior
