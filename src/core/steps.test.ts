import { expect, test } from "bun:test";
import { extractStepTokens, timerTokenToProse } from "./steps";

test("extractStepTokens parses temperatures", () => {
  const line = "Bake @350F for about 1 hour 15 minutes.";
  const { tokens, invalid } = extractStepTokens(line);

  expect(invalid.length).toBe(0);
  expect(tokens.length).toBe(1);

  expect(tokens[0]).toEqual(
    expect.objectContaining({
      kind: "temperature",
      value: 350,
      scale: "F",
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

test("extractStepTokens treats former timer syntax as invalid", () => {
  const line = "Bake @350F for @1h15m, then rest @20min.";
  const { tokens, invalid } = extractStepTokens(line);

  expect(tokens.length).toBe(1);
  expect(tokens[0]).toEqual(
    expect.objectContaining({ kind: "temperature", value: 350 }),
  );
  expect(invalid.length).toBe(2);
  expect(invalid[0]).toEqual(expect.objectContaining({ raw: "@1h15m" }));
  expect(invalid[1]).toEqual(expect.objectContaining({ raw: "@20min" }));
});

test("extractStepTokens rejects timer ranges with hyphen", () => {
  const line = "Roast until golden, @10-15m.";
  const { tokens, invalid } = extractStepTokens(line);

  expect(tokens.length).toBe(0);
  expect(invalid.length).toBe(1);
  expect(invalid[0]).toEqual(
    expect.objectContaining({
      raw: "@10-15m",
    }),
  );
});

// ── timerTokenToProse ────────────────────────────────────────────────

test("timerTokenToProse converts simple minutes", () => {
  expect(timerTokenToProse("@30m")).toBe("30 minutes");
  expect(timerTokenToProse("@1m")).toBe("1 minute");
});

test("timerTokenToProse converts simple hours", () => {
  expect(timerTokenToProse("@1h")).toBe("1 hour");
  expect(timerTokenToProse("@2h")).toBe("2 hours");
});

test("timerTokenToProse converts compound durations", () => {
  expect(timerTokenToProse("@1h15m")).toBe("1 hour and 15 minutes");
  expect(timerTokenToProse("@2h30m")).toBe("2 hours and 30 minutes");
});

test("timerTokenToProse converts seconds", () => {
  expect(timerTokenToProse("@30s")).toBe("30 seconds");
  expect(timerTokenToProse("@1s")).toBe("1 second");
});

test("timerTokenToProse converts full compound", () => {
  expect(timerTokenToProse("@1h15m30s")).toBe("1 hour, 15 minutes and 30 seconds");
});

test("timerTokenToProse returns null for temperatures", () => {
  expect(timerTokenToProse("@350F")).toBeNull();
  expect(timerTokenToProse("@190C")).toBeNull();
});

test("timerTokenToProse returns null for invalid tokens", () => {
  expect(timerTokenToProse("@10-15m")).toBeNull();
  expect(timerTokenToProse("@abc")).toBeNull();
});

test("timerTokenToProse works without @ prefix", () => {
  expect(timerTokenToProse("30m")).toBe("30 minutes");
  expect(timerTokenToProse("1h30m")).toBe("1 hour and 30 minutes");
});
