import { parseYamlSubset as parseYaml } from "./yaml-subset";
import { parseQuantity } from "./quantity";
import { slug } from "./slug";
import type {
  Diagnostic,
  Frontmatter,
  FrontmatterParseResult,
  ParseOptions,
  Quantity,
  ScalePreset,
  Source,
  UrlSource,
  CookbookSource,
} from "./types";

const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const error = (code: string, message: string): Diagnostic => ({
  code,
  message,
  severity: "error",
  line: 1,
  column: 1,
});

const toKnownIds = (options?: ParseOptions): Set<string> | undefined => {
  if (!options?.knownIds) {
    return undefined;
  }
  return new Set(options.knownIds);
};

const normalizeSource = (
  value: unknown,
  diagnostics: Diagnostic[],
): Source | undefined => {
  const baseLength = diagnostics.length;

  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    if (value.trim().length === 0) {
      diagnostics.push(
        error("E0003", "Frontmatter source text must not be empty."),
      );
      return undefined;
    }

    return { kind: "text", value };
  }

  if (value && typeof value === "object" && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;

    if (typeof record.url === "string") {
      const source: UrlSource = { kind: "url", url: record.url };

      if ("title" in record) {
        if (typeof record.title === "string") {
          source.title = record.title;
        } else {
          diagnostics.push(
            error("E0003", "Frontmatter source.title must be a string."),
          );
        }
      }

      if ("accessed" in record) {
        if (typeof record.accessed === "string") {
          if (!ISO_DATE_PATTERN.test(record.accessed)) {
            diagnostics.push(
              error(
                "E0003",
                "Frontmatter source.accessed must be YYYY-MM-DD.",
              ),
            );
          } else {
            source.accessed = record.accessed;
          }
        } else {
          diagnostics.push(
            error("E0003", "Frontmatter source.accessed must be a string."),
          );
        }
      }

      const extraKeys = Object.keys(record).filter(
        (key) => !["url", "title", "accessed"].includes(key),
      );
      if (extraKeys.length > 0) {
        diagnostics.push(
          error(
            "E0003",
            `Frontmatter source contains unsupported keys: ${extraKeys.join(", ")}`,
          ),
        );
      }

      return diagnostics.length > baseLength ? undefined : (source as Source);
    }

    if ("cookbook" in record) {
      const cookbook = record.cookbook;
      if (!cookbook || typeof cookbook !== "object" || Array.isArray(cookbook)) {
        diagnostics.push(
          error("E0003", "Frontmatter source.cookbook must be an object."),
        );
        return undefined;
      }

      const cookbookRecord = cookbook as Record<string, unknown>;
      const title = cookbookRecord.title;
      if (typeof title !== "string" || title.trim().length === 0) {
        diagnostics.push(
          error("E0003", "Frontmatter source.cookbook.title is required."),
        );
        return undefined;
      }

      const source: CookbookSource = {
        kind: "cookbook",
        title,
      };

      if ("author" in cookbookRecord) {
        if (typeof cookbookRecord.author === "string") {
          source.author = cookbookRecord.author;
        } else {
          diagnostics.push(
            error("E0003", "Frontmatter source.cookbook.author must be a string."),
          );
        }
      }

      if ("pages" in cookbookRecord) {
        const pages = cookbookRecord.pages;
        if (
          typeof pages === "string" ||
          typeof pages === "number"
        ) {
          source.pages = pages;
        } else {
          diagnostics.push(
            error("E0003", "Frontmatter source.cookbook.pages must be a string or number."),
          );
        }
      }

      if ("isbn" in cookbookRecord) {
        if (typeof cookbookRecord.isbn === "string") {
          source.isbn = cookbookRecord.isbn;
        } else {
          diagnostics.push(
            error("E0003", "Frontmatter source.cookbook.isbn must be a string."),
          );
        }
      }

      if ("year" in cookbookRecord) {
        if (typeof cookbookRecord.year === "number") {
          source.year = cookbookRecord.year;
        } else {
          diagnostics.push(
            error("E0003", "Frontmatter source.cookbook.year must be a number."),
          );
        }
      }

      const extraKeys = Object.keys(cookbookRecord).filter(
        (key) => !["title", "author", "pages", "isbn", "year"].includes(key),
      );
      if (extraKeys.length > 0) {
        diagnostics.push(
          error(
            "E0003",
            `Frontmatter source.cookbook contains unsupported keys: ${extraKeys.join(", ")}`,
          ),
        );
      }

      return diagnostics.length > baseLength ? undefined : (source as Source);
    }
  }

  diagnostics.push(
    error(
      "E0003",
      "Frontmatter source must be a string, URL object, or cookbook object.",
    ),
  );
  return undefined;
};

