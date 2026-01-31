/// <reference lib="dom" />

import { afterAll, beforeAll, expect, test } from "bun:test";
import { parseDocument } from "../core/parser";

class FakeShadowRoot {
  innerHTML = "";
}

class FakeHTMLElement {
  shadowRoot: FakeShadowRoot | null = null;
  #text = "";
  #attributes = new Map<string, string>();

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

test("renderDocument renders timer and temperature tokens", () => {
  if (!componentModule) {
    throw new Error("Component module was not initialized");
  }

  const markdown = [
    "# Demo",
    "",
    "# Roast",
    "## Steps",
    "1. Preheat @350F.",
    "2. Bake @35m until browned.",
    "3. Rest @10m before slicing.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  expect(html).toContain('class="kr-temperature"');
  expect(html).toContain('data-kr-temperature-scale="F"');
  expect(html).toContain('class="kr-timer"');
  expect(html).toContain('data-kr-timer-variant="single"');
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
  expect(scaled).toContain('data-kr-quantity="3 cup"');

  element.setAttribute("quantity-display", "alt-mass");
  const alt = element.shadowRoot?.innerHTML ?? "";
  expect(alt).toContain('data-kr-quantity-mode="alt-mass"');
  expect(alt).toContain('data-kr-quantity="270 g"');
  expect(alt).toContain("native: 3 cup");

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
  expect(scaledHtml).toContain('data-kr-quantity="2 cup"');
  expect(scaledHtml).toContain('data-kr-quantity-mode="native"');

  const altHtml = componentModule.renderDocument(parsed, {
    quantityDisplay: "alt-mass",
  });
  expect(altHtml).toContain('data-kr-quantity-mode="alt-mass"');
  expect(altHtml).toContain('data-kr-quantity="120 g"');
  expect(altHtml).toContain("native: 1 cup");

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

test("steps inline formatting works alongside references and timers", () => {
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
    "1. Add [[salt]] and stir **vigorously** for @5m.",
  ].join("\n");

  const html = componentModule.renderDocument(parseDocument(markdown));

  // Should have all: reference, bold formatting, and timer
  expect(html).toContain('class="kr-ref"');
  expect(html).toContain('data-kr-target="salt"');
  expect(html).toContain("<strong>vigorously</strong>");
  expect(html).toContain('class="kr-timer"');
});
