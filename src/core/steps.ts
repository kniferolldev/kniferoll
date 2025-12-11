import type {
  InvalidStepToken,
  StepTemperatureToken,
  StepTimerToken,
  StepToken,
  TimerDuration,
} from "./types";

const TEMPERATURE_PATTERN = /^(\d+)(?:°)?([FC])$/i;
const TOKEN_MATCHER = /@(?=\d)([0-9a-z°\-–]+)(?=[\s),.;:!?\-–]|$)/gi;
const TIMER_SEGMENT_PATTERN =
  /^(?:(?<hours>\d+)(?:h|hr))?(?:(?<minutes>\d+)(?:m|min))?(?:(?<seconds>\d+)(?:s|sec))?$/i;

export type ExtractStepTokensResult = {
  tokens: StepToken[];
  invalid: InvalidStepToken[];
};

const parseTimerSegment = (segment: string): TimerDuration | null => {
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

type ParsedStepToken =
  | { kind: "timer"; start: TimerDuration }
  | { kind: "temperature"; value: number; scale: "F" | "C" };

const parseTimerBody = (body: string): ParsedStepToken | null => {
  const duration = parseTimerSegment(body);
  if (!duration) {
    return null;
  }

  return { kind: "timer", start: duration };
};

const parseTokenBody = (body: string): ParsedStepToken | null => {
  const trimmed = body.trim();
  if (trimmed === "") {
    return null;
  }

  const tempMatch = TEMPERATURE_PATTERN.exec(trimmed);
  if (tempMatch) {
    const [, value, scaleRaw] = tempMatch;
    if (!value || !scaleRaw) {
      return null;
    }
    return { kind: "temperature", value: Number(value), scale: scaleRaw.toUpperCase() as "F" | "C" };
  }

  return parseTimerBody(trimmed);
};

export const extractStepTokens = (line: string): ExtractStepTokensResult => {
  const results: StepToken[] = [];
  const invalid: InvalidStepToken[] = [];

  for (const match of line.matchAll(TOKEN_MATCHER)) {
    const [full, body] = match;
    if (!full || !body) {
      continue;
    }
    const index = typeof match.index === "number" ? match.index : line.indexOf(full);
    const parsed = parseTokenBody(body);
    if (parsed) {
      if (parsed.kind === "timer") {
        const token: StepTimerToken = {
          kind: "timer",
          raw: full,
          index,
          start: parsed.start,
        };
        results.push(token);
      } else {
        const token: StepTemperatureToken = {
          kind: "temperature",
          raw: full,
          index,
          value: parsed.value,
          scale: parsed.scale,
        };
        results.push(token);
      }
    } else {
      invalid.push({ raw: full, index });
    }
  }

  return { tokens: results, invalid };
};
