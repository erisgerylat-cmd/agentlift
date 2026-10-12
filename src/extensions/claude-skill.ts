import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";

import { fixtureDigest } from "../evidence/environment.js";
import { assertSafeFixture } from "../security.js";
import type { Condition, RunStartMessage } from "../types.js";
import type { ExtensionAdapter } from "./extension-adapter.js";

export class ClaudeSkillExtension implements ExtensionAdapter {
  readonly name = "claude-skill";
  private snapshot: string | null = null;
  private hash: string | null = null;

  constructor(private readonly options: { name: string; path: string }) {}

  async validate(): Promise<void> {
    await assertSafeFixture(this.options.path);
    const source = await readFile(path.join(this.options.path, "SKILL.md"), "utf8");
    const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]+)$/u.exec(source);
    const metadata = match ? parse(match[1]!) : null;
    if (!metadata || metadata.name !== this.options.name ||
        typeof metadata.description !== "string" || !metadata.description.trim() ||
        !match?.[2]?.trim()) {
      throw new Error("Skill requires matching name, description and body in SKILL.md");
    }
    this.hash = await fixtureDigest(this.options.path);
  }

  async install(experimentRoot: string): Promise<void> {
    const snapshot = path.join(experimentRoot, "candidate-skill");
    await cp(this.options.path, snapshot, { recursive: true, errorOnExist: true });
    this.snapshot = snapshot;
    if (await fixtureDigest(snapshot) !== this.hash) {
      throw new Error("Skill changed during snapshot creation");
    }
  }

  async prepare(workspace: string, condition: Condition): Promise<RunStartMessage["skillConfig"]> {
    if (!this.snapshot) throw new Error("Skill must be installed before preparing a run");
    if (condition === "baseline") return undefined;
    const target = path.join(workspace, ".claude", "skills", this.options.name);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(this.snapshot, target, { recursive: true, errorOnExist: true });
    return { name: this.options.name, path: target };
  }

  async enable(): Promise<null> { return null; }
  async disable(): Promise<null> { return null; }
  async uninstall(): Promise<void> {
    if (this.snapshot) await rm(this.snapshot, { recursive: true, force: true });
    this.snapshot = null;
  }
}
