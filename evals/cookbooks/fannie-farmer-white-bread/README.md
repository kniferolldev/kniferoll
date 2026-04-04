# Fannie Farmer White Bread — Image Eval Case

Source: *The Boston Cooking-School Cook Book* by Fannie Merritt Farmer, 1896.
Public domain. Full text available at Project Gutenberg.

This case tests import from cookbook page photos — the most challenging modality
because it requires OCR, handling of narrow columns, line/column break reconstruction,
and rotation correction.

## Adding images

This case needs 1–2 photos of the recipe as it would appear in a cookbook, simulating
the kind of smartphone snapshot someone would take to capture a recipe. Generate them
using an image generation model with the prompts below, or photograph an actual copy
of the book.

### Prompt: single cookbook page photo

```
Photograph of an open vintage cookbook lying flat on a light wooden kitchen counter,
taken from slightly above with a smartphone. The visible page shows a bread recipe:
the recipe title is in bold at the top, followed by a short headnote paragraph, then
an ingredient list with quantities aligned on the left, then numbered method steps.
The typeface is classic early-20th-century serif printing. Slight page curl at the
spine. Natural window light from one side casting a gentle shadow. The photo is
slightly off-center as if captured quickly — casual snapshot quality, not a studio
shot. Sharp enough to read the text clearly.
```

### Prompt: simulating rotation / angle challenge

```
Smartphone photo of an open cookbook page taken at a roughly 15-degree clockwise
tilt — the book is sitting on a counter and the phone wasn't held perfectly level.
The page shows a classic bread recipe with title, ingredients, and numbered steps
in early-20th-century serif type. Natural overhead kitchen lighting. The full page
is visible but rotated in the frame. Sharp enough to read.
```

### Prompt: handwritten recipe card variation

```
Smartphone photo of a 4x6 index card handwritten with a recipe, placed on a
kitchen counter. The card is oriented normally but the photo is taken from a
slight angle. Handwriting in blue ballpoint pen: recipe title at top underlined,
ingredients list with quantities on the left, then steps written in paragraph form.
The handwriting is casual but legible — real person's handwriting, not calligraphy.
Natural afternoon light. Minor lens distortion from a phone camera.
```

## Recipe text (for writing golden.md)

From Fannie Farmer, 1896 — public domain:

**White Bread**

Scald one cup milk, add one-half tablespoon butter, one-half tablespoon sugar,
one teaspoon salt, and let cool to lukewarm. Dissolve one-third yeast cake in
one-half cup lukewarm water, and add to milk mixture; then add three and one-half
cups sifted flour. Knead on a floured board until smooth and elastic, about eight
minutes. Put in a greased bowl, cover, and let rise until doubled in bulk, about
two hours. Shape into a loaf, place in greased bread pan, cover, and let rise again
until light, about one hour. Bake in a hot oven (400°F) thirty to thirty-five minutes.
Makes one loaf.

## Files needed

- `image1.jpg` — at least one cookbook/recipe page photo
- `golden.md` — hand-edited expected Kniferoll Markdown output (write after reviewing image)
