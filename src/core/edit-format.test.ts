import { describe, it, expect } from "bun:test";
import {
  reconstructIngredientLine,
  getAttributeTail,
  applyLineEdits,
  getSourceLines,
  buildSpanEdit,
  unwrapText,
  splitPrefix,
  wrapLine,
} from "./edit-format";

describe("reconstructIngredientLine", () => {
  it("builds a simple ingredient with name only", () => {
    expect(reconstructIngredientLine("kosher salt", null, null, null)).toBe(
      "- kosher salt",
    );
  });

  it("builds an ingredient with name and quantity", () => {
    expect(reconstructIngredientLine("flour", "2 cups", null, null)).toBe(
      "- flour - 2 cups",
    );
  });

  it("builds an ingredient with name, quantity, and modifiers", () => {
    expect(
      reconstructIngredientLine("flour", "2 cups", "sifted", null),
    ).toBe("- flour - 2 cups, sifted");
  });

  it("builds an ingredient with modifiers but no quantity", () => {
    expect(
      reconstructIngredientLine("parsley", null, "finely chopped", null),
    ).toBe("- parsley, finely chopped");
  });

  it("includes attribute tail", () => {
    expect(
      reconstructIngredientLine("rice", "2 cups", null, "id=rice also=12oz"),
    ).toBe("- rice - 2 cups :: id=rice also=12oz");
  });

  it("includes attribute tail with all parts", () => {
    expect(
      reconstructIngredientLine(
        "chorizo",
        "3-4 oz",
        "skin removed, finely diced",
        "id=chorizo also=90-120g",
      ),
    ).toBe(
      "- chorizo - 3-4 oz, skin removed, finely diced :: id=chorizo also=90-120g",
    );
  });

  it("handles attribute tail with no quantity", () => {
    expect(
      reconstructIngredientLine("kosher salt", null, null, "noscale"),
    ).toBe("- kosher salt :: noscale");
  });
});

describe("getAttributeTail", () => {
  it("returns null for lines without attributes", () => {
    expect(getAttributeTail("- flour - 2 cups")).toBeNull();
  });

  it("extracts attribute tail", () => {
    expect(getAttributeTail("- rice - 2 cups :: id=rice also=12oz")).toBe(
      "id=rice also=12oz",
    );
  });

  it("handles noscale attribute", () => {
    expect(getAttributeTail("- kosher salt :: noscale")).toBe("noscale");
  });

  it("returns null for empty attribute tail", () => {
    expect(getAttributeTail("- flour")).toBeNull();
  });

  it("handles continuation line content (indented)", () => {
    expect(
      getAttributeTail(
        "- peanut, rice bran, or other neutral oil - 2 tbsp :: id=oil also=30ml",
      ),
    ).toBe("id=oil also=30ml");
  });
});

describe("applyLineEdits", () => {
  const markdown = [
    "# Recipe",
    "",
    "## Ingredients",
    "",
    "- flour - 2 cups",
    "- sugar - 1 cup",
    "",
    "## Steps",
    "",
    "1. Mix everything",
  ].join("\n");

  it("replaces a single line", () => {
    const edits = new Map<number, string | null>();
    edits.set(5, "- flour - 3 cups");
    const result = applyLineEdits(markdown, edits);
    expect(result).toContain("- flour - 3 cups");
    expect(result).not.toContain("- flour - 2 cups");
  });

  it("deletes a line with null", () => {
    const edits = new Map<number, string | null>();
    edits.set(6, null);
    const result = applyLineEdits(markdown, edits);
    expect(result).not.toContain("- sugar - 1 cup");
    expect(result.split("\n").length).toBe(9); // one fewer line
  });

  it("handles multiple edits", () => {
    const edits = new Map<number, string | null>();
    edits.set(5, "- flour - 3 cups");
    edits.set(10, "1. Mix everything together");
    const result = applyLineEdits(markdown, edits);
    expect(result).toContain("- flour - 3 cups");
    expect(result).toContain("1. Mix everything together");
  });

  it("returns unchanged markdown for empty edits", () => {
    const edits = new Map<number, string | null>();
    expect(applyLineEdits(markdown, edits)).toBe(markdown);
  });
});

describe("getSourceLines", () => {
  const markdown = "line 1\nline 2\nline 3\nline 4\nline 5";

  it("extracts a single line", () => {
    expect(getSourceLines(markdown, 2, 2)).toBe("line 2");
  });

  it("extracts a range of lines", () => {
    expect(getSourceLines(markdown, 2, 4)).toBe("line 2\nline 3\nline 4");
  });
});

describe("buildSpanEdit", () => {
  it("replaces first line and deletes rest", () => {
    const edits = buildSpanEdit(5, 7, "new content");
    expect(edits.get(5)).toBe("new content");
    expect(edits.get(6)).toBeNull();
    expect(edits.get(7)).toBeNull();
    expect(edits.size).toBe(3);
  });

  it("handles single line span", () => {
    const edits = buildSpanEdit(5, 5, "new content");
    expect(edits.get(5)).toBe("new content");
    expect(edits.size).toBe(1);
  });
});

