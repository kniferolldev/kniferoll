import type {
  ComputeScaleFactorResult,
  DocumentParseResult,
  Ingredient,
  QuantityCompound,
  QuantitySingle,
  ScaleAnchor,
  ScalePreset,
  ScaleSelection,
} from "./types";
import { slug } from "./slug";
import { lookupUnit, toBaseValue } from "./units";

const isQuantitySingle = (
  quantity: Ingredient["quantity"],
): quantity is QuantitySingle => quantity?.kind === "single";

const isQuantityCompound = (
  quantity: Ingredient["quantity"],
): quantity is QuantityCompound => quantity?.kind === "compound";

const compoundToBaseTotal = (
  quantity: QuantityCompound,
): { total: number; baseUnit: string } | null => {
  const [p1, p2] = quantity.parts;
  const u1 = p1.unit ? lookupUnit(p1.unit) : null;
  const u2 = p2.unit ? lookupUnit(p2.unit) : null;
  if (!u1 || !u2 || !u1.base || !u2.base || u1.base !== u2.base) return null;
  const base1 = toBaseValue(p1.value, u1);
  const base2 = toBaseValue(p2.value, u2);
  return { total: base1 + base2, baseUnit: u1.base };
};

const normalizeName = (name: string) => name.trim().toLowerCase();

const resolvePreset = (
  frontmatterPresets: ScalePreset[] | undefined,
  selection: { presetName?: string; presetIndex?: number },
): { preset: ScalePreset; index: number } | null => {
  if (!frontmatterPresets || frontmatterPresets.length === 0) {
    return null;
  }

  if (selection.presetName !== undefined) {
    const target = normalizeName(selection.presetName);
    const index = frontmatterPresets.findIndex(
      (preset) => normalizeName(preset.name) === target,
    );
    if (index === -1) {
      return null;
    }
    return { preset: frontmatterPresets[index]!, index };
  }

  if (selection.presetIndex !== undefined) {
    const preset = frontmatterPresets[selection.presetIndex];
    if (!preset) {
      return null;
    }
    return { preset, index: selection.presetIndex };
  }

  return null;
};

const findIngredientById = (
  doc: DocumentParseResult,
  id: string,
): { ingredient: Ingredient; recipeId: string; recipeTitle: string } | null => {
  for (const recipe of doc.recipes) {
    for (const ingredient of recipe.ingredients.ingredients) {
      if (ingredient.id === id) {
        return {
          ingredient,
          recipeId: recipe.id,
          recipeTitle: recipe.title,
        };
      }
    }
  }
  return null;
};

const normalizeUnit = (unit: string | null | undefined) => unit?.trim().toLowerCase() ?? null;

