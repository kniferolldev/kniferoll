import { parseQuantity } from "./quantity";
import { slug } from "./slug";
import type {
  Diagnostic,
  Ingredient,
  IngredientAttribute,
  IngredientsSection,
} from "./types";
import { lookupUnit } from "./units";

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

const stripQuotes = (value: string): string => {
  if (value.startsWith('"') && value.endsWith('"') && value.length >= 2) {
    return value.slice(1, -1);
  }
  return value;
};

const tokenizeAttrs = (input: string): string[] => {
  const trimmed = input.trim();
  if (trimmed === "") {
    return [];
  }

  const tokens: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < trimmed.length; i += 1) {
    const char = trimmed[i] ?? "";

    if (char === '"') {
      current += char;
      inQuotes = !inQuotes;
      continue;
    }

    if (char === " " && !inQuotes) {
      if (current !== "") {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += char;
  }

  if (current !== "") {
    tokens.push(current);
  }

  return tokens;
};

const parseIngredientLine = (
  lineText: string,
  lineNumber: number,
  diagnostics: Diagnostic[],
): Ingredient | null => {
  const trimmed = lineText.trim();
  if (trimmed === "") {
    return null;
  }

  const bulletMatch = /^-\s+(.*)$/.exec(trimmed);
  if (!bulletMatch) {
    diagnostics.push(
      error(
        "E0201",
        "Invalid ingredient line syntax; expected '- <name>' format.",
        lineNumber,
      ),
    );
    return null;
  }

  let body = bulletMatch[1] ?? "";
  let attrsPart: string | null = null;
  const delimiterMatch = body.match(/^(.*\S)\s+::\s+(.*)$/);
  if (delimiterMatch) {
    body = delimiterMatch[1]?.trimEnd() ?? "";
    attrsPart = delimiterMatch[2]?.trim() ?? "";
  } else {
    const rawIndex = body.indexOf("::");
    if (rawIndex >= 0) {
      const before = body[rawIndex - 1] ?? "";
      const after = body[rawIndex + 2] ?? "";
      if (before === " " || after === " ") {
        diagnostics.push(
          error(
            "E0202",
            "Ingredient tail delimiter '::' must include spaces on both sides.",
            lineNumber,
          ),
        );
      }
    }
  }

  let namePart = body;
  let quantityPart: string | null = null;
  let modifiersPart: string | null = null;

  const hyphenDashIndex = body.indexOf(" - ");
  const enDashIndex = body.indexOf(" – ");
  const dashIndex = hyphenDashIndex >= 0
    ? hyphenDashIndex
    : enDashIndex >= 0
      ? enDashIndex
      : -1;
  const dashLength = dashIndex === hyphenDashIndex ? 3 : dashIndex === enDashIndex ? 3 : 0;

  if (dashIndex >= 0) {
    namePart = body.slice(0, dashIndex);
    const remainder = body.slice(dashIndex + dashLength);
    const commaIndex = remainder.indexOf(", ");
    if (commaIndex >= 0) {
      quantityPart = remainder.slice(0, commaIndex);
      modifiersPart = remainder.slice(commaIndex + 2);
    } else {
      quantityPart = remainder;
    }
  } else {
    const commaIndex = body.indexOf(", ");
    if (commaIndex >= 0) {
      namePart = body.slice(0, commaIndex);
      modifiersPart = body.slice(commaIndex + 2);
    }
  }

  const name = namePart.trim();
  if (name === "") {
    diagnostics.push(error("E0201", "Ingredient name is required.", lineNumber));
    return null;
  }

  if (quantityPart !== null) {
    quantityPart = quantityPart.trim();
    if (quantityPart === "") {
      diagnostics.push(
        error("E0201", "Ingredient quantity must not be empty.", lineNumber),
      );
      return null;
    }
  }

  if (modifiersPart !== null) {
    modifiersPart = modifiersPart.trim();
    if (modifiersPart === "") {
      diagnostics.push(
        error(
          "E0201",
          "Ingredient modifiers must not be empty when specified.",
          lineNumber,
        ),
      );
      return null;
    }
  }

  const attributes: IngredientAttribute[] = [];
  let hasNoscale = false;
  let idValue: string | null = null;

  if (attrsPart) {
    const tokens = tokenizeAttrs(attrsPart);
    for (const token of tokens) {
      const eqIndex = token.indexOf("=");
      if (eqIndex === -1) {
        if (token === "noscale") {
          hasNoscale = true;
          attributes.push({ key: "noscale", value: null });
          continue;
        }

        diagnostics.push(
          error(
            "E0203",
            `Unknown ingredient tail attribute "${token}".`,
            lineNumber,
          ),
        );
        continue;
      }

      const key = token.slice(0, eqIndex);
      let value = token.slice(eqIndex + 1);
      if (value === "") {
        diagnostics.push(
          error(
            "E0201",
            `Ingredient tail attribute "${key}" is missing a value.`,
            lineNumber,
          ),
        );
        return null;
      }

      if (value.startsWith('"') && !value.endsWith('"')) {
        diagnostics.push(
          error(
            "E0201",
            `Ingredient tail attribute "${key}" has unterminated quotes.`,
            lineNumber,
          ),
        );
        return null;
      }

      value = stripQuotes(value);

      const attribute: IngredientAttribute = {
        key,
        value,
      };

      if (key === "id") {
        idValue = value;
      } else if (key === "also") {
        const result = parseQuantity(value, {
          line: lineNumber,
          invalid: {
            code: "E0206",
            message: "Alternate quantity (also=) must be a valid quantity.",
          },
        });
        diagnostics.push(...result.diagnostics);
        if (result.quantity) {
          attribute.quantity = result.quantity;
        }
      } else if (key === "noscale") {
        hasNoscale = true;
        attribute.value = null;
      } else {
        diagnostics.push(
          error(
            "E0203",
            `Unknown ingredient tail attribute "${key}".`,
            lineNumber,
          ),
        );
      }

      attributes.push(attribute);
    }
  }

  let parsedQuantity: Ingredient["quantity"] = null;
  if (quantityPart !== null) {
    const result = parseQuantity(quantityPart, {
      line: lineNumber,
      invalid: {
        code: "E0201",
        message: "Ingredient quantity is invalid.",
      },
    });
    diagnostics.push(...result.diagnostics);
    parsedQuantity = result.quantity;
  }

  // Validate compound quantity: both parts must share a base unit (convertible)
  if (parsedQuantity?.kind === "compound") {
    const [p1, p2] = parsedQuantity.parts;
    const u1 = p1.unit ? lookupUnit(p1.unit) : null;
    const u2 = p2.unit ? lookupUnit(p2.unit) : null;
    if (u1?.base && u2?.base && u1.base !== u2.base) {
      diagnostics.push(
        error(
          "E0207",
          `Compound quantity parts must be convertible ("${p1.unit}" and "${p2.unit}" have different base units).`,
          lineNumber,
        ),
      );
    }
  }

  if (hasNoscale && (!quantityPart || quantityPart.length === 0)) {
    diagnostics.push(
      warning(
        "W0205",
        "Ingredient uses 'noscale' without a quantity; attribute is redundant.",
        lineNumber,
      ),
    );
  }

  if (idValue && slug(name) === idValue) {
    diagnostics.push(
      warning(
        "W0204",
        "Ingredient id matches the default slug; omit redundant id=.",
        lineNumber,
      ),
    );
  }

  const finalId = idValue ?? slug(name);

  const ingredient: Ingredient = {
    line: lineNumber,
    text: lineText,
    name,
    id: finalId,
    quantityText: quantityPart,
    quantity: parsedQuantity,
    modifiers: modifiersPart,
    attributes,
  };

  return ingredient;
};

export const parseIngredientsSection = (
  section: IngredientsSection,
  diagnostics: Diagnostic[],
) => {
  const items: Ingredient[] = [];

  // Merge continuation lines (lines that start with whitespace and don't have a bullet)
  const mergedLines: Array<{ text: string; line: number }> = [];
  for (let i = 0; i < section.lines.length; i++) {
    const current = section.lines[i];
    if (!current) continue;

    const trimmed = current.text.trim();

    // Skip blank lines
    if (trimmed === "") {
      continue;
    }

    // Check if this is a continuation line (starts with whitespace, not a bullet)
    const isContinuation = current.text.startsWith(" ") && !trimmed.startsWith("-");

    if (isContinuation && mergedLines.length > 0) {
      // Append to the previous line
      const prev = mergedLines[mergedLines.length - 1];
      if (prev) {
        prev.text = `${prev.text} ${trimmed}`;
      }
    } else {
      // Start a new line
      mergedLines.push({ text: current.text, line: current.line });
    }
  }

  // Parse merged lines
  for (const { text, line } of mergedLines) {
    const ingredient = parseIngredientLine(text, line, diagnostics);
    if (ingredient) {
      items.push(ingredient);
    }
  }
  section.ingredients = items;
};
