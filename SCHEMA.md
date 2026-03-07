# Recipe Markdown

A simple Markdown-based format for recipes.

## Philosophy

Human-machine collaboration. Based on Markdown, which is friendly for both
people and LLMs. Ingredient lines are segmented between mostly plain text
"human" parts (name, quantity, modifiers) with lightweight annotations at the
end past a delimiter (`::`). Other text markup is minimal and feels easy to edit
by hand.

File-oriented. Designed for one recipe per file. The format supports multiple
recipe sections to enable composite recipes (e.g., cake & frosting) and
cross-referencing between them, so everything in one logical unit fits in one
file without packaging. Works well in an Obsidian vault or similar.

Enables toolchains. Importers (photos/webpages), checkers (schema conformance
and common mistakes), and renderers (drop-in components with scaling).

Pragmatic scope. English-first control surface for now (headings, keywords, IDs,
and unit tokens), while content remains fully free-form/Unicode. Optimize the
80% case to be trivial and the 95% case to be possible; accept not reaching
100%. Avoid speculative features (`YAGNI`). Prefer sensible defaults that "just
work," with optional annotations for edge cases.

---

## 1) Minimal Example

A file with a single recipe and no frontmatter:

```markdown
# Tomato Pasta

## Ingredients

- pasta - 200 g
- olive oil - 2 tbsp
- garlic - 2–3 cloves
- whole tomatoes (14-oz can) - 1

## Steps

1. Heat oil; sauté [[garlic]].
2. Add tomatoes; simmer 15–20 minutes. Toss with [[pasta]].
```

---

## 2) Recipe Structure

A file contains **one or more recipes**. Multiple recipes are intended for
subrecipes (e.g., cake & frosting or protein & sauce). If multiple recipe blocks
are present, the first recipe block is the **main** recipe. This is a recipe
format, not a cookbook format.

You may include an optional **overall H1** at the very top (e.g.,
`# Chocolate Cake with Mocha Frosting`) to name the entire recipe. If omitted,
the first recipe's title will be used.

Each **recipe** starts with an **H1** and contains section(s) denoted by an
**H2** with the following names:

- Required: `## Ingredients`
- Required: `## Steps`
- Optional: `## Notes`

### Intro text

Optional prose may appear between the recipe title (H1) and the first section
(H2). This **intro text** is rendered before the recipe body and is useful for
brief context, headnotes, or attributions.

Intro text supports basic inline Markdown:
- Bold: `**text**`
- Italic: `*text*`
- Links: `[text](url)`

Multiple paragraphs are preserved (separated by blank lines).

Section headers are case‑insensitive (e.g., `## ingredients`, `## INGREDIENTS`,
and `## Ingredients` are equivalent). Tools may ignore unknown section headers
under a recipe.

You may include multiple recipe blocks by repeating that structure with a new
**H1**.

Example skeleton:

```markdown
# Chocolate Cake with Mocha Frosting

# Chocolate Cake

A rich, moist chocolate cake adapted from *The Joy of Cooking*.

## Ingredients

(ingredient list)

## Steps

(instructions)

## Notes

(optional notes)
```

---

## 3) Ingredients

### 3.1 Canonical line

```
- <name> [ " - " <quantity> ] [ ", " <modifiers> ] [ " :: " <attrs> ]
```

- **quantity**: optional, but required for recipe scaling. If quantity is
  unspecified, the ingredient won't scale (e.g., "salt, to taste").
- **name**: free text (e.g., "onion"). Ingredient ID is derived from this unless
  overridden in attrs.
- **modifiers**: free text (e.g., "finely diced").
- Attrs start with `::` (spaces required) and are optional.

### 3.2 Quantity

- **Single**: `amount [unit]`. Space is optional (e.g., `240g` is allowed).
- **Range**: `amount–amount [unit]` or `amount-amount [unit]` (en-dash or hyphen
  are both accepted), e.g., `6–7 oz carrots` or `6-7 oz carrots`.
  - **Note**: Don't use the word "to" for ranges (e.g., `4 to 5 cups`). Always use hyphen form (`4-5 cups`).
- `amount`: integer (`6`) | decimal (`0.01`) | fraction (`1/2`) | mixed
  (`1 1/2`). Fraction characters (`½`) are also allowed.
- `unit`: free text. If it matches the **unit lexicon** (below), a renderer may
  use unit-aware behavior. Unknown units still scale numerically.
- **Unit-only**: if a quantity consists only of a unit with no numeric amount
  (e.g., `pinch`, `dash`), it is treated as having an implied amount of `1`.