export const computeScaleFactor = (
  doc: DocumentParseResult,
  selection: ScaleSelection,
): ComputeScaleFactorResult => {
  if (!selection || typeof selection !== "object") {
    return {
      ok: false,
      reason: "invalid-selection",
      message: "A scale selection must be provided.",
    };
  }

  let anchor: ScaleAnchor | null = null;
  let source: "preset" | "manual" = "manual";
  let presetMeta: { name: string; index: number } | undefined;

  if ("anchor" in selection) {
    anchor = selection.anchor;
  } else {
    const presets = doc.frontmatter?.scales;
    if (!doc.frontmatter) {
      return {
        ok: false,
        reason: "missing-frontmatter",
        message: "Document does not include frontmatter with scale presets.",
      };
    }
    if (!presets || presets.length === 0) {
      return {
        ok: false,
        reason: "no-scales",
        message: "Document frontmatter does not define any scale presets.",
      };
    }

    const resolved = resolvePreset(presets, selection);
    if (!resolved) {
      return {
        ok: false,
        reason: "preset-not-found",
        message: "Requested scale preset could not be found.",
      };
    }

    const presetAmount = resolved.preset.amount;
    if (presetAmount.kind !== "single") {
      return {
        ok: false,
        reason: "anchor-invalid",
        message: `Scale preset "${resolved.preset.name}" amount must be a simple quantity (not a range or compound).`,
      };
    }
    anchor = {
      id: slug(resolved.preset.anchor),
      amount: presetAmount.value,
      unit: presetAmount.unit ?? "",
    };
    presetMeta = { name: resolved.preset.name, index: resolved.index };
    source = "preset";
  }

  if (!anchor || !anchor.id || anchor.amount == null || !Number.isFinite(anchor.amount)) {
    return {
      ok: false,
      reason: "anchor-invalid",
      message: "Scale anchor is invalid.",
    };
  }

  if (anchor.amount <= 0) {
    return {
      ok: false,
      reason: "anchor-invalid",
      message: "Scale anchor amount must be greater than zero.",
    };
  }

  const lookup = findIngredientById(doc, anchor.id);
  if (!lookup) {
    return {
      ok: false,
      reason: "ingredient-not-found",
      message: `No ingredient found with id "${anchor.id}".`,
    };
  }

  const { ingredient, recipeId, recipeTitle } = lookup;
  if (!ingredient.quantity) {
    return {
      ok: false,
      reason: "ingredient-missing-quantity",
      message: `Ingredient "${ingredient.name}" does not have a quantity.`,
    };
  }

  if (!isQuantitySingle(ingredient.quantity) && !isQuantityCompound(ingredient.quantity)) {
    return {
      ok: false,
      reason: "ingredient-range-quantity",
      message: `Ingredient "${ingredient.name}" quantity is a range and cannot be used for scaling.`,
    };
  }

  // Handle compound quantities: convert both parts to base units and sum
  if (isQuantityCompound(ingredient.quantity)) {
    const baseTotal = compoundToBaseTotal(ingredient.quantity);
    if (!baseTotal) {
      return {
        ok: false,
        reason: "unit-mismatch",
        message: `Compound quantity parts cannot be converted to a common base unit.`,
      };
    }

    // Convert anchor amount to the same base unit
    const anchorUnitInfo = anchor.unit ? lookupUnit(anchor.unit) : null;
    let anchorBase = anchor.amount;
    if (anchorUnitInfo && anchorUnitInfo.base === baseTotal.baseUnit) {
      anchorBase = toBaseValue(anchor.amount, anchorUnitInfo);
    } else if (anchor.unit && normalizeUnit(anchor.unit) !== normalizeUnit(baseTotal.baseUnit)) {
      return {
        ok: false,
        reason: "unit-mismatch",
        message: `Anchor unit "${anchor.unit}" does not match compound quantity base unit "${baseTotal.baseUnit}".`,
      };
    }

    if (baseTotal.total === 0) {
      return {
        ok: false,
        reason: "zero-quantity",
        message: "Ingredient quantity is zero and cannot be scaled.",
      };
    }

    const factor = anchorBase / baseTotal.total;
    return {
      ok: true,
      factor,
      source,
      anchor,
      ingredient: {
        id: ingredient.id,
        name: ingredient.name,
        line: ingredient.line,
        recipeId,
        recipeTitle,
        // Use first part as the representative single quantity for the type
        quantity: ingredient.quantity.parts[0],
      },
      preset: presetMeta,
    };
  }

  const ingredientUnit = normalizeUnit(ingredient.quantity.unit);
  const anchorUnit = normalizeUnit(anchor.unit);

  const unitsMatch = anchorUnit
    ? ingredientUnit === anchorUnit
    : ingredientUnit === null;

  if (!unitsMatch) {
    // Check alternate quantities from also= attributes
    const alternateMatch = ingredient.attributes
      .filter((attr) => attr.key === "also" && attr.quantity?.kind === "single")
      .find((attr) => {
        const altUnit = normalizeUnit((attr.quantity as QuantitySingle).unit);
        return anchorUnit ? altUnit === anchorUnit : altUnit === null;
      });

    if (alternateMatch) {
      const altQty = alternateMatch.quantity as QuantitySingle;
      if (altQty.value === 0) {
        return {
          ok: false,
          reason: "zero-quantity",
          message: "Alternate ingredient quantity is zero and cannot be scaled.",
        };
      }
      const factor = anchor.amount / altQty.value;
      return {
        ok: true,
        factor,
        source,
        anchor,
        ingredient: {
          id: ingredient.id,
          name: ingredient.name,
          line: ingredient.line,
          recipeId,
          recipeTitle,
          quantity: ingredient.quantity,
        },
        preset: presetMeta,
      };
    }

    return {
      ok: false,
      reason: "unit-mismatch",
      message: `Anchor unit "${anchor.unit}" does not match ingredient unit "${ingredient.quantity.unit ?? ""}".`,
    };
  }

  if (ingredient.quantity.value === 0) {
    return {
      ok: false,
      reason: "zero-quantity",
      message: "Ingredient quantity is zero and cannot be scaled.",
    };
  }

  const factor = anchor.amount / ingredient.quantity.value;

  return {
    ok: true,
    factor,
    source,
    anchor,
    ingredient: {
      id: ingredient.id,
      name: ingredient.name,
      line: ingredient.line,
      recipeId,
      recipeTitle,
      quantity: ingredient.quantity,
    },
    preset: presetMeta,
  };
};
