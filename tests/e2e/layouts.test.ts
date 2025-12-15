import { expect, test } from "bun:test";
import type { Browser } from "playwright";
import { chromium } from "playwright";
import { bundleMarkdown, loadComponentBundle } from "./test-utils";

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

    let browser: Browser | null = null;
    try {
      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();

      await page.setContent(
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

      await page.addScriptTag({ type: "module", content: moduleCode });

      // Wait for component to render
      await page.waitForFunction(() => {
        const host = document.querySelector("kr-recipe");
        return !!host?.shadowRoot?.querySelector(".kr-recipe");
      }, undefined, { timeout: 5000 });

      // Test: Layout switching
      await page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        host?.setAttribute("layout", "two-column");
      });

      const layoutApplied = await page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        const recipe = host?.shadowRoot?.querySelector(".kr-recipe");
        return recipe?.getAttribute("data-kr-layout") === "two-column";
      });
      expect(layoutApplied).toBe(true);

      await context.close();
    } catch (error) {
      throw error;
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  },
  { timeout: 60_000 }
);
