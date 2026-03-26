# Kniferoll Markdown

A structured Markdown format for recipes.

## Design Goals

**Preserve the recipe's voice.** A recipe reflects its author — their word
choices, their measurements, their way of explaining a technique. The format is
designed so that voice carries through intact, while making the recipe maximally
useful in the kitchen.

**Annotations, not transformations.** Structure is added through lightweight
markup that sits alongside the original text rather than replacing it. Wrapping
an ingredient name in `[[brackets]]` or tagging a temperature with `{350F}`
leaves the prose readable and minimally disrupted.

**Simple structure, powerful rendering.** The format imposes a fixed scaffold —
title, ingredients, steps, notes — which is a compromise on source fidelity, but
one that pays for itself: it enables lightweight, deterministic rendering with
scaling, unit conversion, and ingredient linking built in.

**LLM import, deterministic everything else.** Markdown is a natural fit: LLMs
are already fluent in it, so imports are more likely to be correct out of the
box — and it's still easy for people to read and edit by hand. Once a recipe is
in Kniferoll Markdown, everything downstream is deterministic. No LLM in the
loop, no non-determinism, no surprises.

**Cooking ergonomics.** The annotations exist to solve real problems at the
stove: seeing quantities in your preferred units, tracking which ingredients
matter for the current step, scaling a recipe up or down without mental math.

---

## 1) Recipe Structure

A file contains one or more recipes. Multiple recipes are intended for
subrecipes (e.g., cake & frosting or protein & sauce). If multiple recipe blocks
are present, the first recipe block is the main recipe. This is a recipe
format, not a cookbook format.

You may include an optional overall H1 at the very top (e.g.,
`# Chocolate Cake with Mocha Frosting`) to name the entire recipe. If omitted,
the first recipe's title will be used.

Each recipe starts with an H1 and contains section(s) denoted by an
H2 with the following names:

- Required: `## Ingredients`
- Required: `## Steps`
- Optional: `## Notes`

### Prose blocks

Optional free prose may appear in two places: between the recipe title (H1) and
the first section (H2) as **intro text**, and under `## Notes`. Both are
**prose blocks** — they support:

- Bold (`**text**`), italic (`*text*`), and links (`[text](url)`)
- Ingredient references (`[[name]]` or `[[display -> name]]`)
- Inline values (`{350F}`, `{3 cups}`)
- Multiple paragraphs (separated by blank lines)

Intro text is rendered before the recipe body and is useful for brief context,
headnotes, or attributions.

Section headers are case‑insensitive (e.g., `## ingredients`, `## INGREDIENTS`,
and `## Ingredients` are equivalent). Tools may ignore unknown section headers
under a recipe.

You may include multiple recipe blocks by repeating that structure with a new
H1.

---

## 2) Ingredients

### 2.1 Canonical line

```
- <name> [ " - " <quantity> ] [ ", " <modifiers> ] [ " :: " <attrs> ]
```

- **quantity**: optional, but required for recipe scaling. If quantity is
  unspecified, the ingredient won't scale (e.g., "salt, to taste").
- **name**: free text (e.g., "onion"). The ingredient's identity for
  cross-referencing is derived from this name.
- **modifiers**: free text (e.g., "finely diced").
- Attributes start with `::` (spaces required) and are optional.

### 2.2 Quantity

- **Single**: `amount [unit]`. Space is optional (e.g., `240g` is allowed).
- **Range**: `amount–amount [unit]` or `amount-amount [unit]` or
  `amount to amount [unit]` (en-dash, hyphen, or `to` are all accepted),
  e.g., `6–7 oz carrots`, `6-7 oz carrots`, or `6 to 7 oz carrots`.
- `amount`: integer (`6`) | decimal (`0.01`) | fraction (`1/2`) | mixed
  (`1 1/2`). Fraction characters (`½`) are also allowed.
- `unit`: free text. If it matches the unit lexicon (below), a renderer may
  use unit-aware behavior. Unknown units still scale numerically.
- **Compound**: `amount unit + amount unit`. Two single quantities joined by
  ` + ` (spaces required). Both parts must have units, and both must be in the
  same unit family (e.g., both volume or both mass). Each part scales
  independently. Example: `- water - 1 cup + 3 tbsp :: also=285g`.
