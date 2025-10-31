import { expect, test } from "bun:test";
import { extractStepTokens } from "./steps";

test("extractStepTokens parses temperatures and timers", () => {
  const line = "Bake @350F for @1h15m, then rest @20min.";
  const { tokens, invalid } = extractStepTokens(line);

  expect(invalid.length).toBe(0);
  expect(tokens.length).toBe(3);

  const [temp, longTimer, shortTimer] = tokens;

  expect(temp).toEqual(
    expect.objectContaining({
      kind: "temperature",
      value: 350,
      scale: "F",
    }),
  );

  expect(longTimer).toEqual(
    expect.objectContaining({
      kind: "timer",
      start: expect.objectContaining({ hours: 1, minutes: 15, seconds: 0 }),
    }),
  );

  expect(shortTimer).toEqual(
    expect.objectContaining({
      kind: "timer",
      start: expect.objectContaining({ hours: 0, minutes: 20, seconds: 0 }),
    }),
  );
});

test("extractStepTokens reports invalid tokens", () => {
  const line = "Rest @10mm then garnish.";
  const { tokens, invalid } = extractStepTokens(line);

  expect(tokens.length).toBe(0);
  expect(invalid).toEqual([
    expect.objectContaining({
      raw: "@10mm",
    }),
  ]);
});
