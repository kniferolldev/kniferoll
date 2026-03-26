/// <reference lib="dom" />

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { parseDocument } from "../core/parser";

class FakeShadowRoot {
  innerHTML = "";
}

class FakeHTMLElement {
  shadowRoot: FakeShadowRoot | null = null;
  #text = "";
  #attributes = new Map<string, string>();
  #listeners = new Map<string, Set<(e: Event) => void>>();

  get textContent(): string {
    return this.#text;
  }

  set textContent(value: string) {
    this.#text = value;
  }

  attachShadow(_: ShadowRootInit): FakeShadowRoot {
    if (!this.shadowRoot) {
      this.shadowRoot = new FakeShadowRoot();
    }
    return this.shadowRoot;
  }

  addEventListener(type: string, listener: (e: Event) => void) {
    if (!this.#listeners.has(type)) {
      this.#listeners.set(type, new Set());
    }
    this.#listeners.get(type)!.add(listener);
  }

  removeEventListener(type: string, listener: (e: Event) => void) {
    this.#listeners.get(type)?.delete(listener);
  }

  dispatchEvent(event: Event): boolean {
    const listeners = this.#listeners.get(event.type);
    if (listeners) {
      for (const listener of listeners) {
        listener(event);
      }
    }
    return true;
  }

  setAttribute(name: string, value: string) {
    const oldValue = this.#attributes.get(name) ?? null;
    this.#attributes.set(name, value);
    this.#notifyAttributeChanged(name, oldValue, value);
  }

  getAttribute(name: string): string | null {
    return this.#attributes.has(name) ? this.#attributes.get(name)! : null;
  }

  removeAttribute(name: string) {
    if (!this.#attributes.has(name)) {
      return;
    }
    const oldValue = this.#attributes.get(name) ?? null;
    this.#attributes.delete(name);
    this.#notifyAttributeChanged(name, oldValue, null);
  }

  hasAttribute(name: string): boolean {
    return this.#attributes.has(name);
  }

  #notifyAttributeChanged(name: string, oldValue: string | null, newValue: string | null) {
    const callback = (this as unknown as {
      attributeChangedCallback?: (attributeName: string, oldVal: string | null, newVal: string | null) => void;
    }).attributeChangedCallback;
    if (typeof callback === "function") {
      callback.call(this, name, oldValue, newValue);
    }
  }
}

class FakeCustomElementsRegistry {
  #map = new Map<string, unknown>();

  define(name: string, ctor: unknown) {
    if (this.#map.has(name)) {
      throw new Error(`Element "${name}" already defined in fake registry.`);
    }
    this.#map.set(name, ctor);
  }

  get(name: string) {
    return this.#map.get(name);
  }

  whenDefined(): Promise<void> {
    return Promise.resolve();
  }
}

const originalHTMLElement = (globalThis as Record<string, unknown>).HTMLElement;
const originalCustomElements = (globalThis as Record<string, unknown>).customElements;

let registry: FakeCustomElementsRegistry;
let componentModule: typeof import("./component") | null = null;

beforeAll(async () => {
  registry = new FakeCustomElementsRegistry();
  const globalAny = globalThis as Record<string, unknown>;
  globalAny.HTMLElement = FakeHTMLElement;
  globalAny.customElements = registry;

  componentModule = await import("./component");
});

afterAll(() => {
  if (originalHTMLElement === undefined) {
    // bun doesn't define HTMLElement by default; remove our fake.
    delete (globalThis as Record<string, unknown>).HTMLElement;
  } else {
    (globalThis as Record<string, unknown>).HTMLElement = originalHTMLElement;
  }

  if (originalCustomElements === undefined) {
    delete (globalThis as Record<string, unknown>).customElements;
  } else {
    (globalThis as Record<string, unknown>).customElements = originalCustomElements;
  }
});

test("registers <kr-recipe> during module evaluation", () => {
  expect(componentModule).not.toBeNull();
  expect(registry.get("kr-recipe")).toBe(componentModule?.KrRecipeElement);
});

test("renderDocument outputs titles and section headings", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Doc Title",
    "",
    "# First Recipe",
    "## Ingredients",
    "- one item",
    "## Steps",
    "1. Do the thing.",
    "",
    "# Second Recipe",
    "## Ingredients",
    "- another item",
    "## Steps",
    "1. Do the next thing.",
  ].join("\n");

  const parsed = parseDocument(markdown);
  const html = componentModule.renderDocument(parsed);

  expect(html).toContain("Doc Title");
  expect(html).toContain("First Recipe");
  expect(html).toContain("Second Recipe");
  expect(html).toContain("Ingredients");
  expect(html).toContain("Steps");
  expect(html).toContain('data-kr-role="main"');
  expect(html).toContain('data-kr-layout="stacked"');
});

test("KrRecipeElement renders markdown content into shadow root", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const { KrRecipeElement } = componentModule;
  const element = new KrRecipeElement();
  element.content = [
    "# Collection",
    "",
    "# Soup",
    "## Ingredients",
    "- salt",
    "## Steps",
    "1. Stir.",
  ].join("\n");

  element.connectedCallback();

  const html = element.shadowRoot?.innerHTML ?? "";
  expect(html).toContain("Collection");
  expect(html).toContain("Soup");
  expect(html).toContain("Ingredients");
  expect(html).toContain("Steps");
});

test("ingredients render quantity, modifiers, and attributes", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Test",
    "",
    "# Salad",
    "## Ingredients",
    '- sugar - 1 cup, finely ground :: id=super-sugar also="200 g" noscale',
    "- lettuce",
    "## Steps",
    "1. Toss.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  expect(html).toContain('class="kr-ingredient-list"');
  expect(html).toContain('class="kr-ingredient__quantity"');
  expect(html).toContain('data-kr-quantity="1 cup"');
  expect(html).toContain("finely ground");
  expect(html).toContain('data-kr-attr-also="200 g"');
  expect(html).toContain('data-kr-attr-noscale="true"');
  expect(html).toContain('data-kr-id="super-sugar"');
  expect(html).toContain('data-kr-quantity-mode="native"');
});

test("renderDocument renders temperature tokens", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Demo",
    "",
    "# Roast",
    "## Steps",
    "1. Preheat to {350F}.",
    "2. Bake 35 minutes until browned.",
    "3. Rest 10 minutes before slicing.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  expect(html).toContain('class="kr-temperature"');
  expect(html).toContain('data-kr-temperature-scale="F"');
  expect(html).not.toContain('class="kr-timer"');
});

