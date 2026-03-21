import { describe, expect, test } from "bun:test";
import { exists, slugify } from "./fs";
import { join } from "node:path";

describe("exists", () => {
  test("returns true for existing file", async () => {
    // This test file itself exists
    const result = await exists(join(import.meta.dir, "fs.test.ts"));
    expect(result).toBe(true);
  });

  test("returns true for existing directory", async () => {
    const result = await exists(import.meta.dir);
    expect(result).toBe(true);
  });

  test("returns false for non-existent path", async () => {
    const result = await exists("/this/path/does/not/exist/at/all");
    expect(result).toBe(false);
  });
});

describe("slugify", () => {
  test("lowercases text", () => {
    expect(slugify("Hello World")).toBe("hello-world");
  });

  test("removes apostrophes", () => {
    expect(slugify("Mom's Recipe")).toBe("moms-recipe");
    expect(slugify("It's a test")).toBe("its-a-test");
  });

  test("removes curly apostrophes", () => {
    expect(slugify("Mom's Recipe")).toBe("moms-recipe");
  });

  test("replaces non-alphanumeric with hyphens", () => {
    expect(slugify("Hello, World!")).toBe("hello-world");
    expect(slugify("Test & More")).toBe("test-more");
  });

  test("removes leading and trailing hyphens", () => {
    expect(slugify("  Hello  ")).toBe("hello");
    expect(slugify("---test---")).toBe("test");
  });

  test("truncates to 60 characters", () => {
    const longText = "a".repeat(100);
    expect(slugify(longText).length).toBe(60);
  });

  test("handles real recipe titles", () => {
    expect(slugify("Grandma's Famous Chocolate Chip Cookies")).toBe(
      "grandmas-famous-chocolate-chip-cookies"
    );
    expect(slugify("Thai Green Curry (Vegan)")).toBe("thai-green-curry-vegan");
    expect(slugify("Pasta e Fagioli")).toBe("pasta-e-fagioli");
  });

  test("normalizes unicode characters", () => {
    expect(slugify("Bo Ssäm")).toBe("bo-ssam");
    expect(slugify("Danish Rye Bread (Rågbrød)")).toBe("danish-rye-bread-ragbrod");
    expect(slugify("Smørrebrød")).toBe("smorrebrod");
    expect(slugify("Jalapeño Poppers")).toBe("jalapeno-poppers");
    expect(slugify("Crème Brûlée")).toBe("creme-brulee");
  });

  test("handles empty string", () => {
    expect(slugify("")).toBe("");
  });

  test("handles string with only special characters", () => {
    expect(slugify("!!!")).toBe("");
  });
});
