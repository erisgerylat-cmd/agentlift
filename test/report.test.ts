import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";

import { analyzeReport, median, renderReport, wilson } from "../src/analysis/report.js";
import { compareReports, evaluateGate } from "../src/analysis/commands.js";
import { runImpact } from "../src/impact.js";
import { summarizeImpact } from "../src/analysis/summary.js";
import { runCommand } from "../src/process.js";
import type { ImpactReport, RunResult } from "../src/types.js";

function synthetic(cases: number, reverse = false): ImpactReport {
  const runs: RunResult[] = [];
  for (let i = 0; i < cases; i++) for (const repeat of [1, 2]) {
    for (const condition of ["baseline", "candidate"] as const) {
      const success = (condition === "candidate") !== reverse;
      runs.push({
        runId: `${i}-${repeat}-${condition}`, caseId: `case-${i}`, repeat, condition,
        outcome: success ? "task_success" : "task_failure", success, durationMs: 100,
        validators: [], runtime: {
          failure: null, agentStatus: "completed", exitCode: 0, timedOut: false,
          stdoutTruncated: false, stderrTruncated: false, stderr: "",
        },
        events: [{ type: "model.usage", inputTokens: 10, outputTokens: 10, totalTokens: 20 }],
      });
    }
  }
  return { schemaVersion: 1, experimentId: "synthetic", generatedAt: "test", configPath: "test",
    runs, summary: summarizeImpact(runs),
    environment: {
      schemaVersion: 1, node: process.version, os: { platform: process.platform, release: "test", arch: process.arch },
      git: { commit: null, status: null },
      agent: { command: [], cwd: "", files: {}, version: null },
      mcp: { command: [], cwd: "", files: {}, version: null },
      model: { provider: "openai-compatible", baseUrlEnv: "URL", apiKeyEnv: "KEY", name: "test",
        resolvedVersions: ["test"], inputPricePerMillion: 1, outputPricePerMillion: 1 },
      experimentSpecHash: "test", taskSuiteHash: "test", fixtures: {}, comparisonKey: "same",
      adapters: { runtime: "generic-command@1", extension: "stdio-mcp@1" },
      repeats: 2, seed: 42, isolation: "process-only", network: "inherit", environmentNames: [],
      observations: { cache: "unknown", rateLimits: "unknown", modelDrift: "not-observed" },
    } };
}

test("statistics are reproducible and decisions require independent cases and cost data", () => {
  assert.equal(median([3, 1, 2, 4]), 2.5);
  assert.equal(wilson(0, 0), null);
  const interval = wilson(5, 10)!;
  assert(Math.abs(interval[0] - 23.66) < 0.01);
  assert.equal(analyzeReport(synthetic(1)).decision, "INCONCLUSIVE");
  const report = synthetic(10);
  const a = analyzeReport(report);
  assert.deepEqual(a, analyzeReport(report));
  assert.equal(a.decision, "ENABLE");
  assert.equal(analyzeReport(synthetic(10, true)).decision, "DO_NOT_ENABLE");
  delete report.environment!.model.inputPricePerMillion;
  assert.equal(analyzeReport(report).decision, "INCONCLUSIVE");
  assert.equal(evaluateGate(report, { maxCostIncreasePct: 20 }).exitCode, 2);
  assert.equal(evaluateGate(report, { minSuccessDeltaPp: 0 }).exitCode, 0);
  assert.equal(evaluateGate(synthetic(10, true), { minSuccessDeltaPp: -5 }).exitCode, 1);
  const other = synthetic(10);
  assert.equal(compareReports(report, other).liftChangePp, 0);
  other.environment!.comparisonKey = "different";
  assert.throws(() => compareReports(report, other), /incomparable/);
});

test("CLI doctor, impact evidence, offline report, compare and CI form a complete workflow", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentlift-workflow-test-"));
  const cli = (...args: string[]) => runCommand({
    command: [process.execPath, "--import", "tsx", path.resolve("src/cli.ts"), ...args],
    cwd: process.cwd(), timeoutMs: 20000,
  });
  try {
    const config = parse(await readFile("examples/agentlift.yaml", "utf8"));
    config.subject.runner.cwd = path.resolve("examples");
    config.candidate.cwd = path.resolve("examples");
    config.suite.file = path.resolve("examples/tasks.yaml");
    config.storage.output = path.join(root, "output");
    config.execution.repeats = 1;
    const file = path.join(root, "config.yaml");
    await writeFile(file, JSON.stringify(config));
    const diagnostic = await cli("doctor", "--config", file, "--json");
    assert.equal(diagnostic.exitCode, 0, diagnostic.stderr);
    const impact = await cli("impact", "--config", file, "--json");
    assert.equal(impact.exitCode, 0, impact.stderr);
    const result: ImpactReport = JSON.parse(impact.stdout);
    assert(result.evidenceDir);
    assert.equal(await readFile(path.join(result.evidenceDir!, "report.md"), "utf8"), renderReport(result, true));
    const rebuilt = await cli("report", result.evidenceDir!);
    assert.equal(rebuilt.exitCode, 0);
    assert.equal(rebuilt.stdout, renderReport(result, true));
    const compare = await cli("compare", result.evidenceDir!, result.evidenceDir!);
    assert.equal(JSON.parse(compare.stdout).liftChangePp, 0);
    assert.equal((await cli("ci", "--evidence", result.evidenceDir!, "--min-success-delta-pp=0")).exitCode, 0);
    assert.equal((await cli("ci", "--evidence", result.evidenceDir!, "--min-success-delta-pp=60")).exitCode, 1);
    assert.equal((await cli("ci", "--evidence", result.evidenceDir!, "--max-cost-increase-pct=20")).exitCode, 2);
    assert.equal((await cli("ci", "--evidence", result.evidenceDir!, "--max-tool-error-rate=NaN")).exitCode, 2);
    assert.equal((await cli("compare", result.evidenceDir!)).exitCode, 1);
  } finally { await rm(root, { recursive: true, force: true }); }
});