test("renderDocument renders diagnostics controls according to mode", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Broken",
    "",
    "# Incomplete",
    "## Ingredients",
    "- salt",
  ].join("\n");

  const parsed = parseDocument(markdown);
  expect(parsed.diagnostics.length).toBeGreaterThan(0);

  const summaryHtml = componentModule.renderDocument(parsed);
  expect(summaryHtml).toContain('class="kr-diagnostics"');
  expect(summaryHtml).toContain('data-kr-mode="summary"');

  const panelHtml = componentModule.renderDocument(parsed, { diagnosticsMode: "panel" });
  expect(panelHtml).toContain('data-kr-mode="panel"');
  expect(panelHtml).toContain("<details");
  expect(panelHtml).toContain("open");

  const offHtml = componentModule.renderDocument(parsed, { diagnosticsMode: "off" });
  expect(offHtml).not.toContain('class="kr-diagnostics"');
  expect(offHtml).toContain(`data-kr-diagnostics-count="${parsed.diagnostics.length}"`);

  const inlineHtml = componentModule.renderDocument(parsed, { diagnosticsMode: "inline" });
  expect(inlineHtml).toContain('kr-diagnostic-target');
  expect(inlineHtml).toContain('data-kr-diagnostic-severity="error"');
});

test("inline diagnostics attach to element spanning continuation lines", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  // The reference [[penne]] on line 7 is unresolved, but the notes paragraph
  // starts on line 6. The diagnostic marker should appear on the paragraph element.
  const markdown = [
    "# Pasta",                                // 1
    "## Ingredients",                          // 2
    "- pasta - 1 lb",                          // 3
    "## Steps",                                // 4
    "1. Cook [[pasta]].",                      // 5
    "## Notes",                                // 6
    "- This is great with",                    // 7
    "  factory-made [[penne]].",               // 8
  ].join("\n");

  const parsed = parseDocument(markdown);
  // [[penne]] should be unresolved
  const w0302 = parsed.diagnostics.filter((d) => d.code === "W0302");
  expect(w0302.length).toBe(1);
  expect(w0302[0]!.line).toBe(8);

  const html = componentModule.renderDocument(parsed, { diagnosticsMode: "inline" });
  // The notes paragraph starts at line 7 — it should have the diagnostic marker
  // despite the diagnostic being on line 8 (a continuation line)
  expect(html).toContain('data-kr-diagnostic-severity="warning"');
  // The diagnostic popover should mention W0302
  expect(html).toContain("W0302");
});

test("step references include aria-controls and focusable targets", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Demo",
    "",
    "# Seasoning",
    "## Ingredients",
    "- red pepper flakes – pinch",
    "- salt - 1 tsp",
    "## Steps",
    "1. Bloom [[red-pepper-flakes]] with [[salt]].",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));
  expect(html).toContain('id="kr-ingredient-red-pepper-flakes"');
  expect(html).toContain('aria-controls="kr-ingredient-red-pepper-flakes"');
  expect(html).toContain('id="kr-ingredient-salt"');

  const { KrRecipeElement } = componentModule;
  const element = new KrRecipeElement();
  element.content = markdown;
  element.connectedCallback();

  const rendered = element.shadowRoot?.innerHTML ?? "";
  expect(rendered).toContain('aria-controls="kr-ingredient-red-pepper-flakes"');
  expect(rendered).toContain('id="kr-ingredient-red-pepper-flakes"');
  expect(rendered).toContain('tabindex="-1"');
});

test("KrRecipeElement responds to scale and quantity-display attributes", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const { KrRecipeElement } = componentModule;
  const element = new KrRecipeElement();
  element.content = [
    "# Demo",
    "",
    "# Porridge",
    "## Ingredients",
    '- oats - 1 cup :: also="90 g"',
    "## Steps",
    "1. Cook.",
  ].join("\n");

  element.connectedCallback();

  const initial = element.shadowRoot?.innerHTML ?? "";
  expect(initial).toContain('data-kr-quantity="1 cup"');

  element.setAttribute("scale", "3");
  const scaled = element.shadowRoot?.innerHTML ?? "";
  expect(scaled).toContain('data-kr-quantity="3 cups"');

  // "metric" mode shows alternate mass quantity, native in tooltip
  element.setAttribute("quantity-display", "metric");
  const metricHtml = element.shadowRoot?.innerHTML ?? "";
  expect(metricHtml).toContain('data-kr-quantity-mode="metric"');
  expect(metricHtml).toContain('data-kr-quantity="270 g"');
  expect(metricHtml).toContain('title="3 cups"');
  expect(metricHtml).not.toContain("kr-ingredient__quantity-secondary");

  element.setAttribute("layout", "two-column");
  const layoutHtml = element.shadowRoot?.innerHTML ?? "";
  expect(layoutHtml).toContain('data-kr-layout="two-column"');

  element.setAttribute("diagnostics", "panel");
  element.content = [
    "# Demo",
    "",
    "# Incomplete",
    "## Ingredients",
    "- salt",
  ].join("\n");

  const diagnosticsHtml = element.shadowRoot?.innerHTML ?? "";
  expect(diagnosticsHtml).toContain('class="kr-diagnostics"');
  expect(diagnosticsHtml).toContain('data-kr-mode="panel"');

  element.setAttribute("diagnostics", "off");
  const removedDiagnosticsHtml = element.shadowRoot?.innerHTML ?? "";
  expect(removedDiagnosticsHtml).not.toContain('class="kr-diagnostics"');

  element.setAttribute("diagnostics", "inline");
  const inlineDiagnosticsHtml = element.shadowRoot?.innerHTML ?? "";
  expect(inlineDiagnosticsHtml).toContain('kr-diagnostic-target');
});

