import { access, constants } from "node:fs/promises";
import path from "node:path";

import { loadImpactConfig, loadTaskSuite } from "./config.js";
import { assertSafeFixture } from "./security.js";

async function executable(command: string, cwd: string): Promise<boolean> {
  const candidates = command.includes("/") || command.includes("\\")
    ? [path.resolve(cwd, command)]
    : (process.env.PATH ?? "").split(path.delimiter).map(dir => path.join(dir, command));
  for (const file of candidates) {
    try { await access(file, constants.X_OK); return true; } catch { /* Next PATH entry. */ }
  }
  return false;
}

export async function doctor(configFile?: string) {
  const checks: { name: string; status: "PASS" | "FAIL" | "WARN"; detail: string }[] = [];
  checks.push({ name: "Node.js", status: Number(process.versions.node.split(".")[0]) >= 22 ? "PASS" : "FAIL", detail: process.version });
  checks.push({ name: "Platform", status: process.platform === "win32" ? "FAIL" : "PASS", detail: process.platform });
  checks.push({ name: "Isolation", status: "WARN", detail: "Trusted commands only: process isolation, host filesystem/network permissions remain available." });
  if (configFile) {
    try {
      const config = await loadImpactConfig(configFile);
      const suite = await loadTaskSuite(config.suitePath);
      const runs = suite.cases.length * config.execution.repeats * 2;
      checks.push({ name: "Plan", status: runs <= config.execution.maxRuns ? "PASS" : "FAIL", detail: `${runs} runs; cap ${config.execution.maxRuns}` });
      for (const [name, command, cwd] of [
        ["Agent", config.subject.runner.command, config.subject.runner.cwd],
        ["MCP", config.candidate.command, config.candidate.cwd],
      ] as const) {
        checks.push({ name, status: await executable(command[0]!, cwd) ? "PASS" : "FAIL", detail: "Executable lookup (no command executed)" });
        await access(cwd);
        // Check obvious local script arguments too, including a missing build.
        for (const arg of command.slice(1)) {
          if (arg.startsWith(".") && /\.(?:mjs|cjs|js|ts)$/u.test(arg)) await access(path.resolve(cwd, arg));
        }
      }
      for (const c of suite.cases) await assertSafeFixture(c.fixture.path);
      checks.push({ name: "Fixtures", status: "PASS", detail: `${suite.cases.length} cases; no symbolic links` });
      const reference = config.subject.runner.command.some(c => /runners[\\/]openai\.(js|ts)$/u.test(c));
      for (const name of [config.subject.model.baseUrlEnv, config.subject.model.apiKeyEnv]) {
        checks.push({ name: `Environment ${name}`, status: process.env[name] ? "PASS" : reference ? "FAIL" : "WARN", detail: process.env[name] ? "set (value hidden)" : "not set" });
      }
    } catch (error) {
      checks.push({ name: "Configuration", status: "FAIL", detail: error instanceof Error ? error.message : "Invalid configuration" });
    }
  }
  return { ok: checks.every(c => c.status !== "FAIL"), checks };
}