### 3.3 Tail attributes (after `::`)

Space-separated. Values MUST be quoted if they contain spaces. Prefer double
quotes (`"...") for consistency.

- `id=<slug>` — override the auto-derived ingredient ID.
- `noscale` — force non-scaling even if a quantity exists. Use sparingly: it is
  unnecessary for any ingredient without an explicit quantity, since those lines
  do not scale by definition.
- `also=<qty>` — **alternate quantity** (repeatable). Examples:
  `also=240g also=236ml`, `also="240–250 g"`, `also="1/2 cup"`.

### 3.4 Tail delimiter and escaping

- Tail attrs delimiter is `::` (spaces required on both sides).
- If you need a literal `::` in a name, write it without surrounding spaces
  (`salt::smoked`) or escape the colon (`\::`).

### 3.5 Quantity do's and don'ts

- Quantity is a measurement only (amount and optional unit). Do not include
  commentary in the quantity field. Parentheticals like `(about ...)` or labels
  like `(optional)` should not be used in the quantity.
- Put commentary in the modifiers: `- baking soda - 1/2 tsp, optional`.
- Put alternative representations in attrs using `also=`: e.g.,
  `- milk - 1 cup :: also="236 ml"`.
- For incidental extras ("plus more for …"), keep the measured amount in the
  quantity and put the phrase in the modifiers: e.g.,
  `- olive oil - 1/4 cup, plus more for drizzling`. Only the measured part
  scales; the "plus more" note remains informational.

### 3.6 Unit lexicon (for nicer behavior)

Renderers use this lexicon to enable unit-aware display and conversions while
keeping recipes readable without excessive attrs. It is pragmatic, not
exhaustive: common names and abbreviations are recognized; unknown units still
scale numerically.

Global normalization rules:

- Case-insensitive for multi-letter abbreviations (e.g., `tbsp` = `Tbsp`).
- Single-letter `t` and `T` remain distinct: `t` = teaspoon, `T` = tablespoon.
- Plurals accepted via trailing `s` (e.g., `cup`/`cups`, `qt`/`qts`).
- Periods in abbreviations are ignored (e.g., `tsp.` = `tsp`).
- For compound units like fluid ounces, spaces, hyphens, and periods are ignored
  (e.g., `fl oz`, `fl-oz`, `fl. oz.`, `floz`).
- American/British spellings of litre/liter are both acceptable for spelled-out
  names.

Mass:

- `g` — gram(s)
- `kg` — kilogram(s)
- `oz` — ounce(s)
- `lb` — pound(s)

Volume:

- `ml` — milliliter(s) / millilitre(s)
- `l` / `L` — liter(s) / litre(s)
- `dl` — deciliter(s) / decilitre(s)
- `cl` — centiliter(s) / centilitre(s)
- `tsp` — teaspoon(s); aliases: `t`
- `tbsp` — tablespoon(s); aliases: `T`, `tbls`
- `cup` — cup(s); alias: `c`
- `fl oz` — fluid ounce(s)
- `pt` — pint(s)
- `qt` — quart(s)
- `gal` — gallon(s)

### 3.7 Ingredient examples

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
```

---

## 4) Steps

A numbered Markdown list (`1.`, `2.`, …). Free text with optional markup.

### 4.1 References

- `[[id]]` or `[[display -> id]]` (must resolve to an existing ID in the file).
- The `id` portion is automatically normalized using `slug()` before lookup.
  This means `[[dried porcini mushrooms]]`, `[[Dried Porcini Mushrooms]]`, and
  `[[dried-porcini-mushrooms]]` all resolve to the same ingredient.
- Whitespace is tolerated inside the brackets and around the arrow, and the
  display may be quoted if it contains spaces. In steps, use them inline, e.g.:
  `3. Spread the [[ mustard ]] on the bread.`,
  `2. Slice the [["Japanese scallions"->tokyo-negi]] thinly`.

### 4.2 Inline values

Wrap a value in curly braces to mark it as an **inline value** the renderer
should process. Values are either temperatures or scalable quantities.

**Temperatures**: `{350F}`, `{190C}`, `{63.3C}`, `{-18C}` — number immediately
followed by F or C (case-insensitive). Renderers may convert between F and C.

**Scalable quantities**: `{20}`, `{3 cups}`, `{500ml}`, `{2-3 oz}` — anything
that isn't a temperature. Syntax follows the same rules as ingredient quantities
(amount, fraction, range, optional unit). These values scale by the same factor
as ingredient quantities.

Allowed in: steps, notes.

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

**Disambiguation**: `{3C}` → temperature (3°C). `{3 c}` → 3 cups (space before
unit). No space + F/C suffix = temperature.

**Example**

```
1. Whisk [[all-purpose-flour]] with sugar, baking powder, and salt.
2. Add milk and eggs; rest 10 minutes.
3. Bake at {350F} until golden, 30–35 minutes. Frost with [[frosting]].
```

---

## 5) IDs and References

The format supports IDs for cross-referencing within the file. The common case
works automatically with minimal boilerplate, with manual controls when needed.

`slug(text)` → lowercase; spaces → `-`; drop non `[a-z0-9-]`; collapse `-`;
trim.

### 5.1 Ingredient IDs

- Each ingredient line gets `id = slug(<name>)` unless overridden (see tail
  attributes).
- IDs are scoped to their recipe, so the same ingredient name can appear in
  multiple recipes without conflict.
- Subrecipes are connected to ingredients implicitly by name (e.g., an
  ingredient "Sauce" corresponds to a subrecipe titled "# Sauce"), not by
  machine-linked IDs.

### 5.2 Overriding ingredient IDs

- Add a tail attribute `:: id=<slug>` on that ingredient line when you need a
  specific ID.
- Redundant overrides should be omitted: if the supplied `id` equals
  `slug(<name>)`, do not include `id=`. Linters should warn on redundant `id=`
  attributes.

### 5.3 Reference tokens

- `[[id]]` — link to an ingredient in the current recipe.
- `[[display -> id]]` — show custom `display` text but link to `id`.
- The `id` portion is automatically normalized using `slug()` before lookup,
  making references more natural to write. For example:
  - `[[dried porcini mushrooms]]` normalizes to `dried-porcini-mushrooms`
  - `[[Extra Virgin Olive Oil]]` normalizes to `extra-virgin-olive-oil`
  - Both forms work identically; use whichever is easier to read and edit.
- Whitespace inside the brackets and around `->` is tolerated; the `display`
  part may be quoted.
- Allowed contexts: step text and notes. Not allowed in ingredient lines.

---

## 6) Scaling

- A renderer computes a **factor** from a selected preset (or user input) and
  multiplies all **scalable** ingredient quantities by this factor.
- Lines **without** a quantity do not change. You do not need `noscale` on such
  lines; `noscale` is only for ingredients that have a quantity you explicitly
  want to lock.
- Lines with explicit `:: noscale` do not change.
- `also=` provides alternate representations that scale with the same factor.
  Most commonly used for volume↔mass conversions (e.g., converting cups of flour
  to grams). Examples: `- flour - 1 cup :: also=120g`,
  `- milk - 1 cup :: also=236ml`.
- Presets may be defined in frontmatter; see Frontmatter → `scales`.

---

## 7) Frontmatter (optional)

If present, frontmatter **must** include a positive integer version.

```yaml
---
version: 1
source: Grandma
scales:
  - name: Family size
    anchor: { id: oats, amount: 900, unit: g }   # applies to the whole file
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
- **scales** (optional): named presets. Each preset supplies an **anchor** (an
  ingredient `id` plus a target `amount` + `unit`). When a preset is selected,
  renderers compute `factor = target / current` and scale **all scalable
  ingredients in the file**.

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

## 8) End-to-end examples

### A) Single recipe

```markdown
---
version: 1
scales:
  - name: Family size
    anchor: { id: milk, amount: 480, unit: ml }
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

1. Whisk [[all-purpose-flour]] with sugar, baking powder, baking soda, and salt.
2. Add milk and egg; rest 10 minutes.
3. Heat pan {375F}. Oil lightly. Cook 2–3 min/side.
```

### B) Overall title + two recipes

```markdown
---
version: 1
source: { url: "https://nothingbutcake.com/" }
scales:
  - name: Party
    anchor: { id: powdered-sugar, amount: 450, unit: g }
---

# Chocolate Cake with Mocha Frosting

# Chocolate Cake

## Ingredients

- cake flour - 180 g
- cocoa powder - 50 g
- sugar - 200 g
- baking powder - 1 1/2 tsp
- salt - 1/2 tsp
- eggs - 2
- milk - 240 ml :: also=1cup
- butter - 115 g, melted
- frosting - 1 batch

## Steps

1. Mix dry; add eggs, milk, butter.
2. Bake at {350F} for 30–35 minutes; cool. Top with [[frosting]].

# Frosting

## Ingredients

- powdered sugar - 225 g
- butter - 115 g, softened
- vanilla extract - 1 tsp
- salt - 1/8 tsp

## Steps

1. Beat butter; add sugar and salt; add vanilla.
```
