import { extractFrontmatter } from "./frontmatter";
import { parseIngredientsSection } from "./ingredients";
import { slug } from "./slug";
import { extractInlineValues } from "./steps";
import type {
  DocumentInlineValueAny,
  DocumentInlineTemperatureValue,
  DocumentInlineQuantityValue,
  DocumentParseResult,
  DocumentTitle,
  Diagnostic,
  IngredientsSection,
  ParseOptions,
  Recipe,
  RecipeLink,
  SectionLine,
  TextBlock,
  ReferenceToken,
} from "./types";
import { lookupUnit, isMetric } from "./units";
import { createIdRegistry } from "./id-registry";

type SectionKind = "ingredients" | "steps" | "notes" | "unknown";

const SECTION_MAP: Record<string, SectionKind> = {
  ingredients: "ingredients",
  steps: "steps",
  notes: "notes",
};

const STEP_NUMBER_RE = /^\s*\d+\.\s+/;
const BULLET_RE = /^[-*]\s+/;
const NOTES_HEADER_RE = /^#{3,4}\s+/;

const error = (code: string, message: string, line: number): Diagnostic => ({
  code,
  message,
  severity: "error",
  line,
  column: 1,
});

const warning = (code: string, message: string, line: number): Diagnostic => ({
  code,
  message,
  severity: "warning",
  line,
  column: 1,
});

/** Resolve the source line number for a character offset within a reflowed SectionLine. */
const resolveLineAt = (line: Pick<SectionLine, "line" | "lineSpans">, offset: number): number => {
  if (!line.lineSpans) return line.line;
  let resolved = line.line;
  for (const [spanOffset, spanLine] of line.lineSpans) {
    if (spanOffset > offset) break;
    resolved = spanLine;
  }
  return resolved;
};

const isHeadingLine = (line: string): boolean => {
  const trimmed = line.trim();
  return /^#{1,6}\s+/.test(trimmed);
};

/**
 * Reflows step text by joining continuation lines.
 * All non-empty lines after a numbered step are joined to it until the next
 * numbered step or empty line. This allows steps to be wrapped at any column
 * in the source markdown.
 */
const unwrapStepLines = (lines: SectionLine[]): SectionLine[] => {
  const unwrapped: SectionLine[] = [];
  let current: SectionLine | null = null;

  for (const line of lines) {
    const raw = line.text;
    const trimmed = raw.trim();

    // Empty lines are preserved
    if (trimmed === "") {
      if (current) {
        unwrapped.push(current);
        current = null;
      }
      unwrapped.push({ text: "", content: "", line: line.line });
      continue;
    }

    // Check if this is a numbered step
    const stepMatch = STEP_NUMBER_RE.exec(raw);
    if (stepMatch) {
      // Save previous step if any
      if (current) {
        unwrapped.push(current);
      }
      const content = raw.slice(stepMatch[0].length);
      // Start new step
      current = { text: raw, content, line: line.line };
      continue;
    }

    // If there's a current step, join this line to it (reflow)
    if (current) {
      const spans: [number, number][] = current.lineSpans ?? [[0, current.line]];
      const newOffset = current.content.length + 1; // +1 for the joining space
      spans.push([newOffset, line.line]);
      current = {
        text: current.text + " " + trimmed,
        content: current.content + " " + trimmed,
        line: current.line, // Keep the line number of the step start
        lineSpans: spans,
      };
      continue;
    }

    // No current step - treat as standalone line (shouldn't happen often in well-formed steps)
    unwrapped.push({ text: raw, content: raw, line: line.line });
  }

  // Don't forget the last step if any
  if (current) {
    unwrapped.push(current);
  }

  return unwrapped;
};

/**
 * Classify a trimmed line and strip its prefix.
 * Used by unwrapTextBlocks for both intro and notes.
 */
const classifyLine = (
  text: string,
): { kind: TextBlock["kind"]; content: string; level?: number } => {
  const headerMatch = NOTES_HEADER_RE.exec(text);
  if (headerMatch) {
    const level = headerMatch[0].trim().length; // count # characters
    return { kind: "header", content: text.slice(headerMatch[0].length), level };
  }
  const bulletMatch = BULLET_RE.exec(text);
  if (bulletMatch) {
    return { kind: "ul-item", content: text.slice(bulletMatch[0].length) };
  }
  const stepMatch = STEP_NUMBER_RE.exec(text);
  if (stepMatch) {
    return { kind: "ol-item", content: text.slice(stepMatch[0].length) };
  }
  return { kind: "paragraph", content: text };
};

