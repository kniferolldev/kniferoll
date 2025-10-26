import { expect, test } from "bun:test";
import { slug } from "./slug";

test("slug normalizes whitespace and casing", () => {
  expect(slug("Hello World")).toBe("hello-world");
});

test("slug removes invalid characters and collapses hyphens", () => {
  expect(slug("Crème brûlée!")).toBe("crme-brle");
  expect(slug("Fish--Tacos!!")).toBe("fish-tacos");
});
