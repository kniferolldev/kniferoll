import { expect, test } from "bun:test";
import type { Browser } from "playwright";
import { chromium } from "playwright";
import { bundleMarkdown, loadComponentBundle } from "./test-utils";

test(
  "scales recipe quantities using preset selector",
  async () => {
    const moduleCode = await loadComponentBundle();

    const markdown = [
      "---",
      "version: 0.0.1",
      "scales:",
      "  - name: triple",
      "    anchor: { id: oats, amount: 3, unit: cup }",
      "---",
      "# Porridge",
      "## Ingredients",
      "- oats - 1 cup",
      "- water - 2 cups",
      "## Steps",
      "1. Cook.",
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

      await page.addScriptTag({ type: "module", content: moduleCode });

      // Wait for component to render
      await page.waitForFunction(() => {
        const host = document.querySelector("kr-recipe");
        return !!host?.shadowRoot?.querySelector(".kr-scale-control");
      }, undefined, { timeout: 5000 });

      // Change to triple preset
      await page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        const select = host?.shadowRoot?.querySelector(".kr-scale-control") as HTMLSelectElement | null;
        if (select) {
          select.value = "preset:0";
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });

      // Wait for quantity to update
      await page.waitForFunction(() => {
        const host = document.querySelector("kr-recipe");
        const quantity = host?.shadowRoot?.querySelector(".kr-ingredient__quantity")?.textContent ?? "";
        return quantity.includes("3");
      }, undefined, { timeout: 5000 });

      const quantity = await page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        return host?.shadowRoot?.querySelector(".kr-ingredient__quantity")?.textContent ?? "";
      });
      expect(quantity).toContain("3");

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

      await page.addScriptTag({ type: "module", content: moduleCode });

      // Wait for component to render
      await page.waitForFunction(() => {
        const host = document.querySelector("kr-recipe");
        return !!host?.shadowRoot?.querySelector(".kr-quantity-control");
      }, undefined, { timeout: 5000 });

      // Switch to alt-mass mode
      await page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        const select = host?.shadowRoot?.querySelector(".kr-quantity-control") as HTMLSelectElement | null;
        if (select) {
          select.value = "alt-mass";
          select.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });

      // Wait for quantity to switch to grams
      await page.waitForFunction(() => {
        const host = document.querySelector("kr-recipe");
        const quantity = host?.shadowRoot?.querySelector(".kr-ingredient__quantity")?.textContent ?? "";
        return quantity.includes("g");
      }, undefined, { timeout: 5000 });

      const quantity = await page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        return host?.shadowRoot?.querySelector(".kr-ingredient__quantity")?.textContent ?? "";
      });
      expect(quantity).toContain("g");

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