/**
 * Reflows free-text lines into structured TextBlocks.
 * Bullets (- or *), ordered list items (1.), and headers (### or ####)
 * start new blocks. Plain text continues the previous block.
 * Empty lines create paragraph breaks.
 *
 * Used for both intro and notes sections.
 */
const unwrapTextBlocks = (lines: SectionLine[]): TextBlock[] => {
  const blocks: TextBlock[] = [];
  let current: TextBlock | null = null;

  for (const line of lines) {
    const trimmed = line.text.trim();

    // Empty lines end the current block
    if (trimmed === "") {
      if (current) {
        blocks.push(current);
        current = null;
      }
      continue;
    }

    const classified = classifyLine(trimmed);

    // Headers are always standalone — flush and emit immediately
    if (classified.kind === "header") {
      if (current) {
        blocks.push(current);
        current = null;
      }
      blocks.push({
        kind: "header",
        text: trimmed,
        content: classified.content,
        line: line.line,
        level: classified.level,
      });
      continue;
    }

    // Bullets and ordered list items start a new block
    if (classified.kind === "ul-item" || classified.kind === "ol-item") {
      if (current) {
        blocks.push(current);
      }
      current = {
        kind: classified.kind,
        text: trimmed,
        content: classified.content,
        line: line.line,
      };
      continue;
    }

    // Continuation line — join to current block
    if (current) {
      const spans: [number, number][] = current.lineSpans ?? [[0, current.line]];
      const newOffset = current.content.length + 1; // +1 for the joining space
      spans.push([newOffset, line.line]);
      current = {
        ...current,
        text: current.text + " " + trimmed,
        content: current.content + " " + trimmed,
        lineSpans: spans,
      };
      continue;
    }

    // Start a new paragraph block
    current = {
      kind: "paragraph",
      text: trimmed,
      content: trimmed,
      line: line.line,
    };
  }

  if (current) {
    blocks.push(current);
  }

  return blocks;
};

const nextHeadingType = (lines: string[], fromIndex: number): "#" | "##" | null => {
  for (let i = fromIndex + 1; i < lines.length; i += 1) {
    const trimmed = lines[i]?.trim() ?? "";
    if (trimmed === "") {
      continue;
    }
    if (/^#\s+/.test(trimmed)) {
      return "#";
    }
    if (/^##\s+/.test(trimmed)) {
      return "##";
    }
    if (/^#/.test(trimmed)) {
      // Treat any other heading level (### etc.) as not an overall title.
      return null;
    }
  }
  return null;
};

interface RecipeParseState {
  title: string;
  id: string;
  line: number;
  introLines: SectionLine[];
  ingredientsSection: { title: string; line: number; lines: SectionLine[] } | null;
  stepsSection: { title: string; line: number; lines: SectionLine[] } | null;
  notesLines: SectionLine[];
  notesLine: number | null;
}

/** Which section we're currently collecting lines into */
type ActiveSection = "ingredients" | "steps" | "notes";

const finalizeRecipe = (
  current: RecipeParseState | null,
  diagnostics: Diagnostic[],
  out: Recipe[],
) => {
  if (!current) {
    return;
  }

  if (!current.ingredientsSection) {
    diagnostics.push(
      error(
        "E0101",
        `Recipe "${current.title}" is missing an Ingredients section.`,
        current.line,
      ),
    );
  }

  if (!current.stepsSection) {
    diagnostics.push(
      error(
        "E0101",
        `Recipe "${current.title}" is missing a Steps section.`,
        current.line,
      ),
    );
  }

  const ingredientsSection: IngredientsSection = current.ingredientsSection
    ? {
        title: current.ingredientsSection.title,
        line: current.ingredientsSection.line,
        ingredients: [],
      }
    : { title: "Ingredients", line: current.line, ingredients: [] };

  if (current.ingredientsSection) {
    parseIngredientsSection(ingredientsSection, diagnostics, current.ingredientsSection.lines);
  }

  out.push({
    title: current.title,
    id: current.id,
    line: current.line,
    intro: unwrapTextBlocks(current.introLines),
    introLines: current.introLines,
    ingredients: ingredientsSection,
    steps: current.stepsSection
      ? {
          title: current.stepsSection.title,
          line: current.stepsSection.line,
          lines: unwrapStepLines(current.stepsSection.lines),
        }
      : { title: "Steps", line: current.line, lines: [] },
    notes: unwrapTextBlocks(current.notesLines),
  });
};

