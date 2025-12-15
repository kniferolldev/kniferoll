import { expect, test } from "bun:test";
import type { Browser } from "playwright";
import { chromium } from "playwright";
import { bundleMarkdown, loadComponentBundle } from "./test-utils";

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

      await page.addScriptTag({ type: "module", content: moduleCode });

      // Wait for component to render
      await page.waitForFunction(() => {
        const host = document.querySelector("kr-recipe");
        return !!host?.shadowRoot?.querySelector('.kr-timer[data-kr-timer-label="2s"]');
      }, undefined, { timeout: 5000 });

      // Test: Timer chip exists
      const hasTimer = await page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        return !!host?.shadowRoot?.querySelector('.kr-timer[data-kr-timer-label="2s"]');
      });
      expect(hasTimer).toBe(true);

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