test("renderDocument applies scale factor and alternate quantity display", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Scale Test",
    "",
    "# Cookies",
    "## Ingredients",
    '- flour - 1 cup :: also="120 g"',
    "## Steps",
    "1. Mix.",
  ].join("\n");

  const parsed = parseDocument(markdown);
  const scaledHtml = componentModule.renderDocument(parsed, { scaleFactor: 2 });
  expect(scaledHtml).toContain('data-kr-quantity="2 cups"');
  expect(scaledHtml).toContain('data-kr-quantity-mode="native"');

  const altHtml = componentModule.renderDocument(parsed, {
    quantityDisplay: "metric",
  });
  expect(altHtml).toContain('data-kr-quantity-mode="metric"');
  expect(altHtml).toContain('data-kr-quantity="120 g"');
  expect(altHtml).toContain('title="1 cup"');

  const layoutHtml = componentModule.renderDocument(parsed, {
    layout: "two-column",
  });
  expect(layoutHtml).toContain('data-kr-layout="two-column"');
});

test("step references render as interactive targets", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Demo",
    "",
    "# Soup",
    "## Ingredients",
    "- kosher salt",
    "## Steps",
    "1. Season with [[kosher-salt]].",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));
  expect(html).toContain('class="kr-ref"');
  expect(html).toContain('data-kr-target="kosher-salt"');
  expect(html).toContain(">kosher salt<");
});

test("trailing punctuation after reference wraps as a unit with the reference", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Soup",
    "## Ingredients",
    "- chard - 1 bunch",
    "- broth - 4 cups",
    "## Steps",
    "1. Add the [[chard]], and cook with [[broth]].",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));
  // Comma after [[chard]] must be inside the nowrap span so it doesn't wrap separately
  expect(html).toMatch(/chard<\/span>,<\/span>/);
  // Period after [[broth]] must also be kept with the reference
  expect(html).toMatch(/broth<\/span>\.<\/span>/);
});

test("ingredients render with wrapper div for highlight compatibility", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Test",
    "",
    "# Recipe",
    "## Ingredients",
    "- salt - 1 tsp",
    "- pepper",
    "## Steps",
    "1. Season with [[salt]] and [[pepper]].",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  // Check that ingredients have wrapper div for grid layout
  expect(html).toContain('class="kr-ingredient__wrapper"');

  // Check that ingredient references have aria-controls for accessibility
  expect(html).toContain('aria-controls="kr-ingredient-salt"');
  expect(html).toContain('aria-controls="kr-ingredient-pepper"');

  // Check that ingredients have proper IDs for targeting
  expect(html).toContain('id="kr-ingredient-salt"');
  expect(html).toContain('id="kr-ingredient-pepper"');
});

test("multi-ingredient reference renders with space-separated targets", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Dinner",
    "",
    "# Bo Ssäm",
    "## Ingredients",
    "- kimchi - 1 cup",
    "- rice - 2 cups",
    "- ssäm sauce - 1/2 cup",
    "## Steps",
    "1. Serve with [[accompaniments -> kimchi, rice, ssäm sauce]].",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));
  expect(html).toContain('data-kr-target="kimchi rice ssam-sauce"');
  expect(html).toContain(">accompaniments<");
  expect(html).toContain('aria-controls="kr-ingredient-kimchi kr-ingredient-rice kr-ingredient-ssam-sauce"');
});

test("renderDocument includes intro text", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Demo",
    "",
    "# Soup Recipe",
    "A warming soup for cold days.",
    "## Ingredients",
    "- salt",
    "## Steps",
    "1. Stir.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  expect(html).toContain('class="kr-intro"');
  expect(html).toContain('class="kr-intro__p"');
  expect(html).toContain("A warming soup for cold days.");
});

test("renderDocument renders intro markdown formatting", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Demo",
    "",
    "# Test Recipe",
    "This is **bold** and *italic* text.",
    "## Ingredients",
    "- salt",
    "## Steps",
    "1. Cook.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  expect(html).toContain("<strong>bold</strong>");
  expect(html).toContain("<em>italic</em>");
});

test("renderDocument renders intro links", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Demo",
    "",
    "# Test Recipe",
    "See [this link](https://example.com) for more.",
    "## Ingredients",
    "- salt",
    "## Steps",
    "1. Cook.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  expect(html).toContain('href="https://example.com"');
  expect(html).toContain(">this link</a>");
});

test("renderDocument handles multiple intro paragraphs", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Demo",
    "",
    "# Test Recipe",
    "First paragraph.",
    "",
    "Second paragraph.",
    "## Ingredients",
    "- salt",
    "## Steps",
    "1. Cook.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  // Should have two paragraphs
  const matches = html.match(/class="kr-intro__p"/g);
  expect(matches).toHaveLength(2);
  expect(html).toContain("First paragraph.");
  expect(html).toContain("Second paragraph.");
});

test("renderDocument renders notes with subsection headers", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Demo",
    "",
    "# Test Recipe",
    "## Ingredients",
    "- salt",
    "## Steps",
    "1. Cook.",
    "## Notes",
    "### Before You Start",
    "Prep all ingredients first.",
    "### Storage",
    "Store in an airtight container.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  expect(html).toContain('data-kr-kind="notes"');
  expect(html).toContain('class="kr-notes__header"');
  expect(html).toContain(">Before You Start</h4>");
  expect(html).toContain(">Storage</h4>");
  expect(html).toContain('class="kr-notes__paragraph"');
  expect(html).toContain("Prep all ingredients first.");
});

test("renderDocument renders notes with bullet lists", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Demo",
    "",
    "# Test Recipe",
    "## Ingredients",
    "- salt",
    "## Steps",
    "1. Cook.",
    "## Notes",
    "- First tip",
    "- Second tip",
    "- Third tip",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  expect(html).toContain('class="kr-notes__list kr-notes__list--unordered"');
  expect(html).toContain('class="kr-notes__list-item"');
  expect(html).toContain(">First tip</li>");
  expect(html).toContain(">Second tip</li>");
});

test("renderDocument renders notes with numbered lists", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Demo",
    "",
    "# Test Recipe",
    "## Ingredients",
    "- salt",
    "## Steps",
    "1. Cook.",
    "## Notes",
    "1. First step",
    "2. Second step",
    "3. Third step",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  expect(html).toContain('class="kr-notes__list kr-notes__list--ordered"');
  expect(html).toContain(">First step</li>");
  expect(html).toContain(">Second step</li>");
});

test("renderDocument renders notes with inline formatting", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Demo",
    "",
    "# Test Recipe",
    "## Ingredients",
    "- salt",
    "## Steps",
    "1. Cook.",
    "## Notes",
    "This is **bold** and *italic* text.",
    "See [this link](https://example.com) for more.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  expect(html).toContain("<strong>bold</strong>");
  expect(html).toContain("<em>italic</em>");
  expect(html).toContain('href="https://example.com"');
  expect(html).toContain(">this link</a>");
});

