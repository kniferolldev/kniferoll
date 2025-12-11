import { expect, test, beforeAll } from "bun:test";
import { mkdir, readFile, rm, stat } from "node:fs/promises";
import { join } from "node:path";

const DIST_DIR = join(import.meta.dir, "..", "..", "dist");
const ENTRY_POINT = join(import.meta.dir, "..", "..", "index.ts");

beforeAll(async () => {
  // Build bundles fresh for testing
  await rm(DIST_DIR, { recursive: true, force: true });
  await mkdir(DIST_DIR, { recursive: true });

  const variants = [
    { name: "kniferoll.js", minify: false, sourcemap: "inline" as const },
    { name: "kniferoll.min.js", minify: true, sourcemap: "none" as const },
  ];

  for (const variant of variants) {
    const result = await Bun.build({
      entrypoints: [ENTRY_POINT],
      target: "browser",
      format: "esm",
      splitting: false,
      sourcemap: variant.sourcemap,
      minify: variant.minify,
      outdir: DIST_DIR,
      naming: variant.name,
    });

    if (!result.success) {
      throw new Error(`Failed to build ${variant.name} for testing`);
    }
  }
});

test("built bundles exist and have reasonable sizes", async () => {
  const devBundle = join(DIST_DIR, "kniferoll.js");
  const minBundle = join(DIST_DIR, "kniferoll.min.js");

  // Check files exist
  const devStat = await stat(devBundle);
  const minStat = await stat(minBundle);

  expect(devStat.isFile()).toBe(true);
  expect(minStat.isFile()).toBe(true);

  // Check minified bundle is smaller than dev bundle
  expect(minStat.size).toBeLessThan(devStat.size);

  // Check minified bundle is under 200kb (generous target)
  const minKb = minStat.size / 1024;
  expect(minKb).toBeLessThan(200);

  console.log(`  Dev bundle: ${(devStat.size / 1024).toFixed(1)} KB`);
  console.log(`  Min bundle: ${(minStat.size / 1024).toFixed(1)} KB`);
});

test("built bundles are valid JavaScript modules", async () => {
  const devBundle = join(DIST_DIR, "kniferoll.js");
  const minBundle = join(DIST_DIR, "kniferoll.min.js");

  const devCode = await readFile(devBundle, "utf-8");
  const minCode = await readFile(minBundle, "utf-8");

  // Both should export something
  expect(devCode).toContain("export");
  expect(minCode).toContain("export");

  // Both should register the custom element
  expect(devCode).toContain("customElements");
  expect(minCode).toContain("customElements");

  // Check for key component pieces
  expect(devCode).toContain("kr-recipe");
  expect(minCode).toContain("kr-recipe");
});

test("minified bundle doesn't contain source maps", async () => {
  const minBundle = join(DIST_DIR, "kniferoll.min.js");
  const minCode = await readFile(minBundle, "utf-8");

  // Minified bundle should not contain sourcemap comments
  expect(minCode).not.toContain("sourceMappingURL");
});
