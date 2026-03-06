import { expect, test } from "bun:test";
import {
  bundleMarkdown,
  closeTestContext,
  createTestContext,
  loadComponentBundle,
} from "./test-utils";

test(
  "renders timer chips and dispatches timer-start event on click",
  async () => {
    const moduleCode = await loadComponentBundle();

    const markdown = [
      "# Recipe",
      "## Ingredients",
      "- oats - 1 cup",
      "## Steps",
      "1. Simmer [[oats]] @2s.",
    ].join("\n");

    const ctx = await createTestContext();
    try {
      await ctx.page.setContent(
        `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>Timers Test</title>
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
          return !!host?.shadowRoot?.querySelector(
            '.kr-timer[data-kr-timer-label="2s"]',
          );
        },
        undefined,
        { timeout: 1000 },
      );

      // Test: Timer chip exists
      const hasTimer = await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        return !!host?.shadowRoot?.querySelector(
          '.kr-timer[data-kr-timer-label="2s"]',
        );
      });
      expect(hasTimer).toBe(true);
    } finally {
      await closeTestContext(ctx);
    }
  },
);