- **Unit-only**: if a quantity consists only of a unit with no numeric amount
  (e.g., `pinch`, `dash`), it is treated as having an implied amount of `1`.

### 2.3 Attributes (after `::`)

Space-separated. Values MUST be quoted if they contain spaces. Prefer double
quotes (`"...`) for consistency.

- `noscale` — force non-scaling even if a quantity exists. Use sparingly: it is
  unnecessary for any ingredient without an explicit quantity, since those lines
  do not scale by definition.
- `also=<qty>` — **alternate quantity** (repeatable). The quantity on the
  ingredient line preserves the original recipe's measurement; `also=` provides
  alternates (typically volume↔mass conversions) without replacing it.
  Examples: `also=240g also=236ml`, `also="240–250 g"`, `also="1/2 cup"`.

### 2.4 Quantity do's and don'ts

- Quantity is a measurement only (amount and optional unit). Do not include
  commentary in the quantity field. Parentheticals like `(about ...)` or labels
  like `(optional)` should not be used in the quantity.
- Put commentary in the modifiers: `- baking soda - 1/2 tsp, optional`.
- Put alternative representations in attributes using `also=`. The quantity on the
  line is the original recipe's measurement; `also=` keeps it intact while
  making alternates available for display. For example,
  `- milk - 1 cup :: also="236 ml"`.
- Do not put alternate measurements in parentheses after the quantity.
  Wrong: `- flour - 2 cups (240g)`. Right: `- flour - 2 cups :: also=240g`.
- For incidental extras ("plus more for …"), keep the measured amount in the
  quantity and put the phrase in the modifiers: e.g.,
  `- olive oil - 1/4 cup, plus more for drizzling`. Only the measured part
  scales; the "plus more" note remains informational.

### 2.5 Units

Renderers support unit-aware display and conversion for standard metric and
imperial cooking units (g, oz, cups, liters, etc.) in both abbreviated and
spelled-out forms (tsp or teaspoon, lb or pound). Plurals are accepted.
Unknown units still scale numerically — don't restrict yourself to known units.

### 2.6 Ingredient examples

```
- milk - 1 cup :: also=240g also=236ml
- onion - 1 small :: also="100–150 g"
- garlic - 2-3 cloves
- olive oil - 1/4 cup, plus more for drizzling
- butter - 1 stick, plus more for buttering the pan
- neutral oil, for the pan
- parmesan - 30 g, for serving :: noscale
- whole tomatoes (28-oz can) - 1 :: also="794 g"
- baking soda - 1/2 tsp, optional
- frosting - 1 batch
- water - 1 cup + 3 tbsp :: also=285g
```

---

## 3) Steps

A numbered Markdown list (`1.`, `2.`, …). Free text with references and
inline values (see Section 4).

```
1. Preheat oven to {350F}.
2. Cream [[butter]] and [[sugar]]; beat in [[eggs]] one at a time.
3. Fold in [[flour]]. Pour into a greased pan and bake 25–30 minutes.
4. Cool in the pan 10 minutes, then turn out. Makes about {12} slices.
```

---

## 4) Markup

Steps and notes support two kinds of markup: references and inline values.

### 4.1 References

`[[ingredient name]]` links text to an ingredient in the current recipe,
enabling cooking ergonomics like highlighting and quantity display.

References are matched flexibly: case, spacing, hyphens, and punctuation
differences are all ignored. For example, `[[all-purpose flour]]`,
`[[All-Purpose Flour]]`, and `[[all-purpose-flour]]` all resolve to the same
ingredient.

Ingredient names are scoped to their recipe, so the same name can appear in
multiple subrecipes without conflict. Subrecipes are connected to ingredients
implicitly by name (e.g., an ingredient "Sauce" corresponds to a subrecipe
titled "# Sauce"), not by machine-linked IDs.

Use `[[display -> ingredient name]]` when the full ingredient name is too long
or awkward for step prose. The display text controls what appears in the rendered
step; the ingredient name (after `->`) is matched flexibly as described above.

Examples:
- `[[flour -> all-purpose flour]]` — step reads "flour", links to "all-purpose flour"
- `[[stock -> homemade chicken stock or store-bought broth]]`

#### Multi-ingredient references

