import { expect, test } from "bun:test";
import {
  bundleMarkdown,
  closeTestContext,
  createTestContext,
  loadComponentBundle,
} from "./test-utils";

test(
  "renders document title and recipe titles",
  async () => {
    const moduleCode = await loadComponentBundle();

    const markdown = [
      "---",
      "version: 1",
      "---",
      "# Kitchen Notebook",
      "",
      "# Porridge",
      "## Ingredients",
      "- oats - 1 cup",
      "- water - 2 cups",
      "## Steps",
      "1. Combine and cook.",
    ].join("\n");

    const ctx = await createTestContext();
    try {
      await ctx.page.setContent(
        `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>Rendering Test</title>
          </head>
          <body>
            <kr-recipe id="fixture">
${bundleMarkdown(markdown)}
            </kr-recipe>
          </body>
        </html>
      `.trim(),
      );

      await ctx.page.addScriptTag({ type: "module", content: moduleCode });

      // Wait for component to render
      await ctx.page.waitForFunction(
        () => {
          const host = document.querySelector("kr-recipe");
          return !!host?.shadowRoot?.querySelector(".kr-recipe__title");
        },
        undefined,
        { timeout: 5000 },
      );

      // Test: Document title
      const docTitle = await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        return (
          host?.shadowRoot?.querySelector(".kr-document-title")?.textContent ??
          null
        );
      });
      expect(docTitle).toBe("Kitchen Notebook");

      // Test: Recipe titles
      const titles = await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        if (!host?.shadowRoot) return [];
        return Array.from(
          host.shadowRoot.querySelectorAll(".kr-recipe__title"),
          (node) => node.textContent,
        );
      });
      expect(titles).toEqual(["Porridge"]);
    } finally {
      await closeTestContext(ctx);
    }
  },
);

test(
  "step navigation with arrow keys",
  async () => {
    const moduleCode = await loadComponentBundle();

    const markdown = [
      "# Recipe",
      "## Ingredients",
      "- ingredient 1",
      "- ingredient 2",
      "## Steps",
      "1. First step",
      "2. Second step",
      "3. Third step",
      "4. Fourth step",
    ].join("\n");

    const ctx = await createTestContext();
    try {
      await ctx.page.setContent(
        `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>Step Navigation Test</title>
          </head>
          <body>
            <kr-recipe id="fixture">
${bundleMarkdown(markdown)}
            </kr-recipe>
          </body>
        </html>
      `.trim(),
      );

      await ctx.page.addScriptTag({ type: "module", content: moduleCode });

      await ctx.page.waitForFunction(
        () => {
          const host = document.querySelector("kr-recipe");
          return !!host?.shadowRoot?.querySelector(".kr-step");
        },
        undefined,
        { timeout: 5000 },
      );

      const getActiveStepIndex = async () => {
        return await ctx.page.evaluate(() => {
          const host = document.querySelector("kr-recipe");
          if (!host?.shadowRoot) return null;
          const activeStep = host.shadowRoot.querySelector<HTMLElement>(
            '.kr-step[aria-pressed="true"]',
          );
          if (!activeStep) return null;
          return Number(activeStep.getAttribute("data-kr-step-index"));
        });
      };

      await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        if (host && typeof (host as HTMLElement).focus === "function") {
          (host as HTMLElement).focus();
        }
      });

      let activeIndex = await getActiveStepIndex();
      expect(activeIndex).toBe(0);

      await ctx.page.keyboard.press("ArrowDown");
      await ctx.page.waitForTimeout(100);
      activeIndex = await getActiveStepIndex();
      expect(activeIndex).toBe(1);

      await ctx.page.keyboard.press("ArrowDown");
      await ctx.page.waitForTimeout(100);
      activeIndex = await getActiveStepIndex();
      expect(activeIndex).toBe(2);

      await ctx.page.keyboard.press("ArrowDown");
      await ctx.page.waitForTimeout(100);
      activeIndex = await getActiveStepIndex();
      expect(activeIndex).toBe(3);

      await ctx.page.keyboard.press("ArrowUp");
      await ctx.page.waitForTimeout(100);
      activeIndex = await getActiveStepIndex();
      expect(activeIndex).toBe(2);
    } finally {
      await closeTestContext(ctx);
    }
  },
);

