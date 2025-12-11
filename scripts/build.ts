/**
 * Production build script
 *
 * Generates minified and unminified bundles in dist/
 *
 * Usage:
 *   bun run build
 */

import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";

const DIST_DIR = join(import.meta.dir, "..", "dist");
const ENTRY_POINT = "index.ts";

interface BuildVariant {
  name: string;
  minify: boolean;
  sourcemap: "none" | "inline" | "external";
}

const variants: BuildVariant[] = [
  { name: "kniferoll.js", minify: false, sourcemap: "inline" },
  { name: "kniferoll.min.js", minify: true, sourcemap: "none" },
];

const main = async (): Promise<void> => {
  console.log("🔨 Building Kniferoll bundles...\n");

  // Clean dist directory
  await rm(DIST_DIR, { recursive: true, force: true });
  await mkdir(DIST_DIR, { recursive: true });

  for (const variant of variants) {
    const startTime = performance.now();

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
      console.error(`❌ Build failed for ${variant.name}:`);
      for (const log of result.logs) {
        console.error(log);
      }
      process.exit(1);
    }

    const output = result.outputs[0];
    if (!output) {
      console.error(`❌ No output generated for ${variant.name}`);
      process.exit(1);
    }

    const sizeKb = (output.size / 1024).toFixed(1);
    const duration = (performance.now() - startTime).toFixed(0);
    const label = variant.minify ? "minified" : "development";

    console.log(`✓ ${variant.name} (${label})`);
    console.log(`  Size: ${sizeKb} KB`);
    console.log(`  Time: ${duration}ms\n`);
  }

  console.log("✨ Build complete!");
  console.log(`📦 Output: ${DIST_DIR}/`);
};

main().catch((error) => {
  console.error("Build failed:", error);
  process.exit(1);
});