Use commas after `->` to link one display word to multiple ingredients:

```
[[accompaniments -> kimchi, ginger scallion sauce, ssäm sauce, rice]]
```

This renders as "accompaniments" and highlights all four ingredients on
hover/click. Each name between commas is matched flexibly just like a
single-ingredient reference. Commas are only meaningful after `->` — they
have no special meaning in display text or bare `[[name]]` references.

Whitespace inside the brackets and around `->` is tolerated.

### 4.2 Inline values

Wrap a value in curly braces to mark it as an **inline value** that renderers
can adapt to user preferences.

**Temperatures**: `{350F}`, `{190C}`, `{63.3C}`, `{-18C}` — number immediately
followed by F or C (case-insensitive). Renderers may convert between F and C.

Do not write temperatures as prose with degree symbols or parenthetical
conversions. Wrong: `Bake at 350°F (175°C).` Right: `Bake at {350F}.`

**Scalable quantities**: `{20}`, `{3 cups}`, `{500ml}`, `{2-3 oz}` — amounts
that should change when the recipe scales. Syntax follows the same rules as
ingredient quantities (amount, fraction, range, optional unit).

**Alternates**: `{1 cup | 240g}`, `{1 cup + 3 tbsp | 285g}` — pipe-separated
alternates for unit-system-aware display. The first value is the native
quantity; subsequent values are alternates that renderers select based on
display mode (metric/imperial). At most one metric and one imperial
alternate. Temperatures do not support alternates.

#### When to use inline values

Tag quantities that should scale with the recipe and temperatures that should
convert between units.

**Do tag:**

- Yield counts: `This recipe makes about {20} meatballs.`
- Portion instructions: `Divide the dough into {4} equal portions.`
- Descriptive output quantities: `You should have about {3 cups} of sauce.`
- Temperatures: `Heat the oven to {350F}.` or `Sous vide at {63.3C}.`

**Don't tag:**

- Cooking times: "simmer for 30 minutes" — time doesn't change with batch size
- Cut sizes: "cut into 1-inch cubes" — piece dimensions are fixed
- Ratios or fractions of the whole: "add half the flour" — the fraction stays the same
- Sequence or repetition: "repeat 3 times", "in 2 batches"
- Equipment dimensions: "use a 12-inch skillet"

The rule of thumb: tag a value if it represents an *amount of stuff* that changes
when scaling (or a temperature that benefits from unit conversion). Don't tag
values that describe process, geometry, or time.

Disambiguation: `{3C}` → temperature (3°C). `{3 c}` → 3 cups (space before
unit). No space + F/C suffix = temperature.

---

## 5) Scaling

- A renderer computes a factor from a selected preset (or user input) and
  multiplies all scalable ingredient quantities by this factor.
- Lines without a quantity do not change. You do not need `noscale` on such
  lines; `noscale` is only for ingredients that have a quantity you explicitly
  want to lock.
- Lines with explicit `:: noscale` do not change.
- `also=` provides alternate representations that scale with the same factor.
  Most commonly used for volume↔mass conversions (e.g., converting cups of flour
  to grams). Examples: `- flour - 1 cup :: also=120g`,
  `- milk - 1 cup :: also=236ml`.
- Presets may be defined in frontmatter; see Frontmatter → `scales`.

---

## 6) Frontmatter (optional)

Frontmatter is optional. Only include it when it carries real metadata (source
attribution, scale presets). Do not add empty or version-only frontmatter — a
file beginning with `---\nversion: 1\n---` and nothing else adds no value.

If present, frontmatter must be the very first content in the file (opening
`---` on line 1) and must include a positive integer version.

```yaml
---
version: 1
source: Grandma
scales:
  - name: Family size
    anchor: oats
    amount: 900 g
---
```

- **version**: spec version for this file.
- **source** (optional): where this recipe comes from. Accepts:
  - simple string for freeform attribution (e.g., `"Grandma"`).
  - URL/web page object:
    `{ url: <string>, title?: <string>, accessed?: <YYYY-MM-DD> }`.
  - cookbook object:
    `{ title: <string>, author?: <string>, pages?: <number|string>, isbn?: <string>, year?: <number> }`.
    - `pages` may be a single page (e.g., `123`) or a range string (e.g.,
      `"123–125"`).