const normalizeScales = (
  value: unknown,
  diagnostics: Diagnostic[],
  knownIds?: Set<string>,
): ScalePreset[] | undefined => {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    diagnostics.push(
      error("E0002", "Frontmatter scales must be an array of presets."),
    );
    return undefined;
  }

  const presets: ScalePreset[] = [];

  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      diagnostics.push(
        error("E0002", "Frontmatter scales entries must be objects."),
      );
      continue;
    }

    const preset = entry as Record<string, unknown>;
    const name = preset.name;
    if (typeof name !== "string" || name.trim().length === 0) {
      diagnostics.push(
        error("E0002", "Scale preset name must be a non-empty string."),
      );
      continue;
    }

    if (!("anchor" in preset)) {
      diagnostics.push(
        error("E0002", `Scale preset "${name}" is missing anchor.`),
      );
      continue;
    }

    const anchorRaw = preset.anchor;
    if (typeof anchorRaw !== "string" || anchorRaw.trim().length === 0) {
      diagnostics.push(
        error("E0002", `Scale preset "${name}" anchor must be a non-empty string.`),
      );
      continue;
    }

    if (!("amount" in preset)) {
      diagnostics.push(
        error("E0002", `Scale preset "${name}" is missing amount.`),
      );
      continue;
    }

    const amountRaw = preset.amount;
    // YAML may parse a unitless amount (e.g. `amount: 4`) as a number
    const amountStr = typeof amountRaw === "number" && Number.isFinite(amountRaw)
      ? String(amountRaw)
      : typeof amountRaw === "string" ? amountRaw : null;
    if (!amountStr || amountStr.trim().length === 0) {
      diagnostics.push(
        error("E0002", `Scale preset "${name}" amount must be a quantity string (e.g. "150 g").`),
      );
      continue;
    }

    // Amount must start with a digit or fraction — reject bare unit strings
    if (!/^\d|^[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/.test(amountStr.trim())) {
      diagnostics.push(
        error("E0002", `Scale preset "${name}" amount "${amountStr}" is not a valid quantity.`),
      );
      continue;
    }

    const quantityResult = parseQuantity(amountStr, {
      line: 1,
      invalid: { code: "E0002", message: `Scale preset "${name}" amount "${amountStr}" is not a valid quantity.` },
    });
    if (quantityResult.diagnostics.length > 0) {
      diagnostics.push(...quantityResult.diagnostics);
    }
    if (!quantityResult.quantity) {
      continue;
    }

    const anchorSlug = slug(anchorRaw);
    if (knownIds && knownIds.size > 0 && !knownIds.has(anchorSlug)) {
      diagnostics.push(
        error(
          "E0002",
          `Scale preset "${name}" anchor "${anchorRaw}" does not match any known ingredient.`,
        ),
      );
      continue;
    }

    const extraKeys = Object.keys(preset).filter(
      (key) => !["name", "anchor", "amount"].includes(key),
    );
    if (extraKeys.length > 0) {
      diagnostics.push(
        error(
          "E0002",
          `Scale preset "${name}" contains unsupported keys: ${extraKeys.join(", ")}`,
        ),
      );
      continue;
    }

    presets.push({
      name,
      anchor: anchorRaw.trim(),
      amount: quantityResult.quantity,
    });
  }

  return presets;
};

const normalizeYield = (
  value: unknown,
  diagnostics: Diagnostic[],
): Quantity | undefined => {
  if (value === undefined) {
    return undefined;
  }

  // YAML may parse a unitless yield (e.g. `yield: 4`) as a number
  const yieldStr =
    typeof value === "number" && Number.isFinite(value)
      ? String(value)
      : typeof value === "string"
        ? value
        : null;

  if (!yieldStr || yieldStr.trim().length === 0) {
    diagnostics.push(
      error(
        "E0003",
        'Frontmatter yield must be a quantity string (e.g. "12 cookies").',
      ),
    );
    return undefined;
  }

  // Must start with a digit or vulgar fraction — reject bare text
  if (!/^\d|^[½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞]/.test(yieldStr.trim())) {
    diagnostics.push(
      error(
        "E0003",
        `Frontmatter yield "${yieldStr}" is not a valid quantity.`,
      ),
    );
    return undefined;
  }

  const quantityResult = parseQuantity(yieldStr, {
    line: 1,
    invalid: {
      code: "E0003",
      message: `Frontmatter yield "${yieldStr}" is not a valid quantity.`,
    },
  });
  if (quantityResult.diagnostics.length > 0) {
    diagnostics.push(...quantityResult.diagnostics);
  }
  return quantityResult.quantity ?? undefined;
};

