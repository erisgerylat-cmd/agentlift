import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { digest } from "./environment.js";
import { assertSafeFixture } from "../security.js";
import type { RunEvent } from "../types.js";

export async function workspaceManifest(root: string) {
  await assertSafeFixture(root);
  const files: Record<string, { hash: string; bytes: number }> = {};
  async function visit(directory: string) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if ([".claude", ".git", "node_modules"].includes(entry.name)) continue;
      const file = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(file);
      else files[path.relative(root, file)] = {
        hash: digest(await readFile(file)), bytes: (await stat(file)).size,
      };
    }
  }
  await visit(root);
  return files;
}

export function workspaceChanges(
  before: Awaited<ReturnType<typeof workspaceManifest>>,
  after: Awaited<ReturnType<typeof workspaceManifest>>,
): RunEvent[] {
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()
    .filter(file => before[file]?.hash !== after[file]?.hash)
    .map(file => ({ type: "file.change", path: file,
      status: !before[file] ? "added" : !after[file] ? "deleted" : "modified",
      beforeHash: before[file]?.hash ?? null, afterHash: after[file]?.hash ?? null,
      bytes: after[file]?.bytes ?? 0 }));
}
