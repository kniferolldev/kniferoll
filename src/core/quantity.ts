import type {
  Diagnostic,
  Quantity,
  QuantityCompound,
  QuantityKind,
  QuantityRange,
  QuantitySingle,
} from "./types";

const VULGAR_FRACTIONS: Record<string, string> = {
  "¼": "1/4",
  "½": "1/2",
  "¾": "3/4",
  "⅐": "1/7",
  "⅑": "1/9",
  "⅒": "1/10",
  "⅓": "1/3",
  "⅔": "2/3",
  "⅕": "1/5",
  "⅖": "2/5",
  "⅗": "3/5",
  "⅘": "4/5",
  "⅙": "1/6",
  "⅚": "5/6",
  "⅛": "1/8",
  "⅜": "3/8",
  "⅝": "5/8",
  "⅞": "7/8",
};

const replaceVulgarFractions = (input: string): string => {
  return input.replace(
    /[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/g,
    (char) => VULGAR_FRACTIONS[char] ?? char,
  );
};

const NUMBER_PATTERN = /^(?:(?<whole>\d+(?:\.\d+)?)(?:\s+(?<num>[1-9]\d*)\/(?<den>[1-9]\d*))?|(?<fracNum>[1-9]\d*)\/(?<fracDen>[1-9]\d*))$/;

export const readNumber = (input: string): number | null => {
  const candidate = input.trim();
  const match = NUMBER_PATTERN.exec(candidate);
  if (!match || !match.groups) {
    return null;
  }

  const { whole, num, den, fracNum, fracDen } = match.groups as {
    whole?: string;
    num?: string;
    den?: string;
    fracNum?: string;
    fracDen?: string;
  };

  if (whole !== undefined) {
    const baseValue = Number(whole);
    if (num !== undefined && den !== undefined) {
      const numerator = Number(num);
      const denominator = Number(den);
      return baseValue + numerator / denominator;
    }

    return baseValue;
  }

  if (fracNum !== undefined && fracDen !== undefined) {
    const numerator = Number(fracNum);
    const denominator = Number(fracDen);
    return numerator / denominator;
  }

  return null;
};

const VALUE_PART = String.raw`\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?`;
const QUANTITY_PATTERN = new RegExp(
  `^\\s*(?<first>${VALUE_PART})(?:(?:\\s*[-]\\s*|\\s+[tT][oO]\\s+)(?<second>${VALUE_PART}))?\\s*(?<unit>.*)$`,
);

export interface QuantityParseOptions {
  line: number;
  invalid: { code: string; message: string };
}

export interface QuantityParseResult {
  quantity: Quantity | null;
  diagnostics: Diagnostic[];
}

const COMPOUND_SEPARATOR = /\s+\+\s+/;

const parseSingleOrRange = (
  normalizedValue: string,
  rawText: string,
): Quantity | null => {
  const match = QUANTITY_PATTERN.exec(normalizedValue);

  if (!match || !match.groups) {
    // Unit-only quantity (text with no numeric amount, e.g., "pinch", "dash")
    const quantity: QuantitySingle = {
      kind: "single",
      raw: rawText,
      value: 1,
      unit: rawText,
    };
    return quantity;
  }

  const firstText = match.groups.first ?? "";
  const firstNumber = readNumber(firstText);
  if (firstNumber === null) {
    return null;
  }

  let kind: QuantityKind = "single";
  let min = firstNumber;
  let max = firstNumber;

  const secondText = match.groups.second;
  if (secondText) {
    const secondNumber = readNumber(secondText);
    if (secondNumber === null) {
      return null;
    }
    kind = "range";
    min = Math.min(firstNumber, secondNumber);
    max = Math.max(firstNumber, secondNumber);
  }

  const unit = (match.groups.unit ?? "").trim();

  if (kind === "range") {
    return {
      kind: "range",
      raw: rawText,
      min,
      max,
      unit: unit.length > 0 ? unit : null,
    } satisfies QuantityRange;
  }

  return {
    kind: "single",
    raw: rawText,
    value: min,
    unit: unit.length > 0 ? unit : null,
  } satisfies QuantitySingle;
};

const tryParseCompound = (
  normalizedValue: string,
  rawInput: string,
): QuantityCompound | null => {
  const parts = normalizedValue.split(COMPOUND_SEPARATOR);
  if (parts.length !== 2) return null;

  // Split the raw input the same way to get raw text for each part
  const rawParts = rawInput.split(COMPOUND_SEPARATOR);
  if (rawParts.length !== 2) return null;

  const first = parseSingleOrRange(parts[0]!.trim(), rawParts[0]!.trim());
  if (!first || first.kind !== "single" || !first.unit) return null;

  const second = parseSingleOrRange(parts[1]!.trim(), rawParts[1]!.trim());
  if (!second || second.kind !== "single" || !second.unit) return null;

  return {
    kind: "compound",
    raw: rawInput,
    parts: [first, second],
  };
};

export const parseQuantity = (
  rawInput: string,
  options: QuantityParseOptions,
): QuantityParseResult => {
  const diagnostics: Diagnostic[] = [];
  const trimmed = rawInput.trim();
  if (trimmed.length === 0) {
    diagnostics.push({
      code: options.invalid.code,
      message: options.invalid.message,
      severity: "error",
      line: options.line,
      column: 1,
    });
    return { quantity: null, diagnostics };
  }

  const normalizedValue = replaceVulgarFractions(trimmed).replace(/\u2013/g, "-");

  // Try compound first (e.g., "1 cup + 3 tbsp")
  const compound = tryParseCompound(normalizedValue, trimmed);
  if (compound) {
    return { quantity: compound, diagnostics };
  }

  const quantity = parseSingleOrRange(normalizedValue, trimmed);
  if (!quantity) {
    diagnostics.push({
      code: options.invalid.code,
      message: options.invalid.message,
      severity: "error",
      line: options.line,
      column: 1,
    });
    return { quantity: null, diagnostics };
  }

  return { quantity, diagnostics };
};