test(
  "step navigation with space key",
  async () => {
    const moduleCode = await loadComponentBundle();

    const markdown = [
      "# Recipe",
      "## Ingredients",
      "- ingredient 1",
      "## Steps",
      "1. First step",
      "2. Second step",
      "3. Third step",
      "4. Fourth step",
    ].join("\n");

    const ctx = await createTestContext();
    try {
      await ctx.page.setContent(
        `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>Space Key Navigation Test</title>
          </head>
          <body>
            <kr-recipe id="fixture">
${bundleMarkdown(markdown)}
            </kr-recipe>
          </body>
        </html>
      `.trim(),
      );

      await ctx.page.addScriptTag({ type: "module", content: moduleCode });

      await ctx.page.waitForFunction(
        () => {
          const host = document.querySelector("kr-recipe");
          return !!host?.shadowRoot?.querySelector(".kr-step");
        },
        undefined,
        { timeout: 5000 },
      );

      const getActiveStepIndex = async () => {
        return await ctx.page.evaluate(() => {
          const host = document.querySelector("kr-recipe");
          if (!host?.shadowRoot) return null;
          const activeStep = host.shadowRoot.querySelector<HTMLElement>(
            '.kr-step[aria-pressed="true"]',
          );
          if (!activeStep) return null;
          return Number(activeStep.getAttribute("data-kr-step-index"));
        });
      };

      // Focus the host element
      await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        if (host && typeof (host as HTMLElement).focus === "function") {
          (host as HTMLElement).focus();
        }
      });

      let activeIndex = await getActiveStepIndex();
      expect(activeIndex).toBe(0);

      // Space should advance through all steps
      await ctx.page.keyboard.press("Space");
      await ctx.page.waitForTimeout(100);
      activeIndex = await getActiveStepIndex();
      expect(activeIndex).toBe(1);

      await ctx.page.keyboard.press("Space");
      await ctx.page.waitForTimeout(100);
      activeIndex = await getActiveStepIndex();
      expect(activeIndex).toBe(2);

      await ctx.page.keyboard.press("Space");
      await ctx.page.waitForTimeout(100);
      activeIndex = await getActiveStepIndex();
      expect(activeIndex).toBe(3);

      // At the end, space should stay at last step
      await ctx.page.keyboard.press("Space");
      await ctx.page.waitForTimeout(100);
      activeIndex = await getActiveStepIndex();
      expect(activeIndex).toBe(3);
    } finally {
      await closeTestContext(ctx);
    }
  },
);

test(
  "step navigation with space key after clicking a step",
  async () => {
    const moduleCode = await loadComponentBundle();

    const markdown = [
      "# Recipe",
      "## Ingredients",
      "- ingredient 1",
      "## Steps",
      "1. First step",
      "2. Second step",
      "3. Third step",
    ].join("\n");

    const ctx = await createTestContext();
    try {
      await ctx.page.setContent(
        `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>Space After Click Test</title>
          </head>
          <body>
            <kr-recipe id="fixture">
${bundleMarkdown(markdown)}
            </kr-recipe>
          </body>
        </html>
      `.trim(),
      );

      await ctx.page.addScriptTag({ type: "module", content: moduleCode });

      await ctx.page.waitForFunction(
        () => {
          const host = document.querySelector("kr-recipe");
          return !!host?.shadowRoot?.querySelector(".kr-step");
        },
        undefined,
        { timeout: 5000 },
      );

      const getActiveStepIndex = async () => {
        return await ctx.page.evaluate(() => {
          const host = document.querySelector("kr-recipe");
          if (!host?.shadowRoot) return null;
          const activeStep = host.shadowRoot.querySelector<HTMLElement>(
            '.kr-step[aria-pressed="true"]',
          );
          if (!activeStep) return null;
          return Number(activeStep.getAttribute("data-kr-step-index"));
        });
      };

      // Click step 0 to focus it directly
      await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        const step = host?.shadowRoot?.querySelector<HTMLElement>(".kr-step[data-kr-step-index='0']");
        step?.click();
        step?.focus();
      });
      await ctx.page.waitForTimeout(100);

      let activeIndex = await getActiveStepIndex();
      expect(activeIndex).toBe(0);

      // Space should advance even after clicking/focusing a step
      await ctx.page.keyboard.press("Space");
      await ctx.page.waitForTimeout(100);
      activeIndex = await getActiveStepIndex();
      expect(activeIndex).toBe(1);

      // And again
      await ctx.page.keyboard.press("Space");
      await ctx.page.waitForTimeout(100);
      activeIndex = await getActiveStepIndex();
      expect(activeIndex).toBe(2);
    } finally {
      await closeTestContext(ctx);
    }
  },
);

