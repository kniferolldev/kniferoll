import { expect, test } from "bun:test";
import type { Browser } from "playwright";
import { chromium } from "playwright";
import { bundleMarkdown, loadComponentBundle } from "./test-utils";

test(
  "applies CSS custom properties for theming",
  async () => {
    const moduleCode = await loadComponentBundle();

    const markdown = [
      "# Test Recipe",
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
            <title>CSS Variables Test</title>
            <style>
              kr-recipe {
                --kr-color-accent: rgb(255, 0, 0);
                --kr-font-size-base: 24px;
                --kr-card-padding: 3rem;
              }
            </style>
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
        return !!host?.shadowRoot?.querySelector(".kr-recipe__title");
      }, undefined, { timeout: 5000 });

      // Test that CSS variables are applied
      const styles = await page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        if (!host || !host.shadowRoot) return null;

        const recipe = host.shadowRoot.querySelector(".kr-recipe");
        const computedStyles = recipe ? window.getComputedStyle(recipe) : null;

        return {
          accentColor: computedStyles?.getPropertyValue("--kr-color-accent").trim() ?? null,
          fontSize: computedStyles?.getPropertyValue("--kr-font-size-base").trim() ?? null,
          padding: computedStyles?.getPropertyValue("--kr-card-padding").trim() ?? null,
        };
      });

      expect(styles?.accentColor).toBe("rgb(255, 0, 0)");
      expect(styles?.fontSize).toBe("24px");
      expect(styles?.padding).toBe("3rem");

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
  "updates content programmatically via content property",
  async () => {
    const moduleCode = await loadComponentBundle();

    const markdown = [
      "# Original",
      "## Ingredients",
      "- salt",
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
            <title>Content Property Test</title>
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
        return !!host?.shadowRoot?.querySelector(".kr-recipe__title");
      }, undefined, { timeout: 5000 });

      // Test: Content property setter
      await page.evaluate(() => {
        const host = document.querySelector<HTMLElement & { content?: string }>("kr-recipe");
        if (host) {
          (host as unknown as { content: string }).content = "# Test\n## Ingredients\n- salt";
        }
      });

      await page.waitForFunction(() => {
        const host = document.querySelector("kr-recipe");
        return host?.shadowRoot?.querySelector(".kr-recipe__title")?.textContent === "Test";
      }, undefined, { timeout: 5000 });

      const updatedTitle = await page.evaluate(() => {
        const host = document.querySelector("kr-recipe");
        return host?.shadowRoot?.querySelector(".kr-recipe__title")?.textContent ?? "";
      });
      expect(updatedTitle).toBe("Test");

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
