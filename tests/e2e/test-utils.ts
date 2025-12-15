import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Get project root (two levels up from this file)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
export const projectRoot = join(__dirname, "../..");

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
    }
  })();

  return bundlePromise;
};