test("renderDocument renders references in notes", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Sticky Toffee Pudding",
    "## Ingredients",
    "- brown sugar - 1 cup",
    "- butter - 4 tbsp",
    "- cream - 1/2 cup",
    "## Steps",
    "1. Make the pudding.",
    "## Notes",
    "- Combine [[brown sugar]], [[butter]], and [[cream]] in a saucepan.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  // References in notes should render as interactive spans, not bare text
  expect(html).toContain('class="kr-ref"');
  expect(html).toContain('data-kr-target="brown-sugar"');
  expect(html).toContain('data-kr-target="butter"');
  expect(html).toContain('data-kr-target="cream"');
  // Should NOT contain raw bracket syntax
  expect(html).not.toContain("[[brown sugar]]");
  expect(html).not.toContain("[[butter]]");
  expect(html).not.toContain("[[cream]]");
});

test("renderDocument renders inline values in notes list items", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Test Recipe",
    "## Ingredients",
    "- butter - 4 tbsp",
    "## Steps",
    "1. Make the toffee.",
    "## Notes",
    "- Reheat at {325F} for 30 minutes.",
    "- You should have about {3 cups} of sauce.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  // Temperatures in notes should render as kr-temperature spans
  expect(html).toContain('class="kr-temperature"');
  // Scalable quantities in notes should render as kr-inline-quantity spans
  expect(html).toContain('class="kr-inline-quantity"');
  // Should NOT contain raw curly brace syntax
  expect(html).not.toContain("{325F}");
  expect(html).not.toContain("{3 cups}");
});

test("renderDocument renders inline values in notes paragraphs", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Test Recipe",
    "## Ingredients",
    "- butter - 4 tbsp",
    "## Steps",
    "1. Make the toffee.",
    "## Notes",
    "",
    "Short ribs vary in size; look for thick, meaty pieces about",
    "{6 oz} each. You can braise a day ahead — reheat at {325F}",
    "for 30 minutes.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  // Inline values in note paragraphs should be rendered
  expect(html).toContain('class="kr-temperature"');
  expect(html).toContain('class="kr-inline-quantity"');
  expect(html).not.toContain("{6 oz}");
  expect(html).not.toContain("{325F}");
});

test("renderDocument renders inline values in intro text", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Test Recipe",
    "",
    "This makes about {12} servings. Preheat your oven to {350F}.",
    "",
    "## Ingredients",
    "- butter - 4 tbsp",
    "## Steps",
    "1. Make it.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  // Inline values in intro should be rendered
  expect(html).toContain('class="kr-temperature"');
  expect(html).toContain('class="kr-inline-quantity"');
  expect(html).not.toContain("{12}");
  expect(html).not.toContain("{350F}");
});

test("renderDocument renders notes with mixed content", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Demo",
    "",
    "# Test Recipe",
    "## Ingredients",
    "- salt",
    "## Steps",
    "1. Cook.",
    "## Notes",
    "### Tips",
    "Some intro text.",
    "",
    "- Bullet one",
    "- Bullet two",
    "",
    "1. Step one",
    "2. Step two",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  expect(html).toContain(">Tips</h4>");
  expect(html).toContain('class="kr-notes__paragraph"');
  expect(html).toContain('class="kr-notes__list kr-notes__list--unordered"');
  expect(html).toContain('class="kr-notes__list kr-notes__list--ordered"');
});

test("notes preserve line numbers for diagnostics", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Demo",
    "",
    "# Test Recipe",
    "## Ingredients",
    "- salt",
    "## Steps",
    "1. Cook.",
    "## Notes",
    "First note line.",
    "- A list item",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  // Notes elements should have data-kr-line attributes
  expect(html).toMatch(/class="kr-notes__paragraph"[^>]*data-kr-line="\d+"/);
  expect(html).toMatch(/class="kr-notes__list-item"[^>]*data-kr-line="\d+"/);
});

test("renderDocument renders steps with inline formatting", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Demo",
    "",
    "# Test Recipe",
    "## Ingredients",
    "- salt",
    "## Steps",
    "1. This is **bold** and *italic* text.",
    "2. See [this link](https://example.com) for more.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  expect(html).toContain("<strong>bold</strong>");
  expect(html).toContain("<em>italic</em>");
  expect(html).toContain('href="https://example.com"');
  expect(html).toContain(">this link</a>");
});

test("imperial quantity-display prefers non-metric also values", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Demo",
    "",
    "# Bread",
    "## Ingredients",
    '- flour - 500 g :: also="4 cup"',
    "## Steps",
    "1. Mix.",
  ].join("\n");

  const parsed = parseDocument(markdown);
  const html = componentModule.renderDocument(parsed, {
    quantityDisplay: "imperial",
  });
  expect(html).toContain('data-kr-quantity-mode="imperial"');
  expect(html).toContain('data-kr-quantity="4 cups"');
  expect(html).toContain('title="500 g"');
});

test("temperature-display C converts F temperatures", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Demo",
    "",
    "# Roast",
    "## Steps",
    "1. Preheat to {350F}.",
  ].join("\n");

  const parsed = parseDocument(markdown);
  const html = componentModule.renderDocument(parsed, {
    temperatureDisplay: "C",
  });
  // 350F → ~177C
  expect(html).toContain("177&deg;C");
  expect(html).toContain('title="350\u00b0F"');
});

test("temperature-display F converts C temperatures", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Demo",
    "",
    "# Roast",
    "## Steps",
    "1. Preheat to {180C}.",
  ].join("\n");

  const parsed = parseDocument(markdown);
  const html = componentModule.renderDocument(parsed, {
    temperatureDisplay: "F",
  });
  // 180C → 356F
  expect(html).toContain("356&deg;F");
  expect(html).toContain('title="180\u00b0C"');
});

test("temperature-display unset shows native temperature", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Demo",
    "",
    "# Roast",
    "## Steps",
    "1. Preheat to {350F}.",
  ].join("\n");

  const parsed = parseDocument(markdown);
  const html = componentModule.renderDocument(parsed);
  expect(html).toContain("350&deg;F");
  // Native mode: tooltip shows approx conversion, not native temp
  expect(html).not.toContain('title="350\u00b0F"');
});

