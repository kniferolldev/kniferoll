import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";

// Get project root (two levels up from this file)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const projectRoot = join(__dirname, "../..");

// Shared browser instance to avoid resource contention when tests run in parallel
let sharedBrowser: Browser | null = null;
let browserPromise: Promise<Browser> | null = null;

export const getSharedBrowser = async (): Promise<Browser> => {
  if (sharedBrowser) {
    return sharedBrowser;
  }

  if (browserPromise) {
    return browserPromise;
  }

  browserPromise = (async () => {
    const browser = await chromium.launch({ headless: true });
    sharedBrowser = browser;
    return browser;
  })();

  return browserPromise;
};

export type TestContext = {
  context: BrowserContext;
  page: Page;
};

export const createTestContext = async (): Promise<TestContext> => {
  const browser = await getSharedBrowser();
  const context = await browser.newContext();
  const page = await context.newPage();
  return { context, page };
};

export const closeTestContext = async (ctx: TestContext): Promise<void> => {
  await ctx.context.close();
};

export const bundleMarkdown = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

let bundleCache: string | null = null;
let bundlePromise: Promise<string> | null = null;

export const loadComponentBundle = async (): Promise<string> => {
  if (bundleCache) {
    return bundleCache;
  }

  // If a build is already in progress, wait for it instead of starting another
  if (bundlePromise) {
    return bundlePromise;
  }

  bundlePromise = (async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "kniferoll-e2e-"));
    try {
      const result = await Bun.build({
        entrypoints: [join(projectRoot, "index.ts")],
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
      // Reset the promise so future calls don't return a stale/rejected promise
      bundlePromise = null;
    }
  })();

  return bundlePromise;
};