// ─── unwrapText ─────────────────────────────────────────────────

describe("unwrapText", () => {
  it("returns a single line unchanged", () => {
    expect(unwrapText("Hello world")).toBe("Hello world");
  });

  it("joins step continuation lines", () => {
    expect(
      unwrapText("1. Mix everything together\n   until combined"),
    ).toBe("1. Mix everything together until combined");
  });

  it("joins multiple continuation lines", () => {
    expect(unwrapText("1. A\n   B\n   C")).toBe("1. A B C");
  });

  it("joins bullet continuation lines", () => {
    expect(unwrapText("- Store pizza\n  in fridge")).toBe(
      "- Store pizza in fridge",
    );
  });

  it("joins plain paragraph lines", () => {
    expect(unwrapText("This is a\nlong paragraph")).toBe(
      "This is a long paragraph",
    );
  });

  it("returns empty string for empty input", () => {
    expect(unwrapText("")).toBe("");
  });

  it("trims trailing whitespace from lines", () => {
    expect(unwrapText("Hello world  \n  more text  ")).toBe(
      "Hello world more text",
    );
  });

  it("handles a single line with trailing newline", () => {
    expect(unwrapText("Hello\n")).toBe("Hello");
  });

  it("collapses multiple internal spaces", () => {
    expect(unwrapText("A   B")).toBe("A B");
  });

  it("handles lines that are only whitespace as empty", () => {
    expect(unwrapText("First line\n   \nThird line")).toBe(
      "First line Third line",
    );
  });
});

// ─── splitPrefix ────────────────────────────────────────────────

describe("splitPrefix", () => {
  it("extracts single-digit step number prefix", () => {
    expect(splitPrefix("1. Mix together")).toEqual({
      prefix: "1. ",
      content: "Mix together",
    });
  });

  it("extracts multi-digit step number prefix", () => {
    expect(splitPrefix("12. A step")).toEqual({
      prefix: "12. ",
      content: "A step",
    });
  });

  it("extracts dash bullet prefix", () => {
    expect(splitPrefix("- A bullet")).toEqual({
      prefix: "- ",
      content: "A bullet",
    });
  });

  it("extracts asterisk bullet prefix", () => {
    expect(splitPrefix("* A bullet")).toEqual({
      prefix: "* ",
      content: "A bullet",
    });
  });

  it("extracts h3 header prefix", () => {
    expect(splitPrefix("### A header")).toEqual({
      prefix: "### ",
      content: "A header",
    });
  });

  it("extracts h4 header prefix", () => {
    expect(splitPrefix("#### Sub-header")).toEqual({
      prefix: "#### ",
      content: "Sub-header",
    });
  });

  it("returns empty prefix for plain text", () => {
    expect(splitPrefix("Plain text")).toEqual({
      prefix: "",
      content: "Plain text",
    });
  });

  it("returns empty prefix and content for empty string", () => {
    expect(splitPrefix("")).toEqual({ prefix: "", content: "" });
  });

  it("does not match inline hash marks", () => {
    // "This has ### in the middle" should not extract a header prefix
    expect(splitPrefix("This has ### in middle")).toEqual({
      prefix: "",
      content: "This has ### in middle",
    });
  });

  it("does not match inline numbers with periods", () => {
    expect(splitPrefix("Score was 3.5 out of 10")).toEqual({
      prefix: "",
      content: "Score was 3.5 out of 10",
    });
  });

  it("handles step number with extra spaces", () => {
    // "1.  Double space" — the prefix includes all spaces after the dot
    expect(splitPrefix("1.  Double space")).toEqual({
      prefix: "1.  ",
      content: "Double space",
    });
  });
});

// ─── wrapLine ───────────────────────────────────────────────────