test(
  "ingredient highlighting with normalized references",
  async () => {
    const moduleCode = await loadComponentBundle();

    const markdown = [
      "# Soup",
      "## Ingredients",
      "- dried porcini mushrooms - 1 oz",
      "- extra virgin olive oil - 2 tbsp",
      "- onion - 1, chopped",
      "## Steps",
      "1. Soak the [[dried porcini mushrooms]] in hot water.",
      "2. Heat the [[extra virgin olive oil]] over medium heat.",
      "3. Add [[onion]] and cook.",
    ].join("\n");

    const ctx = await createTestContext();
    try {
      await ctx.page.setContent(
        `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>Ingredient Highlighting Test</title>
          </head>
          <body>
            <kr-recipe id="fixture">
${bundleMarkdown(markdown)}
            </kr-recipe>
          </body>
        </html>
      `.trim(),
      );

      await ctx.page.addScriptTag({ type: "module", content: moduleCode });

      await ctx.page.waitForFunction(
        () => {
          const host = document.querySelector("kr-recipe");
          return !!host?.shadowRoot?.querySelector(".kr-step");
        },
        undefined,
        { timeout: 5000 },
      );

      // Focus the component and select the first step
      await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        if (host && typeof (host as HTMLElement).focus === "function") {
          (host as HTMLElement).focus();
        }
      });

      // Wait for first step to be selected
      await ctx.page.waitForFunction(
        () => {
          const host = document.querySelector("kr-recipe");
          const step = host?.shadowRoot?.querySelector(
            '.kr-step[aria-pressed="true"]',
          );
          return !!step;
        },
        undefined,
        { timeout: 5000 },
      );

      // Test: Ingredient is highlighted when step is selected
      const isHighlighted = await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        if (!host?.shadowRoot) return false;
        const ingredient = host.shadowRoot.querySelector(
          '.kr-ingredient[data-kr-id="dried-porcini-mushrooms"]',
        );
        return ingredient?.hasAttribute("data-kr-step-highlight") ?? false;
      });
      expect(isHighlighted).toBe(true);

      // Test: Other ingredients are not highlighted
      const otherHighlighted = await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        if (!host?.shadowRoot) return false;
        const ingredient = host.shadowRoot.querySelector(
          '.kr-ingredient[data-kr-id="extra-virgin-olive-oil"]',
        );
        return ingredient?.hasAttribute("data-kr-step-highlight") ?? false;
      });
      expect(otherHighlighted).toBe(false);

      // Test: Mouseover on reference highlights ingredient
      const hoverWorks = await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        if (!host?.shadowRoot) return false;

        // Find the reference button in the second step
        const step2 = host.shadowRoot.querySelector(
          '.kr-step[data-kr-step-index="1"]',
        );
        const ref = step2?.querySelector(
          '.kr-ref[data-kr-target="extra-virgin-olive-oil"]',
        ) as HTMLElement;
        if (!ref) return false;

        // Trigger hover
        ref.dispatchEvent(new PointerEvent("pointerenter", { bubbles: true }));

        // Check if ingredient gets highlighted
        const ingredient = host.shadowRoot.querySelector(
          '.kr-ingredient[data-kr-id="extra-virgin-olive-oil"]',
        );
        return ingredient?.classList.contains("kr-target-highlight") ?? false;
      });
      expect(hoverWorks).toBe(true);
    } finally {
      await closeTestContext(ctx);
    }
  },
);

