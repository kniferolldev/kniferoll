import { expect, test } from "bun:test";
import { createIdRegistry } from "./id-registry";

test("register stores ids and allows lookup", () => {
  const registry = createIdRegistry();

  const result = registry.register("soup", {
    kind: "recipe",
    line: 1,
    name: "Soup",
  });

  expect(result.ok).toBe(true);
  expect(registry.has("soup")).toBe(true);
});

test("register detects duplicate ids", () => {
  const registry = createIdRegistry();
  registry.register("salt", {
    kind: "ingredient",
    line: 2,
    name: "Salt",
  });

  const duplicate = registry.register("salt", {
    kind: "ingredient",
    line: 4,
    name: "More Salt",
  });

  expect(duplicate.ok).toBe(false);
  if (duplicate.ok) {
    throw new Error("Expected duplicate registration to fail");
  }
  expect(duplicate.reason).toBe("duplicate");
});

test("empty ids are rejected and not stored", () => {
  const registry = createIdRegistry();
  const result = registry.register("  ", {
    kind: "ingredient",
    line: 3,
    name: "Pepper",
  });

  expect(result.ok).toBe(false);
  if (result.ok) {
    throw new Error("Expected empty id registration to fail");
  }
  expect(result.reason).toBe("empty");
  expect(registry.has("")).toBe(false);
});