test("KrRecipeElement responds to temperature-display attribute", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const { KrRecipeElement } = componentModule;
  const element = new KrRecipeElement();
  element.content = [
    "# Demo",
    "",
    "# Roast",
    "## Steps",
    "1. Preheat to {350F}.",
  ].join("\n");

  element.connectedCallback();

  const native = element.shadowRoot?.innerHTML ?? "";
  expect(native).toContain("350&deg;F");
  expect(native).not.toContain('title="350\u00b0F"');

  element.setAttribute("temperature-display", "C");
  const celsiusHtml = element.shadowRoot?.innerHTML ?? "";
  expect(celsiusHtml).toContain("177&deg;C");
  expect(celsiusHtml).toContain('title="350\u00b0F"');
});

// ─── Interactive Recipe Scaling ───

test("renderDocument emits data-kr-scalable on ingredients", () => {
  if (!componentModule) throw new Error("Component module was not initialized");

  const markdown = `# Demo\n\n# R\n## Ingredients\n- flour - 2 cups\n- salt\n- parmesan - 30 g :: noscale\n## Steps\n1. Mix.`;
  const html = componentModule.renderDocument(parseDocument(markdown));

  // flour has quantity, no noscale → scalable
  expect(html).toMatch(/data-kr-id="flour"[^>]*data-kr-scalable="true"/);
  // salt has no quantity → not scalable
  expect(html).toMatch(/data-kr-id="salt"[^>]*data-kr-scalable="false"/);
  // parmesan has quantity but noscale → not scalable
  expect(html).toMatch(/data-kr-id="parmesan"[^>]*data-kr-scalable="false"/);
});

test("renderDocument includes scale toggle button in main recipe header", () => {
  if (!componentModule) throw new Error("Component module was not initialized");

  const markdown = `# Demo\n\n# Soup\n## Ingredients\n- salt - 1 tsp\n## Steps\n1. Stir.`;
  const html = componentModule.renderDocument(parseDocument(markdown));
  // Extract content after </style>
  const content = html.slice(html.indexOf("</style>") + 8);

  expect(content).toContain('class="kr-scale-toggle"');
  expect(content).toContain('aria-label="Scale recipe"');
  // Only one toggle (main recipe only)
  expect(content.match(/class="kr-scale-toggle"/g)).toHaveLength(1);
});

test("renderDocument does not show scale toggle for secondary recipes", () => {
  if (!componentModule) throw new Error("Component module was not initialized");

  const markdown = `# Doc\n\n# Main\n## Ingredients\n- salt - 1 tsp\n## Steps\n1. A.\n\n# Side\n## Ingredients\n- pepper\n## Steps\n1. B.`;
  const html = componentModule.renderDocument(parseDocument(markdown));
  const content = html.slice(html.indexOf("</style>") + 8);

  // One toggle only (on the main recipe)
  expect(content.match(/class="kr-scale-toggle"/g)).toHaveLength(1);
});

test("renderDocument includes hidden scale bar with canned options", () => {
  if (!componentModule) throw new Error("Component module was not initialized");

  const markdown = `# Demo\n\n# Soup\n## Ingredients\n- salt - 1 tsp\n## Steps\n1. Stir.`;
  const html = componentModule.renderDocument(parseDocument(markdown));

  expect(html).toContain('class="kr-scale-bar"');
  expect(html).toContain("hidden");
  // Canned chips
  expect(html).toContain('data-kr-scale-value="1"');
  expect(html).toContain('data-kr-scale-value="0.5"');
  expect(html).toContain('data-kr-scale-value="2"');
  // By-ingredient option
  expect(html).toContain('data-kr-scale-mode="by-ingredient"');
});

test("renderDocument includes named presets in scale bar", () => {
  if (!componentModule) throw new Error("Component module was not initialized");

  const markdown = `---\nversion: 1\nscales:\n  - name: Family Size\n    anchor: oats\n    amount: 900 g\n---\n# Demo\n\n# Porridge\n## Ingredients\n- oats - 300 g\n## Steps\n1. Cook.`;
  const html = componentModule.renderDocument(parseDocument(markdown));

  expect(html).toContain('data-kr-preset-index="0"');
  expect(html).toContain("Family Size");
});

test("data-kr-scaled attribute appears on root when factor != 1", () => {
  if (!componentModule) throw new Error("Component module was not initialized");

  const markdown = `# Demo\n\n# R\n## Ingredients\n- flour - 2 cups\n## Steps\n1. Mix.`;
  const parsed = parseDocument(markdown);

  const scaledHtml = componentModule.renderDocument(parsed, { scaleFactor: 2 });
  const scaledContent = scaledHtml.slice(scaledHtml.indexOf("</style>") + 8);
  expect(scaledContent).toContain("data-kr-scaled");

  const unscaledHtml = componentModule.renderDocument(parsed, { scaleFactor: 1 });
  const unscaledContent = unscaledHtml.slice(unscaledHtml.indexOf("</style>") + 8);
  expect(unscaledContent).not.toContain("data-kr-scaled");
});

test("KrRecipeElement fires kr:scale-change when scale changes", () => {
  if (!componentModule) throw new Error("Component module was not initialized");

  const { KrRecipeElement } = componentModule;
  const el = new KrRecipeElement();
  el.content = `# Demo\n\n# R\n## Ingredients\n- flour - 2 cups\n## Steps\n1. Mix.`;
  el.connectedCallback();

  let detail: unknown = null;
  el.addEventListener("kr:scale-change", (e: Event) => {
    detail = (e as CustomEvent).detail;
  });
  el.setAttribute("scale", "2");
  expect(detail).toEqual({ factor: 2, mode: "fixed" });
});

