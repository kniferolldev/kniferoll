import type {
  InvalidStepToken,
  StepQuantityToken,
  StepTemperatureToken,
  StepToken,
} from "./types";
import { parseQuantity } from "./quantity";

const TEMPERATURE_PATTERN = /^(-?\d+(?:\.\d+)?)[FCfc]$/;
const TOKEN_MATCHER = /\{([^}]+)\}/g;

export type ExtractStepTokensResult = {
  tokens: StepToken[];
  invalid: InvalidStepToken[];
};

const parseTokenBody = (
  body: string,
): { kind: "temperature"; value: number; scale: "F" | "C" } | null => {
  const trimmed = body.trim();
  if (trimmed === "") {
    return null;
  }

  const tempMatch = TEMPERATURE_PATTERN.exec(trimmed);
  if (tempMatch) {
    const [, value] = tempMatch;
    if (!value) {
      return null;
    }
    const scaleChar = trimmed[trimmed.length - 1]!;
    return {
      kind: "temperature",
      value: Number(value),
      scale: scaleChar.toUpperCase() as "F" | "C",
    };
  }

  return null;
};

export const extractStepTokens = (line: string): ExtractStepTokensResult => {
  const results: StepToken[] = [];
  const invalid: InvalidStepToken[] = [];

  for (const match of line.matchAll(TOKEN_MATCHER)) {
    const [full, body] = match;
    if (!full || !body) {
      continue;
    }
    const index =
      typeof match.index === "number" ? match.index : line.indexOf(full);

    // Try temperature first
    const parsed = parseTokenBody(body);
    if (parsed) {
      const token: StepTemperatureToken = {
        kind: "temperature",
        raw: full,
        index,
        value: parsed.value,
        scale: parsed.scale,
      };
      results.push(token);
      continue;
    }

    // Try quantity — body must contain at least one digit to be a valid inline quantity
    const trimmedBody = body.trim();
    if (!/\d/.test(trimmedBody)) {
      invalid.push({ raw: full, index });
      continue;
    }

    const quantityResult = parseQuantity(trimmedBody, {
      line: 0,
      invalid: { code: "W0403", message: "Unparseable inline value" },
    });

    if (quantityResult.quantity && quantityResult.diagnostics.length === 0) {
      const token: StepQuantityToken = {
        kind: "quantity",
        raw: full,
        index,
        quantity: quantityResult.quantity,
      };
      results.push(token);
    } else {
      invalid.push({ raw: full, index });
    }
  }

  return { tokens: results, invalid };
};

// ── Migration utility ────────────────────────────────────────────────
// Converts a timer token like "@30m" to prose like "30 minutes".
// Used by the Convex migration and eval golden file updates.

const TIMER_SEGMENT_PATTERN =
  /^(?:(?<hours>\d+)(?:h|hr))?(?:(?<minutes>\d+)(?:m|min))?(?:(?<seconds>\d+)(?:s|sec))?$/i;

const OLD_TEMPERATURE_PATTERN = /^(\d+)(?:°)?([FC])$/i;

interface TimerParts {
  hours: number;
  minutes: number;
  seconds: number;
}

const parseTimerSegment = (segment: string): TimerParts | null => {
  const match = TIMER_SEGMENT_PATTERN.exec(segment);
  if (!match) {
    return null;
  }

  const { hours = "0", minutes = "0", seconds = "0" } = match.groups as {
    hours?: string;
    minutes?: string;
    seconds?: string;
  };

  return {
    hours: Number(hours),
    minutes: Number(minutes),
    seconds: Number(seconds),
  };
};

const durationToProse = (d: TimerParts): string => {
  const parts: string[] = [];
  if (d.hours) {
    parts.push(`${d.hours} ${d.hours === 1 ? "hour" : "hours"}`);
  }
  if (d.minutes) {
    parts.push(`${d.minutes} ${d.minutes === 1 ? "minute" : "minutes"}`);
  }
  if (d.seconds) {
    parts.push(`${d.seconds} ${d.seconds === 1 ? "second" : "seconds"}`);
  }
  if (parts.length === 0) {
    return "0 seconds";
  }
  if (parts.length === 1) {
    return parts[0]!;
  }
  return parts.slice(0, -1).join(", ") + " and " + parts[parts.length - 1];
};

/**
 * Convert a timer token string (e.g. "@30m", "@1h15m") to prose
 * (e.g. "30 minutes", "1 hour and 15 minutes").
 * Returns null if the token doesn't look like a valid timer.
 */
export const timerTokenToProse = (token: string): string | null => {
  const body = token.startsWith("@") ? token.slice(1) : token;
  if (!body) return null;

  // Check for temperature patterns — leave those alone
  if (OLD_TEMPERATURE_PATTERN.test(body)) return null;

  const parsed = parseTimerSegment(body);
  if (parsed) {
    return durationToProse(parsed);
  }

  return null;
};
