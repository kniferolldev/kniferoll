import { expect, test } from "bun:test";
import {
  bundleMarkdown,
  closeTestContext,
  createTestContext,
  loadComponentBundle,
} from "./test-utils";

test(
  "switches between layout modes",
  async () => {
    const moduleCode = await loadComponentBundle();

    const markdown = [
      "# Recipe",
      "## Ingredients",
      "- salt - 1 tsp",
      "## Steps",
      "1. Season.",
    ].join("\n");

    const ctx = await createTestContext();
    try {
      await ctx.page.setContent(
        `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>Layouts Test</title>
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
          return !!host?.shadowRoot?.querySelector(".kr-recipe");
        },
        undefined,
        { timeout: 5000 },
      );

      // Test: Layout switching
      await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        host?.setAttribute("layout", "two-column");
      });

      const layoutApplied = await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        const recipe = host?.shadowRoot?.querySelector(".kr-recipe");
        return recipe?.getAttribute("data-kr-layout") === "two-column";
      });
      expect(layoutApplied).toBe(true);
    } finally {
      await closeTestContext(ctx);
    }
  },
);