test("setting scale attribute externally exits anchor mode", () => {
  if (!componentModule) throw new Error("Component module was not initialized");

  const { KrRecipeElement } = componentModule;
  const el = new KrRecipeElement();
  el.content = `# Demo\n\n# R\n## Ingredients\n- flour - 2 cups\n- sugar - 1 cup\n## Steps\n1. Mix.`;
  el.connectedCallback();

  // Set scale externally — the scale bar chip for by-ingredient should not be active
  el.setAttribute("scale", "2");
  const html = el.shadowRoot?.innerHTML ?? "";
  // The article element should not have data-kr-anchor-mode as an attribute
  expect(html).toMatch(/class="kr-root"[^>]*data-kr-scaled/);
  // The by-ingredient chip should not be active
  expect(html).not.toMatch(/kr-scale-chip--active[^"]*"[^>]*data-kr-scale-mode="by-ingredient"/);
});

test("resolveAnchorTarget returns native quantity in native mode", () => {
  if (!componentModule) throw new Error("Component module was not initialized");

  const doc = parseDocument('# Demo\n\n# R\n## Ingredients\n- flour - 2 cups :: id=flour also="240 g"\n## Steps\n1. Mix.');
  const flour = doc.recipes[0]!.ingredients.ingredients.find((i) => i.id === "flour")!;

  const target = componentModule.resolveAnchorTarget(flour, "native");
  expect(target).toBeTruthy();
  expect(target!.amount).toBe(2);
  expect(target!.unit).toBe("cups");
});

test("resolveAnchorTarget returns metric alternate in metric mode", () => {
  if (!componentModule) throw new Error("Component module was not initialized");

  const doc = parseDocument('# Demo\n\n# R\n## Ingredients\n- flour - 1 cup :: id=flour also="120 g"\n## Steps\n1. Mix.');
  const flour = doc.recipes[0]!.ingredients.ingredients.find((i) => i.id === "flour")!;

  const target = componentModule.resolveAnchorTarget(flour, "metric");
  expect(target).toBeTruthy();
  expect(target!.amount).toBe(120);
  expect(target!.unit).toBe("g");
});

test("resolveAnchorTarget falls back to native when no mode-matching alternate exists", () => {
  if (!componentModule) throw new Error("Component module was not initialized");

  // Imperial mode but only metric also= available — should keep native (cups), not swap to grams
  const doc = parseDocument('# Demo\n\n# R\n## Ingredients\n- sauce - 1 1/3 cup :: id=sauce also="300 g"\n## Steps\n1. Mix.');
  const sauce = doc.recipes[0]!.ingredients.ingredients.find((i) => i.id === "sauce")!;

  const target = componentModule.resolveAnchorTarget(sauce, "imperial");
  expect(target).toBeTruthy();
  expect(target!.amount).toBeCloseTo(1.333, 2);
  expect(target!.unit).toBe("cup");
});

test("resolveAnchorTarget falls back to native when no alternates exist", () => {
  if (!componentModule) throw new Error("Component module was not initialized");

  const doc = parseDocument('# Demo\n\n# R\n## Ingredients\n- flour - 2 cups :: id=flour\n## Steps\n1. Mix.');
  const flour = doc.recipes[0]!.ingredients.ingredients.find((i) => i.id === "flour")!;

  const target = componentModule.resolveAnchorTarget(flour, "metric");
  expect(target).toBeTruthy();
  expect(target!.amount).toBe(2);
  expect(target!.unit).toBe("cups");
});

test("steps inline formatting works alongside references and temperatures", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Demo",
    "",
    "# Test Recipe",
    "## Ingredients",
    "- salt",
    "## Steps",
    "1. Add [[salt]] and stir **vigorously** at {350F} for 5 minutes.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  expect(html).toContain('class="kr-ref"');
  expect(html).toContain('data-kr-target="salt"');
  expect(html).toContain("<strong>vigorously</strong>");
  expect(html).toContain('class="kr-temperature"');
});

test("renderDocument renders inline value tokens in notes bullet items", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Pizza",
    "## Ingredients",
    "- cheese - 340 g",
    "## Steps",
    "1. Assemble and bake at {500F}.",
    "## Notes",
    "- **Cheese Substitution:** Replace with {1 1/2 cups} ({170g}) mozzarella.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  // Should render the quantity tokens properly (not garbled)
  expect(html).toContain('class="kr-inline-quantity"');
  expect(html).toContain("1½ cup");
  expect(html).toContain("170 g");
  // Should NOT contain raw curly brace tokens in the output
  expect(html).not.toContain("{1 1/2 cups}");
  expect(html).not.toContain("{170g}");
});

test("inline quantity tokens in steps render and scale", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Meatballs",
    "## Ingredients",
    "- beef - 500 g",
    "## Steps",
    "1. Form into {20} meatballs of about {25g} each.",
  ].join("\n");

  // Unscaled: quantities render at 1x
  const html = componentModule.renderDocument(parseDocument(markdown));
  expect(html).toContain('class="kr-inline-quantity"');
  expect(html).toContain(">20<");
  expect(html).toContain(">25 g<");
  expect(html).not.toContain("{20}");
  expect(html).not.toContain("{25g}");

  // Scaled: quantities double at 2x
  const scaled = componentModule.renderDocument(parseDocument(markdown), { scaleFactor: 2 });
  expect(scaled).toContain(">40<");
  expect(scaled).toContain(">50 g<");
});

test("inline temperature tokens in notes render correctly", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Cake",
    "## Ingredients",
    "- flour - 200 g",
    "## Steps",
    "1. Mix and bake.",
    "## Notes",
    "- Bake at {350F} until golden.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));
  expect(html).toContain('class="kr-temperature"');
  expect(html).toContain("350");
  expect(html).not.toContain("{350F}");
});

test("inline value tokens in notes numbered list items", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Cake",
    "## Ingredients",
    "- flour - 200 g",
    "## Steps",
    "1. Mix and bake.",
    "## Notes",
    "1. Makes {12} servings.",
    "2. Reheat at {350F}.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));
  expect(html).toContain('class="kr-inline-quantity"');
  expect(html).toContain('class="kr-temperature"');
  expect(html).not.toContain("{12}");
  expect(html).not.toContain("{350F}");
});

test("inline value tokens in notes paragraphs", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Cake",
    "## Ingredients",
    "- flour - 200 g",
    "## Steps",
    "1. Mix and bake.",
    "## Notes",
    "This recipe makes about {12} servings. Store leftovers at {-18C}.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));
  expect(html).toContain('class="kr-inline-quantity"');
  expect(html).toContain('class="kr-temperature"');
  expect(html).not.toContain("{12}");
  expect(html).not.toContain("{-18C}");
});

test("inline value tokens in notes headers", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Cake",
    "## Ingredients",
    "- flour - 200 g",
    "## Steps",
    "1. Mix and bake.",
    "## Notes",
    "### Makes {12} servings",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));
  expect(html).toContain('class="kr-inline-quantity"');
  expect(html).not.toContain("{12}");
});

