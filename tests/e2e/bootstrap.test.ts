import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { BrowserType, Browser } from "playwright";
import { chromium, firefox, webkit } from "playwright";

const skipE2E = Bun.env.KNIFEROLL_E2E_SKIP === "1";

type BrowserEntry = {
  name: string;
  launcher: BrowserType;
};

const browsers: BrowserEntry[] = [
  { name: "webkit", launcher: webkit },
  { name: "chromium", launcher: chromium },
  { name: "firefox", launcher: firefox },
];

const bundleMarkdown = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

let bundleCache: string | null = null;

const loadComponentBundle = async (): Promise<string> => {
  if (bundleCache) {
    return bundleCache;
  }

  const tempDir = await mkdtemp(join(tmpdir(), "kniferoll-e2e-"));
  try {
    const result = await Bun.build({
      entrypoints: ["index.ts"],
      target: "browser",
      format: "esm",
      splitting: false,
      sourcemap: "none",
      minify: false,
      outdir: tempDir,
    });

    const output = result.outputs.find((item) => item.kind === "entry-point");
    if (!output || !output.path) {
      throw new Error("Failed to compile component bundle for e2e test.");
    }

    const code = await readFile(output.path, "utf8");
    bundleCache = code;
    return code;
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
};

const activeTest = skipE2E ? test.skip : test;

activeTest(
  "bootstrap fixture renders across Playwright browsers",
  async () => {
    const moduleCode = await loadComponentBundle();

    const markdown = [
      "---",
      "version: 0.0.1",
      "scales:",
      "  - name: triple",
      "    anchor: { id: oats, amount: 3, unit: cup }",
      "---",
      "# Kitchen Notebook",
      "",
      "# Porridge",
      "## Ingredients",
      '- oats - 1 cup :: also="90 g"',
      "- water - 2 cups",
      "## Steps",
      "1. simmer [[oats]] @190F @2s.",
      "",
      "# Smoothie",
      "## Ingredients",
      "- berries",
      "## Steps",
      "1. blend.",
    ].join("\n");

    const successes: string[] = [];
    const failures: string[] = [];

    for (const { name, launcher } of browsers) {
      let browser: Browser | null = null;
      try {
        browser = await launcher.launch({ headless: true });
      } catch (error) {
        failures.push(`${name}: ${(error as Error).message}`);
        continue;
      }

      const context = await browser.newContext();
      const page = await context.newPage();

      try {
        await page.setContent(
          `
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="utf-8" />
              <title>Kniferoll Fixture</title>
              <style>
                body { font-family: system-ui, sans-serif; margin: 0; padding: 2rem; }
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

        await page.waitForFunction(() => {
          const host = document.querySelector("kr-recipe");
          return !!host?.shadowRoot?.querySelector(".kr-recipe__title");
        });

        const docTitle = await page.evaluate(() => {
          const host = document.querySelector("kr-recipe");
          return host?.shadowRoot?.querySelector(".kr-document-title")?.textContent ?? null;
        });
        expect(docTitle).toBe("Kitchen Notebook");

        const mainRecipeRole = await page.evaluate(() => {
          const host = document.querySelector("kr-recipe");
          return host?.shadowRoot?.querySelector(".kr-recipe")?.getAttribute("data-kr-role") ?? null;
        });
        expect(mainRecipeRole).toBe("main");

        const titles = await page.evaluate(() => {
          const host = document.querySelector("kr-recipe");
          if (!host?.shadowRoot) {
            return [];
          }
          return Array.from(
            host.shadowRoot.querySelectorAll(".kr-recipe__title"),
            (node) => node.textContent,
          );
        });
        expect(titles).toEqual(["Porridge", "Smoothie"]);

        await page.waitForFunction(() => {
          const host = document.querySelector("kr-recipe");
          return !!host?.shadowRoot?.querySelector(".kr-scale-control");
        });
        await page.evaluate(() => {
          const host = document.querySelector("kr-recipe");
          const select = host?.shadowRoot?.querySelector(".kr-scale-control") as HTMLSelectElement | null;
          if (select) {
            select.value = "preset:0";
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });

        await page.waitForFunction(() => {
          const host = document.querySelector("kr-recipe");
          const quantity = host?.shadowRoot?.querySelector(".kr-ingredient__quantity")?.textContent ?? "";
          return quantity.includes("3");
        });

        await page.waitForFunction(() => {
          const host = document.querySelector("kr-recipe");
          return !!host?.shadowRoot?.querySelector(".kr-quantity-control");
        });
        await page.evaluate(() => {
          const host = document.querySelector("kr-recipe");
          const select = host?.shadowRoot?.querySelector(".kr-quantity-control") as HTMLSelectElement | null;
          if (select) {
            select.value = "alt-mass";
            select.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });

        await page.waitForFunction(() => {
          const host = document.querySelector("kr-recipe");
          const quantity = host?.shadowRoot?.querySelector(".kr-ingredient__quantity")?.textContent ?? "";
          return quantity.includes("g");
        });

        const quantityMode = await page.evaluate(() => {
          const host = document.querySelector("kr-recipe");
          return host?.shadowRoot?.querySelector(".kr-ingredient")?.getAttribute("data-kr-quantity-mode") ?? null;
        });
        expect(quantityMode).toBe("alt-mass");

        const refInteraction = await page.evaluate(() => {
          const host = document.querySelector("kr-recipe");
          if (!host) {
            return null;
          }
          (window as unknown as Record<string, unknown>).lastRefDetail = null;
          host.addEventListener(
            "kr:ref-focus",
            (event) => {
              (window as unknown as Record<string, unknown>).lastRefDetail = (event as CustomEvent).detail;
            },
            { once: true },
          );
          const ref = host.shadowRoot?.querySelector(".kr-ref") as HTMLButtonElement | null;
          ref?.dispatchEvent(new Event("click", { bubbles: true }));
          const targetAttr = ref?.getAttribute("data-kr-target") ?? "";
          const targetNode = targetAttr
            ? host.shadowRoot?.querySelector(`[data-kr-id="${targetAttr}"]`)
            : null;
          const active = host.shadowRoot?.activeElement ?? document.activeElement;
          return {
            hasRef: !!ref,
            active: ref?.classList.contains("kr-ref--active") ?? false,
            highlighted:
              host.shadowRoot?.querySelectorAll(".kr-target-highlight").length ?? 0,
            detail: (window as unknown as Record<string, unknown>).lastRefDetail ?? null,
            controls: ref?.getAttribute("aria-controls") ?? null,
            ariaPressed: ref?.getAttribute("aria-pressed") ?? null,
            targetActive: targetNode?.getAttribute("data-kr-target-active") ?? null,
            activeElementId: active instanceof HTMLElement ? active.id : null,
          };
        });
        if (!refInteraction?.active) {
          throw new Error(`reference interaction failed: ${JSON.stringify(refInteraction)}`);
        }
        expect(refInteraction.hasRef).toBe(true);
        expect(refInteraction.highlighted > 0).toBe(true);
        expect((refInteraction.detail as { targetId?: string } | null)?.targetId).toBe("oats");
        expect(refInteraction.controls).toBe("kr-ingredient-oats");
        expect(refInteraction.ariaPressed).toBe("true");
        expect(refInteraction.targetActive).toBe("true");
        expect(refInteraction.activeElementId).toBe("kr-ingredient-oats");

        const temperatureData = await page.evaluate(() => {
          const host = document.querySelector("kr-recipe");
          const temp = host?.shadowRoot?.querySelector(".kr-temperature");
          if (!host || !temp) {
            return null;
          }
          return {
            text: temp.textContent ?? "",
            scale: temp.getAttribute("data-kr-temperature-scale"),
            altScale: temp.getAttribute("data-kr-temperature-alt-scale"),
          };
        });
        expect(temperatureData?.scale).toBe("F");
        expect(temperatureData?.altScale).toBe("C");
        expect(temperatureData?.text.includes("190")).toBe(true);

        await page.waitForFunction(() => {
          const host = document.querySelector("kr-recipe");
          return !!host?.shadowRoot?.querySelector('.kr-timer[data-kr-timer-label="2s"]');
        });

        await page.evaluate(() => {
          const host = document.querySelector("kr-recipe");
          if (!host) {
            return;
          }
          (window as unknown as { timerStartDetail?: unknown }).timerStartDetail = null;
          host.addEventListener(
            "kr:timer-start",
            (event) => {
              (window as unknown as { timerStartDetail?: unknown }).timerStartDetail = (event as CustomEvent).detail;
            },
            { once: true },
          );
        });

        await page.evaluate(() => {
          const host = document.querySelector("kr-recipe");
          const timer = host?.shadowRoot?.querySelector<HTMLButtonElement>('.kr-timer[data-kr-timer-label="2s"]');
          timer?.click();
        });

        const timerStartHandle = await page.waitForFunction(() => {
          const store = (window as unknown as { timerStartDetail?: unknown }).timerStartDetail;
          return store ?? null;
        }, { timeout: 2_000 });
        const timerStart = (await timerStartHandle.jsonValue()) as {
          label?: string;
          durationMs?: number;
          startedAt?: number;
        };
        expect(timerStart?.label).toBe("2s");
        expect(timerStart?.durationMs).toBe(2_000);
        expect(typeof timerStart?.startedAt).toBe("number");

        await page.evaluate(() => {
          const host = document.querySelector("kr-recipe");
          host?.setAttribute("layout", "two-column");
        });

        const layoutDetail = await page.evaluate(() => {
          const host = document.querySelector("kr-recipe");
          if (!host?.shadowRoot) {
            return null;
          }
          const root = host.shadowRoot.querySelector(".kr-root");
          const recipe = host.shadowRoot.querySelector(".kr-recipe");
          const display = recipe ? window.getComputedStyle(recipe).display : null;
          return {
            rootLayout: root?.getAttribute("data-kr-layout") ?? null,
            recipeLayout: recipe?.getAttribute("data-kr-layout") ?? null,
            display,
          };
        });
        expect(layoutDetail?.rootLayout).toBe("two-column");
        expect(layoutDetail?.recipeLayout).toBe("two-column");
        expect(layoutDetail?.display).toBe("grid");

        await page.evaluate(() => {
          const host = document.querySelector<HTMLElement & { content?: string }>("kr-recipe");
          if (!host) {
            return;
          }
          host.setAttribute("show-diagnostics", "true");
          const nextContent = [
            "# Broken",
            "",
            "# Incomplete",
            "## Ingredients",
            "- salt",
          ].join("\n");
          (host as unknown as { content: string }).content = nextContent;
        });

        await page.waitForFunction(() => {
          const host = document.querySelector<HTMLElement>("kr-recipe");
          return !!host?.shadowRoot?.querySelector('[data-kr-diagnostics]');
        });

        const diagnosticsDetail = await page.evaluate(() => {
          const host = document.querySelector<HTMLElement>("kr-recipe");
          if (!host?.shadowRoot) {
            return null;
          }
          const panel = host.shadowRoot.querySelector('[data-kr-diagnostics]');
          const count = host.shadowRoot
            .querySelector('.kr-root')
            ?.getAttribute('data-kr-diagnostics-count');
          return {
            hasPanel: !!panel,
            count,
          };
        });
        expect(diagnosticsDetail?.hasPanel).toBe(true);
        expect(diagnosticsDetail?.count).toBe("1");

        const screenshot = await page.screenshot({ fullPage: true });
        expect(screenshot.byteLength).toBeGreaterThan(5_000);

        successes.push(name);
      } catch (error) {
        failures.push(`${name}: ${(error as Error).message}`);
      } finally {
        await context.close();
        await browser.close();
      }
    }

    if (successes.length === 0) {
      throw new Error(
        `Playwright browsers unavailable for e2e test. Failures: ${failures.join(
          "; ",
        )}`,
      );
    }
  },
  { timeout: 240_000 },
);
