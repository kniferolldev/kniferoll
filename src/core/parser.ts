import { extractFrontmatter } from "./frontmatter";
import { parseIngredientsSection } from "./ingredients";
import { slug } from "./slug";
import { extractStepTokens } from "./steps";
import type {
  DocumentStepToken,
  DocumentParseResult,
  DocumentTitle,
  Diagnostic,
  IngredientsSection,
  ParseOptions,
  Recipe,
  RecipeSection,
  SectionKind,
  StepsSection,
  UnknownSection,
  NotesSection,
  SectionLine,
  ReferenceToken,
} from "./types";
import { createIdRegistry } from "./id-registry";

const SECTION_MAP: Record<string, SectionKind> = {
  ingredients: "ingredients",
  steps: "steps",
  notes: "notes",
};

const STEP_NUMBER_RE = /^\s*\d+\.\s+/;

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

  out.push({
    title: current.title,
    id: current.id,
    line: current.line,
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
  const stepTokens: DocumentStepToken[] = [];
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
      currentSection.lines.push({ text: line, line: actualLine });
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
    registerId(recipe.id, "recipe", recipe.line, recipe.title);
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
          registerId(ingredient.id, "ingredient", ingredient.line, ingredient.name);
        }
      }
    }
  }

  const referencePattern = /\[\[([^[\]]+)\]\]/g;

  for (const recipe of recipes) {
    for (const section of recipe.sections) {
      if (section.kind !== "steps") {
        continue;
      }

      for (const line of section.lines) {
        const { tokens: extractedTokens, invalid } = extractStepTokens(line.text);

        for (const bad of invalid) {
          diagnostics.push(
            warning(
              "W0402",
              `Invalid timer token "${bad.raw}" in steps for recipe "${recipe.title}".`,
              line.line,
            ),
          );
        }

        for (const token of extractedTokens) {
          stepTokens.push({
            ...token,
            line: line.line,
            column: token.index + 1,
            recipeId: recipe.id,
            recipeTitle: recipe.title,
          });
        }

        referencePattern.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = referencePattern.exec(line.text)) !== null) {
          const innerRaw = match[1]?.trim() ?? "";
          const column = match.index + 1;
          let display: string | undefined;
          let target: string | undefined;

          const arrowIndex = innerRaw.indexOf("->");
          if (arrowIndex !== -1) {
            display = innerRaw.slice(0, arrowIndex).trim();
            target = innerRaw.slice(arrowIndex + 2).trim();
            if (!display || !target) {
              diagnostics.push(
                warning("W0303", `Malformed reference token ${match[0]}.`, line.line),
              );
              continue;
            }
          } else {
            target = innerRaw;
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
            line: line.line,
            column,
          });
        }
      }
    }
  }

  for (const ref of references) {
    if (!idRegistry.has(ref.target)) {
      diagnostics.push(
        warning(
          "W0302",
          `Reference "${ref.target}" does not match any known id.`,
          ref.line,
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
    stepTokens,
    references,
  };
};