export const parseDocument = (
  input: string,
  options: ParseOptions = {},
): DocumentParseResult => {
  const frontmatterResult = extractFrontmatter(input, options);
  const diagnostics = [...frontmatterResult.diagnostics];
  const recipes: Recipe[] = [];
  const references: ReferenceToken[] = [];
  const inlineValues: DocumentInlineValueAny[] = [];
  let documentTitle: DocumentTitle | null = null;

  const lines = frontmatterResult.body.split("\n");
  const lineOffset = frontmatterResult.bodyStartLine - 1;

  let currentRecipe: RecipeParseState | null = null;
  let activeSection: ActiveSection | null = null;

  /** Get the raw lines array for the currently active section */
  const getActiveLines = (): SectionLine[] | null => {
    if (!currentRecipe || !activeSection) return null;
    if (activeSection === "ingredients") return currentRecipe.ingredientsSection?.lines ?? null;
    if (activeSection === "steps") return currentRecipe.stepsSection?.lines ?? null;
    if (activeSection === "notes") return currentRecipe.notesLines;
    return null;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const actualLine = lineOffset + i + 1;
    const trimmed = line.trim();

    if (trimmed === "") {
      const sectionLines = getActiveLines();
      if (sectionLines) {
        sectionLines.push({ text: "", content: "", line: actualLine });
      } else if (currentRecipe) {
        currentRecipe.introLines.push({ text: "", content: "", line: actualLine });
      }
      continue;
    }

    const h1Match = /^#\s+(.*)$/.exec(trimmed);
    if (h1Match) {
      activeSection = null;
      const headingText = (h1Match[1] ?? "").trim();

      if (!currentRecipe && recipes.length === 0) {
        const headingType = nextHeadingType(lines, i);
        if (headingType === "#") {
          if (!documentTitle) {
            documentTitle = {
              text: headingText,
              line: actualLine,
            };
          }
          continue;
        }
      }

      finalizeRecipe(currentRecipe, diagnostics, recipes);

      currentRecipe = {
        title: headingText,
        id: slug(headingText),
        line: actualLine,
        introLines: [],
        ingredientsSection: null,
        stepsSection: null,
        notesLines: [],
        notesLine: null,
      };
      continue;
    }

    const h2Match = /^##\s+(.*)$/.exec(trimmed);
    if (h2Match) {
      const recipe = currentRecipe;
      const title = (h2Match[1] ?? "").trim();
      if (!recipe) {
        diagnostics.push(
          error(
            "E0103",
            `Section "${title}" appears before any recipe heading.`,
            actualLine,
          ),
        );
        continue;
      }

      const normalizedTitle = title.toLowerCase();
      const kind = SECTION_MAP[normalizedTitle] ?? "unknown";

      if (kind === "ingredients") {
        recipe.ingredientsSection = { title, line: actualLine, lines: [] };
        activeSection = "ingredients";
      } else if (kind === "steps") {
        recipe.stepsSection = { title, line: actualLine, lines: [] };
        activeSection = "steps";
      } else if (kind === "notes") {
        recipe.notesLine = actualLine;
        activeSection = "notes";
      } else {
        activeSection = null;
        diagnostics.push(
          warning(
            "W0102",
            `Unknown section "${title}" under recipe "${recipe.title}".`,
            actualLine,
          ),
        );
      }
      continue;
    }

    const sectionLines = getActiveLines();
    if (sectionLines) {
      sectionLines.push({ text: line, content: line, line: actualLine });
    } else if (currentRecipe) {
      currentRecipe.introLines.push({ text: line, content: line, line: actualLine });
    } else if (!documentTitle) {
      diagnostics.push(
        warning("W0104", "Unexpected content before recipe heading.", actualLine),
      );
    }

    if (isHeadingLine(trimmed) && !currentRecipe) {
      diagnostics.push(
        error(
          "E0103",
          `Section "${trimmed.replace(/^#+\s*/, "")}" appears before any recipe heading.`,
          actualLine,
        ),
      );
    }
  }

  finalizeRecipe(currentRecipe, diagnostics, recipes);

  const idRegistry = createIdRegistry();


  const registerId = (
    id: string,
    kind: "recipe" | "ingredient",
    line: number,
    name: string,
  ) => {
    const result = idRegistry.register(id, { kind, line, name });
    if (result.ok) {
      return;
    }

    if (result.reason === "empty") {
      diagnostics.push(
        error(
          "E0301",
          `${kind === "recipe" ? "Recipe" : "Ingredient"} "${name}" has an empty id.`,
          line,
        ),
      );
      return;
    }

    diagnostics.push(
      error(
        "E0301",
        `Duplicate id "${id}" found (${kind === "recipe" ? "recipe" : "ingredient"}).`,
        line,
      ),
    );
  };

  for (const recipe of recipes) {
    // Steps validation
    const { steps } = recipe;
    let hasNumbered = false;
    let hasInvalid = false;
    let lastWasNumbered = false;
    let sawContent = false;

    for (const line of steps.lines) {
      const raw = line.text;
      const trimmed = raw.trim();
      if (trimmed === "") continue;

      sawContent = true;

      if (STEP_NUMBER_RE.test(raw)) {
        hasNumbered = true;
        lastWasNumbered = true;
        continue;
      }

      if (lastWasNumbered && /^\s/.test(raw)) {
        lastWasNumbered = false;
        continue;
      }

      hasInvalid = true;
      break;
    }

    if (sawContent && (!hasNumbered || hasInvalid)) {
      diagnostics.push(
        warning(
          "W0401",
          `Steps under recipe "${recipe.title}" should be a numbered list.`,
          steps.line,
        ),
      );
    }

    // Ingredient ID registration
    for (const ingredient of recipe.ingredients.ingredients) {
      const qualifiedId = `${recipe.id}/${ingredient.id}`;
      registerId(qualifiedId, "ingredient", ingredient.line, ingredient.name);
    }

    // Anchor attribute validation
    const anchorIngredients = recipe.ingredients.ingredients.filter(
      (ing) => ing.attributes.some((attr) => attr.key === "anchor"),
    );

    if (anchorIngredients.length > 1) {
      for (const ing of anchorIngredients.slice(1)) {
        diagnostics.push(
          error(
            "E0209",
            `Recipe "${recipe.title}" has multiple anchor ingredients; at most one is allowed.`,
            ing.line,
          ),
        );
      }
    }

    for (const ing of anchorIngredients) {
      if (!ing.quantity) {
        diagnostics.push(
          error(
            "E0210",
            `Anchor ingredient "${ing.name}" must have a quantity.`,
            ing.line,
          ),
        );
      } else if (ing.quantity.kind !== "single") {
        diagnostics.push(
          error(
            "E0211",
            `Anchor ingredient "${ing.name}" must have a single quantity (not ${ing.quantity.kind}).`,
            ing.line,
          ),
        );
      }
    }
  }

  // Token and reference extraction from prose sections
  const referencePattern = /\[\[([^[\]]+)\]\]/g;

  const extractProseTokens = (
    lines: Pick<SectionLine, "content" | "line" | "lineSpans">[],
    label: string,
    recipe: Recipe,
  ) => {
    for (const line of lines) {
      const { tokens: extractedTokens, invalid } = extractInlineValues(line.content);

      for (const bad of invalid) {
        diagnostics.push(
          warning(
            "W0402",
            `Unknown inline value "${bad.raw}" in ${label} for recipe "${recipe.title}".`,
            resolveLineAt(line, bad.index),
          ),
        );
      }

      for (const token of extractedTokens) {
        const tokenLine = resolveLineAt(line, token.index);
        if (token.kind === "temperature") {
          inlineValues.push({
            ...token,
            line: tokenLine,
            column: token.index + 1,
            recipeId: recipe.id,
            recipeTitle: recipe.title,
          } satisfies DocumentInlineTemperatureValue);
        } else {
          inlineValues.push({
            ...token,
            line: tokenLine,
            column: token.index + 1,
            recipeId: recipe.id,
            recipeTitle: recipe.title,
          } satisfies DocumentInlineQuantityValue);

          // Validate: at most one metric and one imperial alternate
          if (token.alternates && token.alternates.length > 0) {
            let metricCount = 0;
            let imperialCount = 0;
            for (const alt of token.alternates) {
              const unit = alt.kind === "compound" ? alt.parts[0].unit : alt.unit;
              if (unit) {
                const unitInfo = lookupUnit(unit);
                if (unitInfo?.system) {
                  if (isMetric(unitInfo.system)) {
                    metricCount++;
                  } else {
                    imperialCount++;
                  }
                }
              }
            }
            if (metricCount > 1 || imperialCount > 1) {
              diagnostics.push(
                error(
                  "E0208",
                  "Multiple alternates in the same unit system.",
                  tokenLine,
                ),
              );
            }
          }
        }
      }

      referencePattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = referencePattern.exec(line.content)) !== null) {
        const innerRaw = match[1]?.trim() ?? "";
        const column = match.index + 1;
        const resolvedLine = resolveLineAt(line, match.index);
        let display: string | undefined;

        const arrowIndex = innerRaw.indexOf("->");
        let targets: string[];
        if (arrowIndex !== -1) {
          display = innerRaw.slice(0, arrowIndex).trim();
          const rhs = innerRaw.slice(arrowIndex + 2).trim();
          targets = rhs.split(",").map((s) => slug(s.trim())).filter(Boolean);
          if (!display || targets.length === 0) {
            diagnostics.push(
              warning("W0303", `Malformed reference token ${match[0]}.`, resolvedLine),
            );
            continue;
          }
          if (targets.length === 1 && slug(display) === targets[0]) {
            diagnostics.push(
              warning(
                "W0304",
                `Redundant display name in ${match[0]}.`,
                resolvedLine,
              ),
            );
          }
        } else {
          const t = slug(innerRaw);
          if (!t) {
            diagnostics.push(
              warning("W0303", `Malformed reference token ${match[0]}.`, resolvedLine),
            );
            continue;
          }
          targets = [t];
        }

        references.push({
          original: match[0],
          display,
          targets,
          recipeId: recipe.id,
          resolvedTargets: [],
          line: resolvedLine,
          column,
        });
      }
    }
  };

  for (const recipe of recipes) {
    extractProseTokens(recipe.introLines, "intro", recipe);
    extractProseTokens(recipe.steps.lines, "steps", recipe);
    extractProseTokens(recipe.notes, "notes", recipe);
  }

  // Reference resolution: scoped to the current recipe's ingredients
  for (const ref of references) {
    for (const target of ref.targets) {
      const scopedTarget = `${ref.recipeId}/${target}`;
      if (idRegistry.has(scopedTarget)) {
        ref.resolvedTargets.push(scopedTarget);
      } else {
        diagnostics.push(
          warning(
            "W0302",
            `Reference "${target}" does not match any known id.`,
            ref.line,
          ),
        );
      }
    }
  }

  // ── Recipe linking pass ───────────────────────────────────────────
  const recipeLinks: RecipeLink[] = [];
  const recipeById = new Map<string, Recipe>();
  for (const recipe of recipes) {
    recipeById.set(recipe.id, recipe);
  }

  const linkedRecipeIds = new Set<string>();

  for (const recipe of recipes) {
    for (const ingredient of recipe.ingredients.ingredients) {
      const targetRecipe = recipeById.get(ingredient.id);
      if (targetRecipe && targetRecipe.id !== recipe.id) {
        ingredient.linkedRecipeId = targetRecipe.id;
        recipeLinks.push({
          fromRecipeId: recipe.id,
          ingredientId: ingredient.id,
          toRecipeId: targetRecipe.id,
        });
        linkedRecipeIds.add(targetRecipe.id);
      } else {
        const unit = ingredient.quantity?.kind === "compound"
          ? null
          : ingredient.quantity?.unit;
        if (unit) {
          const unitInfo = lookupUnit(unit);
          if (
            unitInfo &&
            (unitInfo.canonical === "recipe" || unitInfo.canonical === "batch")
          ) {
            diagnostics.push(
              warning(
                "W0501",
                `Ingredient "${ingredient.name}" uses unit "${unit}" but no matching recipe was found.`,
                ingredient.line,
              ),
            );
          }
        }
      }
    }
  }

  // W0502: orphan recipes (index > 0, not referenced, and not referencing others)
  const recipesWithOutgoingLinks = new Set(recipeLinks.map((l) => l.fromRecipeId));
  for (let i = 1; i < recipes.length; i++) {
    const recipe = recipes[i]!;
    if (!linkedRecipeIds.has(recipe.id) && !recipesWithOutgoingLinks.has(recipe.id)) {
      diagnostics.push(
        warning(
          "W0502",
          `Recipe "${recipe.title}" is not referenced by any ingredient in another recipe.`,
          recipe.line,
        ),
      );
    }
  }

  return {
    frontmatter: frontmatterResult.frontmatter,
    body: frontmatterResult.body,
    diagnostics,
    bodyStartLine: frontmatterResult.bodyStartLine,
    documentTitle,
    recipes,
    inlineValues,
    references,
    recipeLinks,
  };
};
