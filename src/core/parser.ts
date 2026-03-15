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
  RecipeSection,
  SectionKind,
  StepsSection,
  UnknownSection,
  NotesSection,
  SectionLine,
  ReferenceToken,
} from "./types";
import { lookupUnit, isMetric } from "./units";
import { createIdRegistry } from "./id-registry";

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
      current = {
        text: current.text + " " + trimmed,
        content: current.content + " " + trimmed,
        line: current.line, // Keep the line number of the step start
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
 * Reflows notes text by joining continuation lines.
 * Bullets (- or *), ordered list items (1.), and headers (### or ####)
 * start new blocks. Plain text continues the previous block.
 * Empty lines create paragraph breaks.
 */
const stripLinePrefix = (
  text: string,
): { content: string } => {
  const headerMatch = NOTES_HEADER_RE.exec(text);
  if (headerMatch) {
    return { content: text.slice(headerMatch[0].length) };
  }
  const bulletMatch = BULLET_RE.exec(text);
  if (bulletMatch) {
    return { content: text.slice(bulletMatch[0].length) };
  }
  const stepMatch = STEP_NUMBER_RE.exec(text);
  if (stepMatch) {
    return { content: text.slice(stepMatch[0].length) };
  }
  return { content: text };
};

const unwrapNotesLines = (lines: SectionLine[]): SectionLine[] => {
  const unwrapped: SectionLine[] = [];
  let current: SectionLine | null = null;

  for (const line of lines) {
    const trimmed = line.text.trim();

    // Empty lines end the current block
    if (trimmed === "") {
      if (current) {
        unwrapped.push(current);
        current = null;
      }
      unwrapped.push({ text: "", content: "", line: line.line });
      continue;
    }

    // Headers are always standalone — flush and emit immediately
    if (NOTES_HEADER_RE.test(trimmed)) {
      if (current) {
        unwrapped.push(current);
        current = null;
      }
      const { content } = stripLinePrefix(trimmed);
      unwrapped.push({ text: trimmed, content, line: line.line });
      continue;
    }

    // Bullets and ordered list items start a new block
    if (BULLET_RE.test(trimmed) || STEP_NUMBER_RE.test(trimmed)) {
      if (current) {
        unwrapped.push(current);
      }
      const { content } = stripLinePrefix(trimmed);
      current = { text: trimmed, content, line: line.line };
      continue;
    }

    // Continuation line — join to current block
    if (current) {
      current = {
        text: current.text + " " + trimmed,
        content: current.content + " " + trimmed,
        line: current.line,
      };
      continue;
    }

    // Start a new paragraph block
    current = { text: trimmed, content: trimmed, line: line.line };
  }

  if (current) {
    unwrapped.push(current);
  }

  return unwrapped;
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

type RecipeParseState = Recipe & {
  hasIngredients: boolean;
  hasSteps: boolean;
};

const finalizeRecipe = (
  current: RecipeParseState | null,
  diagnostics: Diagnostic[],
  out: Recipe[],
) => {
  if (!current) {
    return;
  }

  if (!current.hasIngredients) {
    diagnostics.push(
      error(
        "E0101",
        `Recipe "${current.title}" is missing an Ingredients section.`,
        current.line,
      ),
    );
  }

  if (!current.hasSteps) {
    diagnostics.push(
      error(
        "E0101",
        `Recipe "${current.title}" is missing a Steps section.`,
        current.line,
      ),
    );
  }

  const introText = current.introLines.map((l) => l.text).join("\n").trim();
  out.push({
    title: current.title,
    id: current.id,
    line: current.line,
    intro: introText || undefined,
    introLines: current.introLines,
    sections: current.sections,
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
  let currentSection: RecipeSection | null = null;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i] ?? "";
    const actualLine = lineOffset + i + 1;
    const trimmed = line.trim();

    if (trimmed === "") {
      if (currentSection) {
        // Preserve blank lines in sections (notes uses them for paragraph breaks)
        currentSection.lines.push({ text: "", content: "", line: actualLine });
      } else if (currentRecipe) {
        // Capture empty lines for intro (to preserve paragraph breaks)
        currentRecipe.introLines.push({ text: line, content: line, line: actualLine });
      }
      continue;
    }

    const h1Match = /^#\s+(.*)$/.exec(trimmed);
    if (h1Match) {
      currentSection = null;
      const headingText = (h1Match[1] ?? "").trim();

      if (!currentRecipe && recipes.length === 0) {
        const headingType = nextHeadingType(lines, i);
        if (headingType === "#") {
          // Treat as overall document title; skip.
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
        sections: [],
        hasIngredients: false,
        hasSteps: false,
        introLines: [],
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

      const base = {
        title,
        normalizedTitle,
        line: actualLine,
        lines: [] as SectionLine[],
      };

      let section: RecipeSection;
      if (kind === "ingredients") {
        section = {
          ...base,
          kind: "ingredients",
          ingredients: [],
        } satisfies IngredientsSection;
      } else if (kind === "steps") {
        section = {
          ...base,
          kind: "steps",
        } satisfies StepsSection;
      } else if (kind === "notes") {
        section = {
          ...base,
          kind: "notes",
        } satisfies NotesSection;
      } else {
        section = {
          ...base,
          kind: "unknown",
        } satisfies UnknownSection;
      }

      recipe.sections.push(section);
      currentSection = section;

      if (kind === "ingredients") {
        recipe.hasIngredients = true;
      } else if (kind === "steps") {
        recipe.hasSteps = true;
      } else if (kind === "unknown") {
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

    if (currentSection) {
      currentSection.lines.push({ text: line, content: line, line: actualLine });
    } else if (currentRecipe) {
      currentRecipe.introLines.push({ text: line, content: line, line: actualLine });
    } else {
      diagnostics.push(
        warning("W0104", "Unexpected content before recipe heading.", actualLine),
      );
    }

    if (isHeadingLine(trimmed) && !currentRecipe) {
      // Any other heading before a recipe is treated as a structure error.
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

  for (const recipe of recipes) {
    for (const section of recipe.sections) {
      if (section.kind === "ingredients") {
        parseIngredientsSection(section, diagnostics);
      } else if (section.kind === "steps") {
        // Unwrap continuation lines in steps
        section.lines = unwrapStepLines(section.lines);
      } else if (section.kind === "notes") {
        // Unwrap continuation lines in notes
        section.lines = unwrapNotesLines(section.lines);
      }
    }
  }

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
    // Recipe titles no longer create referenceable IDs - only ingredients do.
    // Subrecipes are connected to ingredients implicitly by name.
    for (const section of recipe.sections) {
      if (section.kind === "steps") {
        let hasNumbered = false;
        let hasInvalid = false;
        let lastWasNumbered = false;
        let sawContent = false;

        for (const line of section.lines) {
          const raw = line.text;
          const trimmed = raw.trim();
          if (trimmed === "") {
            continue;
          }

          sawContent = true;

          if (STEP_NUMBER_RE.test(raw)) {
            hasNumbered = true;
            lastWasNumbered = true;
            continue;
          }

          if (lastWasNumbered && /^\s/.test(raw)) {
            // Continuation of the previous numbered step.
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
              section.line,
            ),
          );
        }
      }

      if (section.kind === "ingredients") {
        for (const ingredient of section.ingredients) {
          // Use qualified ID for registry to allow same ingredient name in different recipes
          const qualifiedId = `${recipe.id}/${ingredient.id}`;
          registerId(qualifiedId, "ingredient", ingredient.line, ingredient.name);
        }
      }
    }
  }

  const referencePattern = /\[\[([^[\]]+)\]\]/g;

  const extractProseTokens = (
    lines: SectionLine[],
    label: string,
    recipeId: string,
    recipeTitle: string,
  ) => {
    for (const line of lines) {
      const { tokens: extractedTokens, invalid } = extractInlineValues(line.content);

      for (const bad of invalid) {
        diagnostics.push(
          warning(
            "W0402",
            `Unknown inline value "${bad.raw}" in ${label} for recipe "${recipeTitle}".`,
            line.line,
          ),
        );
      }

      for (const token of extractedTokens) {
        if (token.kind === "temperature") {
          inlineValues.push({
            ...token,
            line: line.line,
            column: token.index + 1,
            recipeId,
            recipeTitle,
          } satisfies DocumentInlineTemperatureValue);
        } else {
          inlineValues.push({
            ...token,
            line: line.line,
            column: token.index + 1,
            recipeId,
            recipeTitle,
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
                  line.line,
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
        let display: string | undefined;
        let target: string | undefined;

        const arrowIndex = innerRaw.indexOf("->");
        if (arrowIndex !== -1) {
          display = innerRaw.slice(0, arrowIndex).trim();
          target = slug(innerRaw.slice(arrowIndex + 2).trim());
          if (!display || !target) {
            diagnostics.push(
              warning("W0303", `Malformed reference token ${match[0]}.`, line.line),
            );
            continue;
          }
        } else {
          target = slug(innerRaw);
          if (!target) {
            diagnostics.push(
              warning("W0303", `Malformed reference token ${match[0]}.`, line.line),
            );
            continue;
          }
        }

        references.push({
          original: match[0],
          display,
          target,
          recipeId,
          line: line.line,
          column,
        });
      }
    }
  };

  for (const recipe of recipes) {
    // Extract tokens from intro text
    extractProseTokens(recipe.introLines, "intro", recipe.id, recipe.title);

    for (const section of recipe.sections) {
      if (section.kind !== "steps" && section.kind !== "notes") {
        continue;
      }

      const sectionLabel = section.kind === "steps" ? "steps" : "notes";
      extractProseTokens(section.lines, sectionLabel, recipe.id, recipe.title);
    }
  }

  // Reference resolution: scoped to the current recipe's ingredients
  for (const ref of references) {
    const scopedTarget = `${ref.recipeId}/${ref.target}`;
    if (idRegistry.has(scopedTarget)) {
      ref.resolvedTarget = scopedTarget;
      continue;
    }

    diagnostics.push(
      warning(
        "W0302",
        `Reference "${ref.target}" does not match any known id.`,
        ref.line,
      ),
    );
  }

  // ── Recipe linking pass ───────────────────────────────────────────
  const recipeLinks: RecipeLink[] = [];
  const recipeById = new Map<string, Recipe>();
  for (const recipe of recipes) {
    recipeById.set(recipe.id, recipe);
  }

  const linkedRecipeIds = new Set<string>();

  for (const recipe of recipes) {
    for (const section of recipe.sections) {
      if (section.kind !== "ingredients") continue;
      for (const ingredient of section.ingredients) {
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
          // W0501: unit is recipe/batch but no matching recipe found
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