test("scaled inline quantities in notes", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Meatballs",
    "## Ingredients",
    "- beef - 500 g",
    "## Steps",
    "1. Form into meatballs.",
    "## Notes",
    "- Makes about {20} meatballs, roughly {25g} each.",
  ].join("\n");

  const scaled = componentModule.renderDocument(parseDocument(markdown), { scaleFactor: 2 });
  expect(scaled).toContain(">40<");
  expect(scaled).toContain(">50 g<");
});

test("inline value tokens in multi-line continuation notes", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Cake",
    "## Ingredients",
    "- flour - 200 g",
    "## Steps",
    "1. Mix and bake.",
    "## Notes",
    "- **Substitution:** Use {1 1/2 cups} ({170g})",
    "  shredded mozzarella instead.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));
  expect(html).toContain('class="kr-inline-quantity"');
  expect(html).toContain("1½ cup");
  expect(html).toContain("170 g");
  expect(html).not.toContain("{1 1/2 cups}");
  expect(html).not.toContain("{170g}");
});

// ---------- Attribute chips ----------

describe("attribute chips", () => {
  const render = (md: string, opts?: Record<string, unknown>) => {
    if (!componentModule) throw new Error("Component module was not initialized");
    return componentModule.renderDocument(parseDocument(md), opts);
  };

  const attrMd = [
    "# Test",
    "",
    "# Salad",
    "## Ingredients",
    "- sugar - 1 cup, finely ground :: id=super-sugar also=200g noscale",
    "- lettuce",
    "## Steps",
    "1. Toss.",
  ].join("\n");

  const scalableMd = [
    "# Test",
    "",
    "# Bread",
    "## Ingredients",
    "- flour - 1 cup :: also=200g",
    "## Steps",
    "1. Mix.",
  ].join("\n");

  test("default (no showAttributes): no chip container", () => {
    expect(render(attrMd)).not.toContain('class="kr-ingredient__attributes"');
  });

  test("renders also and noscale chips, omits id", () => {
    const html = render(attrMd, { showAttributes: true });
    expect(html).toContain('class="kr-ingredient__attributes"');
    expect(html).toContain('data-kr-attribute="also"');
    expect(html).toContain('data-kr-attribute="noscale"');
    expect(html).not.toContain('data-kr-attribute="id"');
  });

  test("metric display: picked also is omitted from chips", () => {
    const html = render(attrMd, { showAttributes: true, quantityDisplay: "metric" });
    expect(html).not.toContain('data-kr-attribute="also"');
    expect(html).toContain('data-kr-attribute="noscale"');
  });

  test("imperial display: unpicked metric also stays as chip", () => {
    const html = render(attrMd, { showAttributes: true, quantityDisplay: "imperial" });
    expect(html).toContain('data-kr-attribute="also"');
  });

  test("scaled chip values reflect scaleFactor", () => {
    const html = render(scalableMd, { showAttributes: true, scaleFactor: 2 });
    expect(html).toContain("400 g");
  });

  test("scaled + metric: also deduped, primary shows scaled value", () => {
    const html = render(scalableMd, {
      showAttributes: true,
      scaleFactor: 2,
      quantityDisplay: "metric",
    });
    expect(html).not.toContain('data-kr-attribute="also"');
    expect(html).toContain("400 g");
  });

  test("ingredient with no attributes: no chip container", () => {
    const html = render(attrMd, { showAttributes: true });
    // Only sugar has attributes; lettuce should not get a container
    const matches = html.match(/class="kr-ingredient__attributes"/g);
    expect(matches?.length).toBe(1);
  });

  test("ingredient with only id=: no chip container (all filtered)", () => {
    const md = [
      "# Test",
      "",
      "# Soup",
      "## Ingredients",
      "- salt :: id=sea-salt",
      "## Steps",
      "1. Stir.",
    ].join("\n");
    const html = render(md, { showAttributes: true });
    expect(html).not.toContain('class="kr-ingredient__attributes"');
  });

  test("multiple also= attributes: all rendered in native mode", () => {
    const md = [
      "# Test",
      "",
      "# Bread",
      "## Ingredients",
      "- flour - 2 cups :: also=240g also=8oz",
      "## Steps",
      "1. Mix.",
    ].join("\n");
    const html = render(md, { showAttributes: true });
    const alsoMatches = html.match(/data-kr-attribute="also"/g);
    expect(alsoMatches?.length).toBe(2);
  });

  test("noscale renders as valueless chip", () => {
    const html = render(attrMd, { showAttributes: true });
    expect(html).toMatch(/data-kr-attribute="noscale">noscale<\/span>/);
  });

  test("KrRecipeElement: show-attributes toggles chips", () => {
    if (!componentModule) throw new Error("Component module was not initialized");
    const { KrRecipeElement } = componentModule;
    const element = new KrRecipeElement();
    element.content = attrMd;
    element.setAttribute("show-attributes", "");
    element.connectedCallback();
    expect(element.shadowRoot?.innerHTML).toContain('class="kr-ingredient__attributes"');

    element.removeAttribute("show-attributes");
    expect(element.shadowRoot?.innerHTML).not.toContain('class="kr-ingredient__attributes"');
  });
});

