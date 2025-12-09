/**
 * Screenshot capture script for visual feedback loop.
 *
 * Usage:
 *   bun run screenshot                     # Capture playground
 *   bun run screenshot --layout two-column # Capture specific layout
 *   bun run screenshot --all-layouts       # Capture all layout variants
 *   bun run screenshot --dark              # Capture in dark theme
 *   bun run screenshot --high-contrast     # Capture in high contrast theme
 *   bun run screenshot --css-panel         # Capture with CSS panel open
 *   bun run screenshot --events-panel      # Capture with events panel open
 *   bun run screenshot --recipe cabbage    # Load specific recipe preset
 *
 * Screenshots are saved to screenshots/ directory.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { chromium } from "playwright";
import type { Page } from "playwright";

const SCREENSHOTS_DIR = join(import.meta.dir, "..", "screenshots");
const BASE_URL = "http://127.0.0.1:5173";

const LAYOUTS = [
  "stacked",
  "two-column",
  "steps-left",
  "ingredients-left",
  "print-compact",
];

interface CaptureOptions {
  layout?: string;
  allLayouts?: boolean;
  theme?: "light" | "dark" | "high-contrast";
  cssPanel?: boolean;
  eventsPanel?: boolean;
  recipe?: string;
  dumpDom?: boolean;
}

const parseArgs = (): CaptureOptions => {
  const args = process.argv.slice(2);
  const options: CaptureOptions = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--layout" && args[i + 1]) {
      options.layout = args[++i];
    } else if (args[i] === "--all-layouts") {
      options.allLayouts = true;
    } else if (args[i] === "--dark") {
      options.theme = "dark";
    } else if (args[i] === "--high-contrast") {
      options.theme = "high-contrast";
    } else if (args[i] === "--css-panel") {
      options.cssPanel = true;
    } else if (args[i] === "--events-panel") {
      options.eventsPanel = true;
    } else if (args[i] === "--recipe" && args[i + 1]) {
      options.recipe = args[++i];
    } else if (args[i] === "--dump-dom") {
      options.dumpDom = true;
    }
  }

  return options;
};

const waitForRecipeRender = async (page: Page): Promise<void> => {
  await page.waitForSelector("kr-recipe", { timeout: 5000 });
  await page.waitForTimeout(300);
};

const setTheme = async (
  page: Page,
  theme?: "light" | "dark" | "high-contrast"
): Promise<void> => {
  if (!theme || theme === "light") return;
  await page.click(`.theme-btn[data-theme="${theme}"]`);
  await page.waitForTimeout(100);
};

const capture = async (
  page: Page,
  options: CaptureOptions
): Promise<string[]> => {
  const captured: string[] = [];

  await page.goto(`${BASE_URL}/`);
  await waitForRecipeRender(page);
  await setTheme(page, options.theme);

  // Select recipe if requested
  if (options.recipe) {
    await page.selectOption("#recipe-preset", options.recipe);
    await page.waitForTimeout(300);
  }

  // Open panels if requested
  if (options.cssPanel) {
    await page.click("#css-toggle");
    await page.waitForTimeout(100);
  }
  if (options.eventsPanel) {
    await page.click("#log-toggle");
    await page.waitForTimeout(100);
  }

  const themeSuffix = options.theme && options.theme !== "light" ? `-${options.theme}` : "";
  const panelSuffix = options.cssPanel ? "-css" : options.eventsPanel ? "-events" : "";

  if (options.allLayouts) {
    for (const layout of LAYOUTS) {
      await page.selectOption("#layout-select", layout);
      await page.waitForTimeout(150);
      const filename = `layout-${layout}${themeSuffix}${panelSuffix}.png`;
      await page.screenshot({ path: join(SCREENSHOTS_DIR, filename), fullPage: true });
      captured.push(filename);
    }
  } else if (options.layout) {
    await page.selectOption("#layout-select", options.layout);
    await page.waitForTimeout(150);
    const filename = `playground-${options.layout}${themeSuffix}${panelSuffix}.png`;
    await page.screenshot({ path: join(SCREENSHOTS_DIR, filename), fullPage: true });
    captured.push(filename);
  } else {
    const filename = `playground${themeSuffix}${panelSuffix}.png`;
    await page.screenshot({ path: join(SCREENSHOTS_DIR, filename), fullPage: true });
    captured.push(filename);
  }

  // Dump DOM if requested
  if (options.dumpDom) {
    const recipeHtml = await page.evaluate(() => {
      const krRecipe = document.querySelector("kr-recipe");
      if (!krRecipe || !krRecipe.shadowRoot) return null;

      const root = krRecipe.shadowRoot.querySelector(".kr-root");
      return root ? root.innerHTML : null;
    });

    if (recipeHtml) {
      const domFilename = `dom-dump${themeSuffix}${panelSuffix}.html`;
      await writeFile(join(SCREENSHOTS_DIR, domFilename), recipeHtml, "utf-8");
      console.log(`  DOM dump: screenshots/${domFilename}`);
    }
  }

  return captured;
};

const main = async (): Promise<void> => {
  const options = parseArgs();

  await mkdir(SCREENSHOTS_DIR, { recursive: true });

  // Check if server is running
  try {
    await fetch(BASE_URL);
  } catch {
    console.error(`Demo server not running. Start it with: bun run demo`);
    process.exit(1);
  }

  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
  });
  const page = await context.newPage();

  try {
    const captured = await capture(page, options);
    console.log(`Captured ${captured.length} screenshot(s):`);
    for (const filename of captured) {
      console.log(`  screenshots/${filename}`);
    }
  } finally {
    await browser.close();
  }
};

main().catch((error) => {
  console.error("Screenshot capture failed:", error);
  process.exit(1);
});
