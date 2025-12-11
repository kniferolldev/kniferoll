import { expect, test } from "bun:test";
import type { Browser } from "playwright";
import { chromium } from "playwright";

const skipE2E = Bun.env.KNIFEROLL_E2E_SKIP === "1";
const activeTest = skipE2E ? test.skip : test;

const PLAYGROUND_URL = Bun.env.PLAYGROUND_URL || "http://127.0.0.1:5173";

activeTest(
  "playground loads and renders recipes (requires running demo server)",
  async () => {
    let browser: Browser | null = null;

    try {
      // Check if server is running
      let serverReady = false;
      try {
        const response = await fetch(PLAYGROUND_URL);
        serverReady = response.ok;
      } catch {
        // Server not running
      }

      if (!serverReady) {
        throw new Error(
          `Demo server not running at ${PLAYGROUND_URL}. Start it with: bun run demo`
        );
      }

      browser = await chromium.launch({ headless: true });
      const context = await browser.newContext();
      const page = await context.newPage();

      // Listen for all console messages
      const consoleMessages: Array<{ type: string; text: string }> = [];
      page.on("console", (msg) => {
        consoleMessages.push({ type: msg.type(), text: msg.text() });
      });

      // Listen for page errors
      const pageErrors: string[] = [];
      page.on("pageerror", (error) => {
        pageErrors.push(error.message);
      });

      // Load the playground
      await page.goto(PLAYGROUND_URL, { waitUntil: "networkidle" });

      // Check if initPlayground was called
      const playgroundLoaded = await page.evaluate(() => {
        return typeof (window as unknown as { initPlayground?: unknown }).initPlayground !== "undefined";
      });
      console.log("Playground module loaded:", playgroundLoaded);

      // Try to wait for component registration with better error
      try {
        await page.waitForFunction(
          () => customElements.get("kr-recipe") !== undefined,
          undefined,
          { timeout: 5000 }
        );
      } catch (error) {
        console.log("Console messages:", consoleMessages);
        console.log("Page errors:", pageErrors);
        throw error;
      }

      // Wait for recipes to load
      await page.waitForFunction(
        () => {
          const select = document.getElementById("recipe-preset") as HTMLSelectElement | null;
          return select && select.options.length > 1; // More than just "Custom"
        },
        undefined,
        { timeout: 5000 }
      );

      // Check that first recipe loaded
      const recipeCount = await page.evaluate(() => {
        const select = document.getElementById("recipe-preset") as HTMLSelectElement | null;
        return select ? select.options.length - 1 : 0; // Subtract "Custom" option
      });
      expect(recipeCount).toBeGreaterThan(0);

      // Check that source textarea has content
      const sourceContent = await page.evaluate(() => {
        const textarea = document.getElementById("source") as HTMLTextAreaElement | null;
        return textarea?.value || "";
      });
      expect(sourceContent.length).toBeGreaterThan(0);

      // Check that preview has rendered content
      await page.waitForFunction(
        () => {
          const preview = document.getElementById("preview");
          return !!preview?.shadowRoot?.querySelector(".kr-recipe__title");
        },
        undefined,
        { timeout: 5000 }
      );

      const hasTitle = await page.evaluate(() => {
        const preview = document.getElementById("preview");
        return !!preview?.shadowRoot?.querySelector(".kr-recipe__title");
      });
      expect(hasTitle).toBe(true);

      // Test typing in the editor
      await page.evaluate(() => {
        const textarea = document.getElementById("source") as HTMLTextAreaElement;
        const select = document.getElementById("recipe-preset") as HTMLSelectElement;
        // Clear and set custom content
        select.value = "";
        textarea.value = "# Test Recipe\n## Ingredients\n- salt\n## Steps\n1. Cook.";
        textarea.dispatchEvent(new Event("input", { bubbles: true }));
      });

      // Wait for debounced update
      await new Promise((resolve) => setTimeout(resolve, 200));

      // Check that preview updated
      const updatedTitle = await page.evaluate(() => {
        const preview = document.getElementById("preview");
        return preview?.shadowRoot?.querySelector(".kr-recipe__title")?.textContent || "";
      });
      expect(updatedTitle).toBe("Test Recipe");

      await context.close();
    } finally {
      if (browser) {
        await browser.close();
      }
    }
  },
  { timeout: 30_000 }
);
