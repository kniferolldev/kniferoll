# Testing in Bun Projects

This guide covers how testing works in this Bun project, including unit tests, integration tests, and browser-based E2E tests with Playwright.

## Tech Stack

- **Test Runner**: Bun's built-in test runner (`bun:test`)
- **E2E Browser Automation**: Playwright (headless Chromium)
- **Configuration**: `bunfig.toml` for test settings

## Running Tests

```bash
bun test                     # Run all tests
bun test tests/e2e           # Run only E2E tests
bun test src/core            # Run only core unit tests
bun test --coverage          # Run with coverage report
```

## Test Organization

Tests are co-located with source files:

```
src/
├── core/
│   ├── format.ts
│   ├── format.test.ts      # Unit test next to source
│   ├── parser.ts
│   └── parser.test.ts
├── commands/
│   └── check.test.ts
└── ...

tests/
├── build/
│   └── bundle.test.ts      # Build output verification
└── e2e/
    ├── test-utils.ts       # Shared browser/bundle helpers
    ├── rendering.test.ts   # Browser-based component tests
    └── ...
```

## Configuration

`bunfig.toml`:

```toml
[test]
coverageSkipTestFiles = true
```

## Unit Tests

Unit tests import directly from `bun:test` and test pure functions:

```typescript
import { expect, test } from "bun:test";
import { formatQuantity } from "./format";

test("formatQuantity renders simple values", () => {
  const q = parseQuantity("2 cups");
  expect(formatQuantity(q)).toBe("2 cups");
});
```

## Integration Tests

Integration tests call exported handlers directly with mocked dependencies. This approach tests real request handling without starting a server:

```typescript
import { expect, test, describe, beforeAll, beforeEach } from "bun:test";
import { handleRequest } from "./server";

beforeEach(() => {
  // Mock fetch for external services
  globalThis.fetch = async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/.well-known/jwks.json")) {
      return new Response(JSON.stringify(jwks), { status: 200 });
    }
    throw new Error(`Unexpected fetch: ${url}`);
  };
});

describe("GET /health", () => {
  test("returns ok status", async () => {
    const response = await handleRequest(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });
});
```

## Build Tests

Build tests verify the bundler output:

```typescript
import { expect, test, beforeAll } from "bun:test";

beforeAll(async () => {
  // Build fresh for testing
  await Bun.build({
    entrypoints: ["./index.ts"],
    target: "browser",
    outdir: "./dist",
  });
});

test("built bundles exist and have reasonable sizes", async () => {
  const stat = await Bun.file("./dist/bundle.js").stat();
  expect(stat.size).toBeLessThan(200 * 1024);
});
```

## E2E Tests with Playwright

E2E tests run real browsers to test web components. The key challenges are:
- Browser launch overhead when tests run in parallel
- Bundle compilation overhead for each test
- Proper cleanup to prevent resource leaks

### Core Patterns

**1. Shared Browser Instance**

A single browser instance is shared across all tests. Each test gets an isolated `BrowserContext`:

```typescript
let sharedBrowser: Browser | null = null;
let browserPromise: Promise<Browser> | null = null;

export const getSharedBrowser = async (): Promise<Browser> => {
  if (sharedBrowser) return sharedBrowser;
  if (browserPromise) return browserPromise;

  browserPromise = (async () => {
    const browser = await chromium.launch({ headless: true });
    sharedBrowser = browser;
    return browser;
  })();

  return browserPromise;
};
```

The `browserPromise` pattern prevents race conditions—concurrent callers await the same promise rather than launching multiple browsers.

**2. Cached Bundle Compilation**

The component bundle is built once and cached:

```typescript
let bundleCache: string | null = null;
let bundlePromise: Promise<string> | null = null;

export const loadComponentBundle = async (): Promise<string> => {
  if (bundleCache) return bundleCache;
  if (bundlePromise) return bundlePromise;

  bundlePromise = (async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "e2e-"));
    try {
      const result = await Bun.build({
        entrypoints: [join(projectRoot, "index.ts")],
        target: "browser",
        format: "esm",
        outdir: tempDir,
      });

      const output = result.outputs.find((item) => item.kind === "entry-point");
      if (!output?.path) throw new Error("Build failed");

      const code = await readFile(output.path, "utf8");
      bundleCache = code;
      return code;
    } finally {
      await rm(tempDir, { recursive: true, force: true });
      bundlePromise = null;
    }
  })();

  return bundlePromise;
};
```

**3. Test Context Pattern**

Each test creates an isolated context and cleans up in `finally`:

```typescript
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
```

### E2E Test Structure

```typescript
import { expect, test } from "bun:test";
import {
  bundleMarkdown,
  closeTestContext,
  createTestContext,
  loadComponentBundle,
} from "./test-utils";

test(
  "renders component correctly",
  async () => {
    const moduleCode = await loadComponentBundle();
    const ctx = await createTestContext();

    try {
      // Set up page with component
      await ctx.page.setContent(`
        <!DOCTYPE html>
        <html>
          <body>
            <my-component>${bundleMarkdown(content)}</my-component>
          </body>
        </html>
      `);

      // Inject component code
      await ctx.page.addScriptTag({ type: "module", content: moduleCode });

      // Wait for shadow DOM to render
      await ctx.page.waitForFunction(
        () => {
          const host = document.querySelector("my-component");
          return !!host?.shadowRoot?.querySelector(".rendered");
        },
        undefined,
        { timeout: 5000 },
      );

      // Assert
      const text = await ctx.page.evaluate(() => {
        const host = document.querySelector("my-component");
        return host?.shadowRoot?.querySelector(".title")?.textContent;
      });
      expect(text).toBe("Expected Title");
    } finally {
      await closeTestContext(ctx);
    }
  },
);
```

### Querying Shadow DOM

Use `page.evaluate()` to access shadow roots:

```typescript
const text = await ctx.page.evaluate(() => {
  const host = document.querySelector("my-component");
  return host?.shadowRoot?.querySelector(".element")?.textContent ?? null;
});
```

### Simulating User Interactions

```typescript
// Keyboard
await ctx.page.keyboard.press("ArrowDown");

// DOM events
await ctx.page.evaluate(() => {
  const host = document.querySelector("my-component");
  const select = host?.shadowRoot?.querySelector("select") as HTMLSelectElement;
  select.value = "new-value";
  select.dispatchEvent(new Event("change", { bubbles: true }));
});
```

### HTML Escaping

When embedding content in HTML:

```typescript
export const bundleMarkdown = (value: string): string =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
```

## Full test-utils.ts

```typescript
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Browser, BrowserContext, Page } from "playwright";
import { chromium } from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const projectRoot = join(__dirname, "../..");

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
      bundlePromise = null;
    }
  })();

  return bundlePromise;
};
```

## Adapting for Other Projects

1. Install dependencies:
   ```bash
   bun add -d playwright
   ```

2. Copy `test-utils.ts` and adjust:
   - Update `projectRoot` for your directory structure
   - Modify `loadComponentBundle()` entrypoint

3. Use the test context pattern with try/finally for cleanup