test(
  "renders source attribution from frontmatter",
  async () => {
    const moduleCode = await loadComponentBundle();

    // Test cookbook source
    const cookbookMarkdown = [
      "---",
      "version: 1",
      "source:",
      "  cookbook:",
      '    title: "The Joy of Cooking"',
      "    author: Irma S. Rombauer",
      '    pages: "112-115"',
      "    year: 1997",
      "---",
      "# Test Recipe",
      "## Ingredients",
      "- flour - 200 g",
      "## Steps",
      "1. Mix ingredients.",
    ].join("\n");

    const ctx = await createTestContext();
    try {
      await ctx.page.setContent(
        `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>Source Test</title>
          </head>
          <body>
            <kr-recipe id="fixture">
${bundleMarkdown(cookbookMarkdown)}
            </kr-recipe>
          </body>
        </html>
      `.trim(),
      );

      await ctx.page.addScriptTag({ type: "module", content: moduleCode });

      // Wait for component to render
      await ctx.page.waitForFunction(
        () => {
          const host = document.querySelector("kr-recipe");
          return !!host?.shadowRoot?.querySelector(".kr-recipe__title");
        },
        undefined,
        { timeout: 5000 },
      );

      // Test: Cookbook source is displayed correctly in recipe header
      const sourceText = await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        const recipe = host?.shadowRoot?.querySelector(".kr-recipe");
        return recipe?.querySelector(".kr-source")?.textContent?.trim() ?? null;
      });
      expect(sourceText).toContain("from");
      expect(sourceText).toContain("The Joy of Cooking");
      expect(sourceText).toContain("by Irma S. Rombauer");
      expect(sourceText).toContain("p. 112-115");

      // Test: Book title is italicized
      const hasItalicTitle = await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        const recipe = host?.shadowRoot?.querySelector(".kr-recipe");
        return !!recipe?.querySelector(".kr-source__book-title");
      });
      expect(hasItalicTitle).toBe(true);
    } finally {
      await closeTestContext(ctx);
    }
  },
);

test(
  "renders URL source with link",
  async () => {
    const moduleCode = await loadComponentBundle();

    const urlMarkdown = [
      "---",
      "version: 1",
      "source:",
      '  url: "https://example.com/recipe"',
      '  title: "Perfect Pancakes"',
      "  accessed: 2024-10-01",
      "---",
      "# Test Recipe",
      "## Ingredients",
      "- flour - 200 g",
      "## Steps",
      "1. Mix ingredients.",
    ].join("\n");

    const ctx = await createTestContext();
    try {
      await ctx.page.setContent(
        `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>Source Test</title>
          </head>
          <body>
            <kr-recipe id="fixture">
${bundleMarkdown(urlMarkdown)}
            </kr-recipe>
          </body>
        </html>
      `.trim(),
      );

      await ctx.page.addScriptTag({ type: "module", content: moduleCode });

      await ctx.page.waitForFunction(
        () => {
          const host = document.querySelector("kr-recipe");
          return !!host?.shadowRoot?.querySelector(".kr-recipe__title");
        },
        undefined,
        { timeout: 5000 },
      );

      // Test: URL source has a link in recipe header
      const linkHref = await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        const recipe = host?.shadowRoot?.querySelector(".kr-recipe");
        const link = recipe?.querySelector(
          ".kr-source__link",
        ) as HTMLAnchorElement;
        return link?.href ?? null;
      });
      expect(linkHref).toBe("https://example.com/recipe");

      // Test: Link text shows the title
      const linkText = await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        const recipe = host?.shadowRoot?.querySelector(".kr-recipe");
        const link = recipe?.querySelector(".kr-source__link");
        return link?.textContent ?? null;
      });
      expect(linkText).toBe("Perfect Pancakes");

      // Test: Source text contains "from"
      const sourceText = await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        const recipe = host?.shadowRoot?.querySelector(".kr-recipe");
        return recipe?.querySelector(".kr-source")?.textContent ?? null;
      });
      expect(sourceText).toContain("from");
    } finally {
      await closeTestContext(ctx);
    }
  },
);

test(
  "renders text source",
  async () => {
    const moduleCode = await loadComponentBundle();

    const textMarkdown = [
      "---",
      "version: 1",
      "source: Grandma",
      "---",
      "# Test Recipe",
      "## Ingredients",
      "- flour - 200 g",
      "## Steps",
      "1. Mix ingredients.",
    ].join("\n");

    const ctx = await createTestContext();
    try {
      await ctx.page.setContent(
        `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>Source Test</title>
          </head>
          <body>
            <kr-recipe id="fixture">
${bundleMarkdown(textMarkdown)}
            </kr-recipe>
          </body>
        </html>
      `.trim(),
      );

      await ctx.page.addScriptTag({ type: "module", content: moduleCode });

      await ctx.page.waitForFunction(
        () => {
          const host = document.querySelector("kr-recipe");
          return !!host?.shadowRoot?.querySelector(".kr-recipe__title");
        },
        undefined,
        { timeout: 5000 },
      );

      // Test: Text source is displayed in recipe header
      const sourceText = await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        const recipe = host?.shadowRoot?.querySelector(".kr-recipe");
        return recipe?.querySelector(".kr-source")?.textContent?.trim() ?? null;
      });
      expect(sourceText).toContain("from");
      expect(sourceText).toContain("Grandma");
    } finally {
      await closeTestContext(ctx);
    }
  },
);

