import { expect, test } from "bun:test";
import { parseQuantity } from "./quantity";
import { scaleQuantity } from "./scale-quantity";

const q = (text: string) =>
  parseQuantity(text, {
    line: 1,
    invalid: { code: "ERR", message: "Invalid quantity" },
  }).quantity!;

test("scaleQuantity scales single quantities", () => {
  const quantity = q("2 cups");
  const scaled = scaleQuantity(quantity, 1.5);
  expect(scaled).toBeTruthy();
  if (scaled?.kind === "single") {
    expect(scaled.scaledValue).toBeCloseTo(3);
    expect(scaled.unitInfo?.canonical).toBe("cup");
    expect(scaled.unitInfo?.dimension).toBe("volume");
  }
});

test("scaleQuantity handles ranges", () => {
  const quantity = q("1-2 tbsp");
  const scaled = scaleQuantity(quantity, 2);
  expect(scaled).toBeTruthy();
  if (scaled?.kind === "range") {
    expect(scaled.scaledMin).toBeCloseTo(2);
    expect(scaled.scaledMax).toBeCloseTo(4);
    expect(scaled.unit).toBe("tbsp");
    expect(scaled.unitInfo?.rounding.increment).toBe(0.5);
  }
});

test("scaleQuantity returns null for missing quantity", () => {
  expect(scaleQuantity(null, 2)).toBeNull();
});

test("scaleQuantity ignores invalid factors", () => {
  expect(scaleQuantity(q("1 cup"), 0)).toBeNull();
  expect(scaleQuantity(q("1 cup"), Number.NaN)).toBeNull();
});

test("scaleQuantity preserves unknown units", () => {
  const quantity = q("2 glugs");
  const scaled = scaleQuantity(quantity, 2);
  expect(scaled).toBeTruthy();
  if (scaled?.kind === "single") {
    expect(scaled.unitInfo).toBeNull();
    expect(scaled.scaledValue).toBeCloseTo(4);
  }
});

test("scaleQuantity handles fractional cup scaling", () => {
  const quantity = q("1.5 cup");
  const scaled = scaleQuantity(quantity, 0.5);
  expect(scaled).toBeTruthy();
  if (scaled?.kind === "single") {
    expect(scaled.scaledValue).toBeCloseTo(0.75);
    expect(scaled.unit).toBe("cup");
  }
});

test("scaleQuantity respects rounding profiles for teaspoons", () => {
  const quantity = q("1 tsp");
  const scaled = scaleQuantity(quantity, 0.3333333);
  expect(scaled).toBeTruthy();
  if (scaled?.kind === "single") {
    expect(scaled.scaledValue).toBeCloseTo(0.25, 2);
  }
});

test("scaleQuantity preserves precision for small gram values", () => {
  const quantity = q("0.2 g");
  const scaled = scaleQuantity(quantity, 1.5);
  expect(scaled).toBeTruthy();
  if (scaled?.kind === "single") {
    expect(scaled.scaledValue).toBeCloseTo(0.3);
  }
});

test("scaleQuantity rounds ml to 1 increment", () => {
  const quantity = q("100 ml");
  const scaled = scaleQuantity(quantity, 1.3);
  expect(scaled).toBeTruthy();
  if (scaled?.kind === "single") {
    expect(scaled.scaledValue).toBeCloseTo(130);
  }
});

test("scaleQuantity scales compound quantities independently", () => {
  const quantity = q("1 cup + 3 tbsp");
  const scaled = scaleQuantity(quantity, 2);
  expect(scaled).toBeTruthy();
  if (scaled?.kind === "compound") {
    expect(scaled.scaledParts[0].scaledValue).toBeCloseTo(2);
    expect(scaled.scaledParts[0].unitInfo?.canonical).toBe("cup");
    expect(scaled.scaledParts[1].scaledValue).toBeCloseTo(6);
    expect(scaled.scaledParts[1].unitInfo?.canonical).toBe("tbsp");
  } else {
    throw new Error("expected compound scaled quantity");
  }
});

test("scaleQuantity handles range rounding", () => {
  const quantity = q("0.25-0.75 tsp");
  const scaled = scaleQuantity(quantity, 1.5);
  expect(scaled).toBeTruthy();
  if (scaled?.kind === "range") {
    expect(scaled.scaledMin).toBeCloseTo(0.5);
    expect(scaled.scaledMax).toBeCloseTo(1.25);
  }
});
