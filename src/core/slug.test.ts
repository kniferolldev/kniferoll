import { expect, test } from "bun:test";
import { slug } from "./slug";

test("slug normalizes whitespace and casing", () => {
  expect(slug("  Hello World  ")).toBe("hello-world");
});

test("slug removes invalid characters and collapses hyphens", () => {
  expect(slug("Hello!!! __World__")).toBe("hello-world");
});

test("slug normalizes accented characters to ASCII equivalents", () => {
  expect(slug("Atapiño")).toBe("atapino");
  expect(slug("crème brûlée")).toBe("creme-brulee");
  expect(slug("jalapeño")).toBe("jalapeno");
  expect(slug("über")).toBe("uber");
});
