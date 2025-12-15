import type {
  Diagnostic,
  Quantity,
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

const readNumber = (input: string): number | null => {
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
  `^\\s*(?<first>${VALUE_PART})\\s*(?:[-]\\s*(?<second>${VALUE_PART}))?\\s*(?<unit>.*)$`,
);

export interface QuantityParseOptions {
  line: number;
  invalid: { code: string; message: string };
}

export interface QuantityParseResult {
  quantity: Quantity | null;
  diagnostics: Diagnostic[];
}

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
  const match = QUANTITY_PATTERN.exec(normalizedValue);

  if (!match || !match.groups) {
    // If the pattern doesn't match, check if it's a unit-only quantity
    // (text with no numeric amount, e.g., "pinch", "dash")
    // Treat these as having an implied amount of 1
    const quantity: QuantitySingle = {
      kind: "single",
      raw: trimmed,
      value: 1,
      unit: trimmed,
    };
    return { quantity, diagnostics };
  }

  const firstText = match.groups.first ?? "";
  const firstNumber = readNumber(firstText);
  if (firstNumber === null) {
    diagnostics.push({
      code: options.invalid.code,
      message: options.invalid.message,
      severity: "error",
      line: options.line,
      column: 1,
    });
    return { quantity: null, diagnostics };
  }

  let kind: QuantityKind = "single";
  let min = firstNumber;
  let max = firstNumber;

  const secondText = match.groups.second;
  if (secondText) {
    const secondNumber = readNumber(secondText);
    if (secondNumber === null) {
      diagnostics.push({
        code: options.invalid.code,
        message: options.invalid.message,
        severity: "error",
        line: options.line,
        column: 1,
      });
      return { quantity: null, diagnostics };
    }
    kind = "range";
    min = Math.min(firstNumber, secondNumber);
    max = Math.max(firstNumber, secondNumber);
  }

  const unit = (match.groups.unit ?? "").trim();
  let quantity: Quantity;

  if (kind === "range") {
    quantity = {
      kind: "range",
      raw: trimmed,
      min,
      max,
      unit: unit.length > 0 ? unit : null,
    } satisfies QuantityRange;
  } else {
    quantity = {
      kind: "single",
      raw: trimmed,
      value: min,
      unit: unit.length > 0 ? unit : null,
    } satisfies QuantitySingle;

    // Warn if quantity looks like it uses "to" for a range
    // Pattern: number (whitespace) "to" (whitespace) number
    // This catches "4 to 5" but not "potato" or "tomato"
    const toRangePattern = /\d+\s+to\s+\d+/i;
    if (toRangePattern.test(trimmed)) {
      diagnostics.push({
        code: "W0207",
        message: 'Quantity appears to use "to" for a range; use hyphen (4-5) or en-dash (4–5) instead.',
        severity: "warning",
        line: options.line,
        column: 1,
      });
    }
  }

  return { quantity, diagnostics };
};
