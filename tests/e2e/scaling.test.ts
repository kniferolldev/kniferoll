import { expect, test } from "bun:test";
import {
  bundleMarkdown,
  closeTestContext,
  createTestContext,
  loadComponentBundle,
} from "./test-utils";

test(
  "scales recipe quantities using preset selector",
  async () => {
    const moduleCode = await loadComponentBundle();

    const markdown = [
      "---",
      "version: 1",
      "scales:",
      "  - name: triple",
      "    anchor: oats",
      "    amount: 3 cup",
      "---",
      "# Porridge",
      "## Ingredients",
      "- oats - 1 cup",
      "- water - 2 cups",
      "## Steps",
      "1. Cook.",
    ].join("\n");

    const ctx = await createTestContext();
    try {
      await ctx.page.setContent(
        `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>Scaling Test</title>
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
          return !!host?.shadowRoot?.querySelector(".kr-scale-widget");
        },
        undefined,
        { timeout: 1000 },
      );

      // Open the scale bar by clicking the toggle, then click the preset chip
      await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        const root = host?.shadowRoot;
        const toggle = root?.querySelector<HTMLElement>(".kr-scale-toggle");
        toggle?.click();
        const preset = root?.querySelector<HTMLElement>('[data-kr-preset-index="0"]');
        preset?.click();
      });

      // Wait for quantity to update
      await ctx.page.waitForFunction(
        () => {
          const host = document.querySelector("kr-recipe");
          const quantity =
            host?.shadowRoot?.querySelector(".kr-ingredient__quantity")
              ?.textContent ?? "";
          return quantity.includes("3");
        },
        undefined,
        { timeout: 1000 },
      );

      const quantity = await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        return (
          host?.shadowRoot?.querySelector(".kr-ingredient__quantity")
            ?.textContent ?? ""
        );
      });
      expect(quantity).toContain("3");
    } finally {
      await closeTestContext(ctx);
    }
  },
);

test(
  "switches between quantity display modes",
  async () => {
    const moduleCode = await loadComponentBundle();

    const markdown = [
      "# Test",
      "## Ingredients",
      '- oats - 1 cup :: also="90 g"',
      "## Steps",
      "1. Cook.",
    ].join("\n");

    const ctx = await createTestContext();
    try {
      await ctx.page.setContent(
        `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>Quantity Mode Test</title>
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
          return !!host?.shadowRoot?.querySelector(".kr-ingredient__quantity");
        },
        undefined,
        { timeout: 1000 },
      );

      // Switch to metric mode via attribute
      await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        host?.setAttribute("quantity-display", "metric");
      });

      // Wait for quantity to switch to grams
      await ctx.page.waitForFunction(
        () => {
          const host = document.querySelector("kr-recipe");
          const quantity =
            host?.shadowRoot?.querySelector(".kr-ingredient__quantity")
              ?.textContent ?? "";
          return quantity.includes("g");
        },
        undefined,
        { timeout: 1000 },
      );

      const quantity = await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        return (
          host?.shadowRoot?.querySelector(".kr-ingredient__quantity")
            ?.textContent ?? ""
        );
      });
      expect(quantity).toContain("g");
    } finally {
      await closeTestContext(ctx);
    }
  },
);
