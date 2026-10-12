import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import type { LoadedImpactConfig, LoadedTaskSuite } from "../config.js";
import { assertSafeFixture } from "../security.js";

const exec = promisify(execFile);
export const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");

export async function fixtureDigest(root: string): Promise<string> {
  await assertSafeFixture(root);
  const entries: string[] = [];
  async function visit(dir: string) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const file = path.join(dir, entry.name);
      const relative = path.relative(root, file);
      const mode = (await stat(file)).mode & 0o777;
      entries.push(JSON.stringify([relative, mode, entry.isDirectory() ? "directory" : digest(await readFile(file))]));
      if (entry.isDirectory()) await visit(file);
    }
  }
  await visit(root);
  return digest(entries.join("\n"));
}

async function git(cwd: string, args: string[]): Promise<string | null> {
  try {
    const result = await exec("git", ["-C", cwd, ...args], { timeout: 3000, maxBuffer: 1024 * 1024 });
    return result.stdout.trim();
  } catch { return null; }
}

async function commandIdentity(command: string[], cwd: string) {
  const files: Record<string, string> = {};
  for (const argument of command) {
    if (argument.startsWith("-")) continue;
    const file = path.resolve(cwd, argument);
    try {
      if ((await stat(file)).isFile()) files[argument] = digest(await readFile(file));
    } catch { /* PATH executables may not be directly addressable. */ }
  }
  return { command, cwd, files, version: null as string | null };
}

export async function lockEnvironment(config: LoadedImpactConfig, suite: LoadedTaskSuite) {
  const fixtures: Record<string, string> = {};
  for (const testCase of suite.cases) fixtures[testCase.id] = await fixtureDigest(testCase.fixture.path);
  const runtime = await commandIdentity(config.subject.runner.command, config.subject.runner.cwd);
  const extension = config.candidate.type === "mcp"
    ? await commandIdentity(config.candidate.command, config.candidate.cwd)
    : { command: [], cwd: config.candidate.cwd, files: {}, version: null };
  const skill = config.candidate.type === "skill"
    ? { name: config.candidate.name, digest: await fixtureDigest(config.candidate.path) } : undefined;
  const taskSuiteHash = digest(JSON.stringify(suite.cases.map(c => ({
    id: c.id, task: c.task, tags: c.tags, extensionExpected: c.extensionExpected,
    validators: c.validators, fixture: fixtures[c.id],
  }))));
  return {
    schemaVersion: 1,
    node: process.version,
    os: { platform: process.platform, release: os.release(), arch: process.arch },
    git: {
      commit: await git(config.configDir, ["rev-parse", "HEAD"]),
      status: await git(config.configDir, ["status", "--porcelain"]),
    },
    agent: runtime,
    mcp: extension,
    ...(skill ? { skill } : {}),
    model: { ...config.subject.model, resolvedVersions: [] as string[] },
    experimentSpecHash: digest(await readFile(config.configPath)),
    taskSuiteHash,
    fixtures,
    // Excludes candidate identity and output directory: those may change in a historical comparison.
    comparisonKey: digest(JSON.stringify({
      taskSuiteHash, runtime, model: config.subject.model, protocol: config.subject.runner.protocol,
      allowedTools: config.subject.runner.allowedTools,
      tools: config.subject.runner.tools, resultMode: config.subject.runner.resultMode,
      node: process.version, platform: process.platform, arch: process.arch,
    })),
    adapters: {
      runtime: config.subject.runner.protocol === "claude-code" ? "claude-code@1" : "generic-command@1",
      extension: config.candidate.type === "skill" ? "claude-skill@1" : "stdio-mcp@1",
    },
    repeats: config.execution.repeats,
    seed: config.execution.seed,
    isolation: "process-only",
    network: config.security.network,
    environmentNames: [...new Set([
      ...config.security.envAllowlist, ...config.candidate.envAllowlist,
      config.subject.model.baseUrlEnv, config.subject.model.apiKeyEnv,
    ])].sort(),
    observations: { cache: "unknown", rateLimits: "unknown", modelDrift: "unknown" },
  };
}

export type EnvironmentLock = Awaited<ReturnType<typeof lockEnvironment>>;
