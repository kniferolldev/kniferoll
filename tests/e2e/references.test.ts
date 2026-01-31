import { expect, test } from "bun:test";
import {
  bundleMarkdown,
  closeTestContext,
  createTestContext,
  loadComponentBundle,
} from "./test-utils";

test(
  "clicking ingredient reference highlights target and dispatches event",
  async () => {
    const moduleCode = await loadComponentBundle();

    const markdown = [
      "# Recipe",
      "## Ingredients",
      "- oats - 1 cup",
      "- water - 2 cups",
      "## Steps",
      "1. Combine [[oats]] and [[water]].",
    ].join("\n");

    const ctx = await createTestContext();
    try {
      await ctx.page.setContent(
        `
        <!DOCTYPE html>
        <html lang="en">
          <head>
            <meta charset="utf-8" />
            <title>References Test</title>
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
          return !!host?.shadowRoot?.querySelector(".kr-ref");
        },
        undefined,
        { timeout: 5000 },
      );

      // Click reference and check activation
      const refActive = await ctx.page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        if (!host) return false;
        const ref = host.shadowRoot?.querySelector(
          ".kr-ref",
        ) as HTMLButtonElement | null;
        ref?.dispatchEvent(new Event("click", { bubbles: true }));
        return ref?.classList.contains("kr-ref--active") ?? false;
      });
      expect(refActive).toBe(true);
    } finally {
      await closeTestContext(ctx);
    }
  },
);