- **scales** (optional): named presets. Each preset names an **anchor**
  ingredient (the same way ingredients are referenced elsewhere) and a target
  **amount** (a quantity, e.g. `900 g`). When a preset is selected, renderers
  compute `factor = target / current` and scale all scalable ingredients in
  the file.

Frontmatter examples:

```yaml
---
version: 1
source: Grandma
---

---
version: 1
source: { url: "https://example.com/pancakes", title: "Perfect Pancakes", accessed: 2024-10-01 }
---

---
version: 1
source:
  cookbook:
    title: The Superiority Burger Cookbook
    author: Brooks Headley
    pages: "112–115"
---
```

---

## 7) End-to-end examples

### A) Single recipe

```markdown
---
version: 1
scales:
  - name: Family size
    anchor: milk
    amount: 480 ml
---

# Buttermilk Pancakes

Light, fluffy pancakes with a hint of tang. The secret is letting the batter
rest before cooking.

## Ingredients

- all-purpose flour - 180 g
- sugar - 1 tbsp
- baking powder - 2 tsp
- baking soda - 1/2 tsp
- salt - 1/2 tsp
- milk - 1 cup :: also=240g also=236ml
- egg - 1 large
- butter - 30 g, melted
- neutral oil, for the pan

## Steps

1. Whisk [[all-purpose flour]] with sugar, baking powder, baking soda, and salt.
2. Add milk and egg; rest 10 minutes.
3. Heat pan {375F}. Oil lightly. Cook 2–3 min/side.
```

### B) Multi-subrecipe

```markdown
---
version: 1
source:
  cookbook:
    title: The Hearthside Kitchen
    author: Marguerite Eldon
    pages: "88–91"
---

# Braised Short Ribs with Herbed Gremolata

Adapted from *The Hearthside Kitchen*. The overnight braise is worth the
wait — the meat should fall apart at the touch of a fork.

# Braised Short Ribs

## Ingredients

- bone-in short ribs - 4 lb :: also="1.8 kg"
- kosher salt - 1 tbsp
- black pepper - 1 tsp
- olive oil - 2 tbsp
- yellow onion - 2 medium, diced
- carrots - 3 medium, cut into 1-inch pieces
- celery - 2 stalks, sliced
- tomato paste - 2 tbsp
- dry red wine - 1 1/2 cups :: also="355 ml"
- beef stock - 2 cups :: also="475 ml"
- bay leaves - 2

## Steps

1. Season [[bone-in short ribs]] generously with [[kosher salt]] and [[black pepper]]. Let sit at room temperature 30 minutes.
2. Heat [[olive oil]] in a Dutch oven over high heat. Sear ribs on all sides until deeply browned, about 3 minutes per side. Remove and set aside.
3. Reduce heat to medium. Add [[yellow onion]], [[carrots]], and [[celery]]; cook until softened, 6 to 8 minutes. Stir in [[tomato paste]] and cook 1 minute.
4. Pour in [[dry red wine]], scraping up any browned bits. Simmer until reduced by half, about 5 minutes.
5. Add [[beef stock]] and [[bay leaves]]. Return ribs to the pot, nestling them into the liquid. Bring to a simmer.
6. Cover and transfer to a {300F} oven. Braise 3 to 3 1/2 hours until the meat is fork-tender.
7. Remove ribs. Strain the braising liquid, skim the fat, and reduce over medium heat until you have about {1 1/2 cups} of sauce. Season to taste.

## Notes

- You can braise a day ahead — the flavor improves overnight. Reheat at {325F} for 30 minutes.
- Short ribs vary in size; look for thick, meaty pieces about {6 oz} each.

# Herbed Gremolata

## Ingredients

- flat-leaf parsley - 1/2 cup, finely chopped :: also="25 g"
- lemon zest - 1 tbsp
- garlic - 2 cloves, minced
- fresh rosemary - 1 tsp, finely chopped
- olive oil - 1 tbsp

## Steps

1. Combine [[flat-leaf parsley]], [[lemon zest]], [[garlic]], and [[fresh rosemary]].
2. Toss with [[olive oil]] just before serving. Spoon over the [[braised short ribs -> Braised Short Ribs]].
```