const FRONTMATTER_PATTERN = /^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/;

export const extractFrontmatter = (
  input: string,
  options: ParseOptions = {},
): FrontmatterParseResult => {
  const match = FRONTMATTER_PATTERN.exec(input);
  if (!match) {
    return {
      frontmatter: null,
      body: input,
      diagnostics: [],
      bodyStartLine: 1,
    };
  }

  const yamlSource = match[1] ?? "";
  const rest = input.slice(match[0].length);
  const bodyStartLine = match[0].split("\n").length;
  const diagnostics: Diagnostic[] = [];
  let raw: unknown;

  try {
    raw = parseYaml(yamlSource) ?? {};
  } catch (parseError) {
    const message =
      parseError instanceof Error ? parseError.message : "Unknown YAML error";
    diagnostics.push(
      error("E0003", `Frontmatter YAML parse error: ${message}`),
    );
    return {
      frontmatter: null,
      body: rest,
      diagnostics,
      bodyStartLine,
    };
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    diagnostics.push(
      error("E0003", "Frontmatter must be a mapping/object."),
    );
    return {
      frontmatter: null,
      body: rest,
      diagnostics,
      bodyStartLine,
    };
  }

  const record = raw as Record<string, unknown>;
  const frontmatter: Partial<Frontmatter> = {};

  const versionValue = record.version;
  if (typeof versionValue !== "number" || !Number.isInteger(versionValue) || versionValue < 1) {
    diagnostics.push(
      error("E0001", 'Frontmatter must include a positive integer in "version".'),
    );
  } else {
    frontmatter.version = versionValue;
  }

  const source = normalizeSource(record.source, diagnostics);
  if (source) {
    frontmatter.source = source;
  }

  const knownIds = toKnownIds(options);
  const scales = normalizeScales(record.scales, diagnostics, knownIds);
  if (scales) {
    frontmatter.scales = scales;
  }

  const yieldQuantity = normalizeYield(record.yield, diagnostics);
  if (yieldQuantity) {
    frontmatter.yield = yieldQuantity;
  }

  const hasError = diagnostics.some((diag) => diag.severity === "error");
  return {
    frontmatter: hasError ? null : (frontmatter as Frontmatter),
    body: rest,
    diagnostics,
    bodyStartLine,
  };
};

/**
 * Serialize a Frontmatter object to a YAML frontmatter string
 * (including the `---` delimiters and trailing newline).
 */
export const serializeFrontmatter = (fm: Frontmatter): string => {
  const lines: string[] = [`version: ${fm.version}`];

  if (fm.source) {
    lines.push(`source: ${serializeSource(fm.source)}`);
  }

  if (fm.yield) {
    lines.push(`yield: ${fm.yield.raw}`);
  }

  if (fm.scales && fm.scales.length > 0) {
    lines.push("scales:");
    for (const preset of fm.scales) {
      lines.push(
        `  - name: ${preset.name}`,
        `    anchor: ${preset.anchor}`,
        `    amount: ${preset.amount.raw}`,
      );
    }
  }

  return `---\n${lines.join("\n")}\n---\n`;
};

const quoteIfNeeded = (s: string): string =>
  /[:{},\[\]"'#|>]/.test(s) ? `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : s;

const serializeSource = (source: Source): string => {
  switch (source.kind) {
    case "text":
      return quoteIfNeeded(source.value);
    case "url": {
      const parts = [`url: "${source.url}"`];
      if (source.title) parts.push(`title: ${quoteIfNeeded(source.title)}`);
      if (source.accessed) parts.push(`accessed: ${source.accessed}`);
      return `{ ${parts.join(", ")} }`;
    }
    case "cookbook": {
      const lines = [`  cookbook:`, `    title: ${quoteIfNeeded(source.title)}`];
      if (source.author) lines.push(`    author: ${quoteIfNeeded(source.author)}`);
      if (source.pages != null) lines.push(`    pages: ${typeof source.pages === "string" ? `"${source.pages}"` : source.pages}`);
      if (source.isbn) lines.push(`    isbn: "${source.isbn}"`);
      if (source.year != null) lines.push(`    year: ${source.year}`);
      return "\n" + lines.join("\n");
    }
  }
};
