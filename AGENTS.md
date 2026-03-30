# Kniferoll — Agent Instructions

A structured markdown format for recipes, delivered as a `<kr-recipe>` web component.
One script tag, recipe in markdown, scaling and unit conversion for free.

## Quick Start

```html
<script type="module" src="https://kniferoll.dev/kr@1.js"></script>

<kr-recipe>
# Pasta Aglio e Olio

## Ingredients
- spaghetti - 1 lb :: also=450g
- garlic - 6 cloves
- olive oil - 1/2 cup :: also=120ml
- red pepper flakes - 1/2 tsp
- flat-leaf parsley - 1/4 cup, roughly chopped

## Steps
1. Slice [[garlic]] thinly. Sauté in [[olive oil]] over medium-low heat.
2. Cook [[spaghetti]] until al dente. Reserve {1 cup} pasta water.
3. Toss pasta with garlic oil and pasta water. Add [[red pepper flakes]].
4. Finish with [[flat-leaf parsley]].
</kr-recipe>
```

Or via package manager:

```bash
npm install @kniferoll/kniferoll
```

```js
import "@kniferoll/kniferoll"; // registers <kr-recipe> custom element
```

---

## Recipe Format

See [SCHEMA.md](SCHEMA.md) for the full specification (also exported from the npm package as `@kniferoll/kniferoll/SCHEMA.md`).

### Ingredient syntax

```
- <name> [ - <quantity> ] [ , <modifiers> ] [ :: <attributes> ]
```

Quantities: `2 cups`, `6-7 oz`, `1 cup + 3 tbsp`, `1/2`, `1 1/2`

Attributes (after `::`):
- `also=<qty>` — alternate unit (repeatable): `:: also=240g also=236ml`
- `noscale` — exempt from scaling
- `anchor` — variable-weight base ingredient for scale-by-ingredient mode
- `id="custom-id"` — override auto-derived ID

Examples:
```
- flour - 2 cups :: also=240g
- garlic - 2-3 cloves
- olive oil - 1/4 cup, plus more for drizzling
- salt, to taste
- parmesan - 30 g, for serving :: noscale
- green cabbage - 1000 g :: anchor
```

### References and inline values

In steps and notes:
```
[[ingredient name]]              — link to ingredient (highlights on click)
[[display -> ingredient name]]   — custom display text
[[display -> ing1, ing2, ing3]]  — link to multiple ingredients
{350F}                           — temperature (converts F↔C)
{3 cups}                         — scalable quantity
{3 cups | 720ml}                 — quantity with alternate
```

References match flexibly (case, spacing, hyphens ignored). Only tag amounts that change with scale — not times, dimensions, or ratios.

### Frontmatter

```yaml
---
version: 1
source: "Grandma"               # or: source: { cookbook: { title: ..., author: ... } }
yield: 4 servings                # scales with recipe
scales:
  - name: Double
    anchor: flour
    amount: 480 g
---
```

Multiple H1s in one document create subrecipes (e.g., cake + frosting).

---

## Component API

### HTML Attributes

| Attribute | Values | Default | Description |
|-----------|--------|---------|-------------|
| `scale` | Number | `1` | Scale factor (e.g., `2`, `0.5`) |
| `preset` | String or index | — | Activate a named scale preset from frontmatter |
| `quantity-display` | `native`, `metric`, `imperial` | `native` | Unit display preference |
| `temperature-display` | `F`, `C` | native | Temperature unit preference |
| `layout` | `stacked`, `two-column`, `steps-left`, `ingredients-left`, `print-compact` | `stacked` | Visual layout |
| `diagnostics` | `off`, `summary`, `panel`, `inline` | `summary` | Parser warning display |
| `no-scale` | boolean | — | Hide scale controls |
| `show-attributes` | boolean | — | Show `::` attributes in rendered output |

### JavaScript Properties and Methods

```js
const recipe = document.querySelector('kr-recipe');

recipe.content = markdownString;  // set/get markdown content
recipe.editable = true;           // enable inline click-to-edit
recipe.commitActiveEdit();        // commit current edit
recipe.refresh();                 // force re-render
```

### Events

```js
recipe.addEventListener('kr:content-change', (e) => {
  e.detail.markdown;  // updated markdown after inline edit
});

recipe.addEventListener('kr:scale-change', (e) => {
  e.detail.factor;  // number
  e.detail.mode;    // 'preset' | 'manual' | 'by-ingredient'
});

recipe.addEventListener('kr:step-focus', (e) => {
  e.detail.stepIndex;  // focused step index
});
```

---

## CSS Custom Properties

Set on `kr-recipe` or any ancestor. All optional — sensible defaults built in.

```css
kr-recipe {
  /* Typography */
  --kr-font-family: system-ui, -apple-system, sans-serif;
  --kr-font-size-base: 1rem;
  --kr-font-mono: monospace;          /* edit mode */
  --kr-line-height: 1.6;

  /* Colors */
  --kr-color-text: #1a1a1a;
  --kr-color-muted: #6b6b6b;         /* secondary text, borders */
  --kr-color-accent: #2563eb;        /* buttons, focus rings, active states */
  --kr-color-link: #0066cc;
  --kr-color-surface: #ffffff;       /* card/panel background */
  --kr-color-surface-hover: rgba(0,0,0,0.02);  /* step hover */
  --kr-color-border: rgba(0,0,0,0.08);
  --kr-color-quantity: #1a1a1a;      /* ingredient quantity text */
  --kr-color-warning: #d97706;       /* diagnostics */

  /* Inline value badges */
  --kr-color-badge: color-mix(in srgb, #3b82f6 12%, transparent);
  --kr-color-badge-text: #1d4ed8;
  --kr-color-temperature: rgba(234, 88, 12, 0.1);
  --kr-color-temperature-text: #c2410c;

  /* Interaction highlights */
  --kr-color-step-ingredient-highlight: rgba(250, 204, 21, 0.2);
  --kr-color-edit-hover: rgba(143, 174, 126, 0.1);

  /* Spacing & layout */
  --kr-card-radius: 1rem;
  --kr-card-padding: 1.5rem;
  --kr-section-gap: 1.75rem;
  --kr-header-gap: 0.75rem;
  --kr-item-gap: 0.375rem;          /* between ingredient rows */
}
```

### Dark theme example

```css
kr-recipe {
  --kr-color-text: #e5e5e5;
  --kr-color-muted: #9ca3af;
  --kr-color-accent: #60a5fa;
  --kr-color-surface: #1f1f1f;
  --kr-color-border: rgba(255,255,255,0.1);
}
```

---

## Important Constraints

- **Shadow DOM**: `<kr-recipe>` uses Shadow DOM. You cannot style its internals with external CSS selectors — use the custom properties above. External `querySelector` cannot reach inside; use `element.shadowRoot.querySelector(...)`.
- **Event retargeting**: Events that bubble out of the shadow root have `e.target` retargeted to the host element. Use `e.composedPath()[0]` to find the actual originating element inside the shadow tree.
- **Deterministic**: No LLM or network calls at runtime. Parsing, scaling, and rendering are pure functions of the markdown input.

## Links

- GitHub: https://github.com/kniferolldev/kniferoll
- Playground: https://kniferoll.dev
- npm: https://www.npmjs.com/package/@kniferoll/kniferoll
- Format spec: [SCHEMA.md](https://github.com/kniferolldev/kniferoll/blob/main/SCHEMA.md)