describe("wrapLine", () => {
  it("returns short text unchanged", () => {
    expect(wrapLine("1. Short step", 3, 80)).toBe("1. Short step");
  });

  it("wraps a long step with correct indentation", () => {
    expect(
      wrapLine(
        "1. A very long step that exceeds the width limit here",
        3,
        35,
      ),
    ).toBe("1. A very long step that exceeds\n   the width limit here");
  });

  it("wraps a bullet list item", () => {
    expect(
      wrapLine(
        "- Store pizza in the fridge for up to five days",
        2,
        30,
      ),
    ).toBe("- Store pizza in the fridge\n  for up to five days");
  });

  it("wraps a plain paragraph without indent", () => {
    expect(
      wrapLine("A long paragraph of text here", 0, 20),
    ).toBe("A long paragraph of\ntext here");
  });

  it("wraps to multiple continuation lines", () => {
    // Greedy fill: "1. A B C D E" = 12 chars fits in width 12
    expect(wrapLine("1. A B C D E F G H I J", 3, 12)).toBe(
      "1. A B C D E\n   F G H I J",
    );
  });

  it("does not break long words on the first line", () => {
    expect(wrapLine("1. Superlongword", 3, 10)).toBe(
      "1. Superlongword",
    );
  });

  it("does not break long words on continuation lines", () => {
    expect(wrapLine("- A verylongword", 2, 10)).toBe(
      "- A\n  verylongword",
    );
  });

  it("returns empty string for empty input", () => {
    expect(wrapLine("", 0, 80)).toBe("");
  });

  it("handles text at exactly maxWidth", () => {
    expect(wrapLine("1. Exact width!!", 3, 16)).toBe(
      "1. Exact width!!",
    );
  });

  it("uses default maxWidth of 80", () => {
    const short = "1. This is short";
    expect(wrapLine(short, 3)).toBe(short);
  });

  it("wraps multi-digit step numbers with correct indent", () => {
    expect(
      wrapLine("10. A step that wraps here nicely", 4, 25),
    ).toBe("10. A step that wraps\n    here nicely");
  });

  it("handles continuation with only one word per line", () => {
    // "- a bb" = 6 chars fits exactly in width 6
    expect(wrapLine("- a bb ccc", 2, 6)).toBe("- a bb\n  ccc");
  });

  it("preserves single-word first line that exceeds width", () => {
    // The word is too long for any line, but we never break words
    expect(wrapLine("Loremipsumdolorsit", 0, 5)).toBe(
      "Loremipsumdolorsit",
    );
  });

  it("does not orphan a bare bullet prefix", () => {
    expect(wrapLine("- Superlongword", 2, 10)).toBe("- Superlongword");
  });

  it("wraps after prefix+content when content exists", () => {
    // "- Short" (7) fits, then "more" causes wrap
    expect(wrapLine("- Short more words here", 2, 12)).toBe(
      "- Short more\n  words here",
    );
  });

  it("handles asterisk bullet list item", () => {
    expect(
      wrapLine("* A bullet item that wraps nicely", 2, 20),
    ).toBe("* A bullet item that\n  wraps nicely");
  });
});

// ─── roundtrip: unwrap → edit → wrap ────────────────────────────

describe("roundtrip: unwrap → edit → wrap", () => {
  it("step editing preserves format", () => {
    const raw = "1. Mix everything together\n   until well combined.";
    const unwrapped = unwrapText(raw);
    expect(unwrapped).toBe(
      "1. Mix everything together until well combined.",
    );
    const { prefix, content } = splitPrefix(unwrapped);
    expect(prefix).toBe("1. ");
    // Simulate user editing the text
    const edited = "Mix everything together until very well combined.";
    const wrapped = wrapLine(prefix + edited, prefix.length, 40);
    expect(wrapped).toBe(
      "1. Mix everything together until very\n   well combined.",
    );
  });

  it("note paragraph roundtrip", () => {
    const raw = "Store leftover pizza in\nthe refrigerator.";
    const unwrapped = unwrapText(raw);
    expect(unwrapped).toBe("Store leftover pizza in the refrigerator.");
    const { prefix, content } = splitPrefix(unwrapped);
    expect(prefix).toBe("");
    expect(content).toBe("Store leftover pizza in the refrigerator.");
    const wrapped = wrapLine(content, 0, 30);
    expect(wrapped).toBe(
      "Store leftover pizza in the\nrefrigerator.",
    );
  });

  it("bullet list item roundtrip", () => {
    const raw = "- Store pizza in the\n  refrigerator for days.";
    const unwrapped = unwrapText(raw);
    expect(unwrapped).toBe("- Store pizza in the refrigerator for days.");
    const { prefix, content } = splitPrefix(unwrapped);
    expect(prefix).toBe("- ");
    const wrapped = wrapLine(prefix + content, prefix.length, 30);
    expect(wrapped).toBe(
      "- Store pizza in the\n  refrigerator for days.",
    );
  });

  it("header roundtrip (no wrapping needed)", () => {
    const raw = "### Storage Tips";
    const unwrapped = unwrapText(raw);
    const { prefix, content } = splitPrefix(unwrapped);
    expect(prefix).toBe("### ");
    expect(content).toBe("Storage Tips");
    const wrapped = wrapLine(prefix + "Storage Tips", prefix.length);
    expect(wrapped).toBe("### Storage Tips");
  });

  it("multi-digit step number preserves indent width", () => {
    const raw = "10. Preheat the oven to\n    350 degrees.";
    const unwrapped = unwrapText(raw);
    expect(unwrapped).toBe("10. Preheat the oven to 350 degrees.");
    const { prefix } = splitPrefix(unwrapped);
    expect(prefix).toBe("10. ");
    const wrapped = wrapLine(
      prefix + "Preheat the oven to 350 degrees.",
      prefix.length,
      30,
    );
    expect(wrapped).toBe("10. Preheat the oven to 350\n    degrees.");
  });

  it("ordered list item roundtrip in notes", () => {
    const raw = "1. First note item that is\n   quite long.";
    const unwrapped = unwrapText(raw);
    const { prefix, content } = splitPrefix(unwrapped);
    expect(prefix).toBe("1. ");
    expect(content).toBe("First note item that is quite long.");
    const wrapped = wrapLine(prefix + content, prefix.length, 30);
    expect(wrapped).toBe(
      "1. First note item that is\n   quite long.",
    );
  });
});