describe("diff annotations", () => {
  const md = `# Test Recipe

A nice intro.

## Ingredients

- flour - 2 cups
- sugar - 1 tbsp

## Steps

1. Mix dry ingredients.
2. Add wet ingredients.

## Notes

Serve warm.`;

  test("no redline markup without annotations", () => {
    if (!componentModule) throw new Error("Module not loaded");
    const html = componentModule.renderDocument(parseDocument(md));
    const content = html.replace(/<style>[\s\S]*?<\/style>/, "");
    expect(content).not.toContain("kr-diff-del");
    expect(content).not.toContain("kr-diff-ins");
    expect(content).not.toContain("data-kr-attr-diff");
  });

  test("annotations force native quantity display", () => {
    if (!componentModule) throw new Error("Module not loaded");
    const md2 = `# Test

## Ingredients

- flour - 2 cups :: also=240g

## Steps

1. Mix.`;
    // Without annotations, metric mode uses also= as primary
    const htmlMetric = componentModule.renderDocument(parseDocument(md2), {
      quantityDisplay: "metric",
    });
    expect(htmlMetric).toContain("240");

    // With annotations, forced to native — shows original quantity
    const htmlDiff = componentModule.renderDocument(parseDocument(md2), {
      quantityDisplay: "metric",
      annotations: [
        { section: "ingredients", key: "flour", status: "changed", attributeDiffs: [{ key: "also", status: "added" }] },
      ],
    });
    expect(htmlDiff).toContain("2 cups");
  });

  test("KrRecipeElement annotations property triggers re-render", () => {
    if (!componentModule) throw new Error("Module not loaded");
    const { KrRecipeElement } = componentModule;
    const element = new KrRecipeElement();
    element.content = md;
    element.connectedCallback();
    const stripStyle = (s: string) => s.replace(/<style>[\s\S]*?<\/style>/, "");
    expect(stripStyle(element.shadowRoot?.innerHTML ?? "")).not.toContain("kr-diff-del");

    element.annotations = [
      {
        section: "steps",
        key: "0",
        status: "changed",
        tokens: [
          { kind: "delete", text: "dry" },
          { kind: "insert", text: "wet" },
        ],
      },
    ];
    expect(stripStyle(element.shadowRoot?.innerHTML ?? "")).toContain("kr-diff-del");

    element.annotations = null;
    expect(stripStyle(element.shadowRoot?.innerHTML ?? "")).not.toContain("kr-diff-del");
  });

  test("changed step with tokens renders del/ins redline markup", () => {
    if (!componentModule) throw new Error("Module not loaded");
    const html = componentModule.renderDocument(parseDocument(md), {
      annotations: [
        {
          section: "steps",
          key: "0",
          status: "changed",
          tokens: [
            { kind: "equal", text: "Mix " },
            { kind: "delete", text: "dry" },
            { kind: "insert", text: "wet" },
            { kind: "equal", text: " ingredients." },
          ],
        },
      ],
    });
    expect(html).toContain('<del class="kr-diff-del">dry</del>');
    expect(html).toContain('<ins class="kr-diff-ins">wet</ins>');
    expect(html).toContain("Mix ");
  });

  test("changed ingredient with content tokens renders del/ins redline", () => {
    if (!componentModule) throw new Error("Module not loaded");
    const html = componentModule.renderDocument(parseDocument(md), {
      annotations: [
        {
          section: "ingredients",
          key: "flour",
          status: "changed",
          tokens: [
            { kind: "delete", text: "2" },
            { kind: "insert", text: "3" },
            { kind: "equal", text: " cups flour" },
          ],
        },
      ],
    });
    expect(html).toContain('<del class="kr-diff-del">2</del>');
    expect(html).toContain('<ins class="kr-diff-ins">3</ins>');
  });

  test("changed ingredient without tokens keeps structured rendering", () => {
    if (!componentModule) throw new Error("Module not loaded");
    const html = componentModule.renderDocument(parseDocument(md), {
      annotations: [
        {
          section: "ingredients",
          key: "flour",
          status: "changed",
          // No tokens → attribute-only change
          attributeDiffs: [{ key: "also", status: "added" }],
        },
      ],
    });
    // No content tokens → structured layout preserved
    expect(html).toContain("kr-ingredient__quantity");
    expect(html).toContain("kr-ingredient__name");
  });

  test("ingredient annotation with attributeDiffs shows diff-styled chips", () => {
    if (!componentModule) throw new Error("Module not loaded");
    const md2 = `# Test Recipe

A simple recipe.

## Ingredients

- flour - 2 cups :: also=240g

## Steps

1. Mix dry ingredients.

## Notes

Serve warm.`;
    const html = componentModule.renderDocument(parseDocument(md2), {
      annotations: [
        {
          section: "ingredients",
          key: "flour",
          status: "changed",
          attributeDiffs: [{ key: "also", status: "added" }],
        },
      ],
    });
    expect(html).toContain('data-kr-attr-diff="added"');
    expect(html).toContain("kr-ingredient__attribute");
  });

  test("ingredient annotation shows removed attribute chips", () => {
    if (!componentModule) throw new Error("Module not loaded");
    const html = componentModule.renderDocument(parseDocument(md), {
      annotations: [
        {
          section: "ingredients",
          key: "flour",
          status: "changed",
          attributeDiffs: [{ key: "noscale", status: "removed" }],
        },
      ],
    });
    expect(html).toContain('data-kr-attr-diff="removed"');
    expect(html).toContain('data-kr-attribute="noscale"');
  });

  test("ingredient annotation forces chip display even without showAttributes", () => {
    if (!componentModule) throw new Error("Module not loaded");
    const stripStyle = (s: string) => s.replace(/<style>[\s\S]*?<\/style>/, "");
    const md2 = `# Test Recipe

## Ingredients

- flour - 2 cups :: also=240g

## Steps

1. Mix.`;
    // Without annotations, no chips by default
    const htmlNoAnnot = stripStyle(componentModule.renderDocument(parseDocument(md2), {}));
    expect(htmlNoAnnot).not.toContain("kr-ingredient__attributes");

    // With annotation, chips appear even without showAttributes
    const htmlAnnot = stripStyle(componentModule.renderDocument(parseDocument(md2), {
      annotations: [
        {
          section: "ingredients",
          key: "flour",
          status: "changed",
          attributeDiffs: [{ key: "also", status: "added" }],
        },
      ],
    }));
    expect(htmlAnnot).toContain("kr-ingredient__attributes");
  });

  test("changed intro with tokens renders del/ins redline markup", () => {
    if (!componentModule) throw new Error("Module not loaded");
    const html = componentModule.renderDocument(parseDocument(md), {
      annotations: [
        {
          section: "intro",
          key: "0",
          status: "changed",
          tokens: [
            { kind: "equal", text: "A " },
            { kind: "delete", text: "simple" },
            { kind: "insert", text: "delicious" },
            { kind: "equal", text: " recipe." },
          ],
        },
      ],
    });
    expect(html).toContain('<del class="kr-diff-del">simple</del>');
    expect(html).toContain('<ins class="kr-diff-ins">delicious</ins>');
  });

  test("changed annotation without tokens falls back to normal rendering", () => {
    if (!componentModule) throw new Error("Module not loaded");
    const html = componentModule.renderDocument(parseDocument(md), {
      annotations: [
        { section: "steps", key: "0", status: "changed" },
      ],
    });
    // No tokens → no del/ins markup
    expect(html).not.toContain("<del");
    expect(html).not.toContain("<ins");
  });
});
