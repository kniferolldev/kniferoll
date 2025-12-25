/**
 * Promote Command - Move an imported recipe to the eval set
 */

import { join, basename } from "path";
import { mkdir, copyFile } from "fs/promises";
import type { IO } from "../types";

/** Parse CLI arguments */
function parseArgs(args: string[]): {
  sourcePath: string | null;
  name: string | null;
} {
  let sourcePath: string | null = null;
  let name: string | null = null;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--name" && args[i + 1]) {
      name = args[++i];
    } else if (!arg.startsWith("-")) {
      sourcePath = arg;
    }
  }

  return { sourcePath, name };
}

/** Generate a slug from a name */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Main promote runner */
export async function runPromote(
  args: string[],
  io: IO
): Promise<number> {
  const encoder = new TextEncoder();
  const write = (s: string) => io.stdout.write(encoder.encode(s));
  const writeErr = (s: string) => io.stderr.write(encoder.encode(s));

  const { sourcePath, name } = parseArgs(args);

  // Validate arguments
  if (!sourcePath) {
    writeErr("Usage: kr promote <imported-recipes/dir> --name <name>\n");
    writeErr("Example: kr promote imported-recipes/2025-12-14-174821-v2yceb --name fried-rice\n");
    return 2;
  }

  if (!name) {
    writeErr("Error: --name is required\n");
    writeErr("Example: kr promote imported-recipes/2025-12-14-174821-v2yceb --name fried-rice\n");
    return 2;
  }

  // Check source directory exists
  const sourceDir = sourcePath.endsWith("/") ? sourcePath.slice(0, -1) : sourcePath;
  const outputFile = Bun.file(join(sourceDir, "output.md"));
  if (!(await outputFile.exists())) {
    writeErr(`Error: ${sourceDir}/output.md not found\n`);
    writeErr("Make sure you're pointing to an imported-recipes directory\n");
    return 1;
  }

  // Create target directory
  const slug = slugify(name);
  const targetDir = join("evals", slug);

  // Check if target already exists
  const targetExpected = Bun.file(join(targetDir, "expected.md"));
  if (await targetExpected.exists()) {
    writeErr(`Error: ${targetDir} already exists\n`);
    writeErr("Choose a different name or remove the existing directory\n");
    return 1;
  }

  await mkdir(targetDir, { recursive: true });

  const copiedFiles: string[] = [];

  // Copy output.md → both expected.md AND actual.md
  // expected.md is the golden version (user will edit this)
  // actual.md is the cached importer output (regenerate when prompt changes)
  const outputContent = await outputFile.text();
  await Bun.write(join(targetDir, "expected.md"), outputContent);
  await Bun.write(join(targetDir, "actual.md"), outputContent);
  copiedFiles.push("expected.md (from output.md - edit this to create golden)");
  copiedFiles.push("actual.md (from output.md - cached importer output)");

  // Copy input.txt if it exists
  const inputFile = Bun.file(join(sourceDir, "input.txt"));
  if (await inputFile.exists()) {
    const inputContent = await inputFile.text();
    await Bun.write(join(targetDir, "input.txt"), inputContent);
    copiedFiles.push("input.txt");
  } else {
    // Copy images if they exist
    const imageFiles = await Array.fromAsync(
      new Bun.Glob("image*.{jpg,jpeg,png,webp}").scan({ cwd: sourceDir })
    );

    for (const imageFile of imageFiles.sort()) {
      await copyFile(join(sourceDir, imageFile), join(targetDir, imageFile));
      copiedFiles.push(imageFile);
    }
  }

  // Output result
  write(`Created ${targetDir}/\n`);
  for (const file of copiedFiles) {
    write(`  - ${file}\n`);
  }

  return 0;
}
