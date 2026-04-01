import { expect, test } from "bun:test";
import {
  bundleMarkdown,
  closeTestContext,
  createTestContext,
  loadComponentBundle,
} from "./test-utils";

const anchorRecipeMarkdown = [
  "# Sauerkraut",
  "## Ingredients",
  "- green cabbage - 1 head :: anchor",
  "- kosher salt - 3 tbsp",
  "- caraway seeds - 1 tsp :: noscale",
  "## Steps",
  "1. Shred [[green-cabbage]], mix with [[kosher-salt]].",
].join("\n");

test(
  "auto-activated anchor renders input on the anchor ingredient",
  async () => {
    const moduleCode = await loadComponentBundle();
    const ctx = await createTestContext();
    try {
      await ctx.page.setContent(
        `<!DOCTYPE html>
        <html lang="en">
          <head><meta charset="utf-8" /></head>
          <body>
            <kr-recipe id="fixture">
${bundleMarkdown(anchorRecipeMarkdown)}
            </kr-recipe>
          </body>
        </html>`,
      );

      await ctx.page.addScriptTag({ type: "module", content: moduleCode });

      // Wait for anchor mode to auto-activate and render the anchor input
      const hasAnchorInput = await ctx.page.waitForFunction(
        () => {
          const host = document.querySelector("kr-recipe");
          const root = host?.shadowRoot;
          // The anchor input or display should appear on the anchor ingredient
          return !!root?.querySelector(".kr-anchor-input, .kr-anchor-display");
        },
        undefined,
        { timeout: 2000 },
      ).then(() => true).catch(() => false);

      expect(hasAnchorInput).toBe(true);
    } finally {
      await closeTestContext(ctx);
    }
  },
);

test(
  "clicking a scalable ingredient in anchor mode selects it as anchor",
  async () => {
    const moduleCode = await loadComponentBundle();
    const ctx = await createTestContext();
    try {
      const markdown = [
        "# Porridge",
        "## Ingredients",
        "- oats - 1 cup",
        "- water - 2 cups",
        "- salt - 1 pinch :: noscale",
        "## Steps",
        "1. Cook [[oats]] in [[water]].",
      ].join("\n");

      await ctx.page.setContent(
        `<!DOCTYPE html>
        <html lang="en">
          <head><meta charset="utf-8" /></head>
          <body>
            <kr-recipe id="fixture">
${bundleMarkdown(markdown)}
            </kr-recipe>
          </body>
        </html>`,
      );

      await ctx.page.addScriptTag({ type: "module", content: moduleCode });

      // Wait for render
      await ctx.page.waitForFunction(
        () => {
          const host = document.querySelector("kr-recipe");
          return !!host?.shadowRoot?.querySelector(".kr-scale-widget");
        },
        undefined,
        { timeout: 2000 },
      );

      // Enter by-ingredient mode via the scale bar chip
      await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        const root = host?.shadowRoot;
        // Open scale bar
        root?.querySelector<HTMLElement>(".kr-scale-toggle")?.click();
      });

      await ctx.page.waitForFunction(
        () => {
          const host = document.querySelector("kr-recipe");
          const root = host?.shadowRoot;
          return root?.querySelector('[data-kr-scale-mode="by-ingredient"]') != null;
        },
        undefined,
        { timeout: 1000 },
      );

      await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        const root = host?.shadowRoot;
        root?.querySelector<HTMLElement>('[data-kr-scale-mode="by-ingredient"]')?.click();
      });

      // Wait for anchor mode to activate (cycling hint icons)
      await ctx.page.waitForFunction(
        () => {
          const host = document.querySelector("kr-recipe");
          const root = host?.shadowRoot;
          return !!root?.querySelector(".kr-ingredient--anchor-hint");
        },
        undefined,
        { timeout: 2000 },
      );

      // Click the first scalable ingredient (oats)
      await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        const root = host?.shadowRoot;
        const firstScalable = root?.querySelector<HTMLElement>(
          '.kr-ingredient[data-kr-scalable="true"]',
        );
        firstScalable?.click();
      });

      // After clicking, the anchor input/display should appear on that ingredient
      const hasAnchorInput = await ctx.page.waitForFunction(
        () => {
          const host = document.querySelector("kr-recipe");
          const root = host?.shadowRoot;
          return !!root?.querySelector(".kr-anchor-input, .kr-anchor-display");
        },
        undefined,
        { timeout: 2000 },
      ).then(() => true).catch(() => false);

      expect(hasAnchorInput).toBe(true);
    } finally {
      await closeTestContext(ctx);
    }
  },
);
