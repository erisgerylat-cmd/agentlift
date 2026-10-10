import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { formatImpactReport, runImpact } from "../src/impact.js";
import { runCommand } from "../src/process.js";

// Behaviors exercise the JSONL boundary through actual child processes.
const runner = `
const fs = require("node:fs");
const m = JSON.parse(fs.readFileSync(0, "utf8"));
const emit = (event) => console.log(JSON.stringify(event));
emit({ type: "run.start", runId: m.runId });
emit({ type: "probe", workspace: m.workspace });
if (m.condition === "candidate") {
  switch (m.task.prompt) {
    case "invalid-json": console.log("not JSON"); return;
    case "missing-end": return;
    case "duplicate-end":
      emit({ type: "run.end", status: "completed" }); break;
    case "invalid-status": emit({ type: "run.end", status: "unknown" }); return;
    case "exit-error": process.exitCode = 7; return;
    case "overflow": console.log("x".repeat(4096)); return;
    case "timeout": setInterval(() => {}, 1000); return;
  }
}
emit({
  type: "run.end",
  status: m.task.prompt === "agent-failed" ||
    (m.task.prompt === "improved" && m.condition === "baseline")
    ? "failed" : "completed",
});
`;

async function experiment(
  cases: string[],
  options: { command?: string[]; validator?: string[]; repeats?: number } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentlift-failure-test-"));
  const fixture = path.join(root, "fixture");
  await mkdir(fixture);
  await writeFile(path.join(root, "tasks.yaml"), JSON.stringify({
    version: 1,
    cases: cases.map((id) => ({
      id,
      task: id,
      fixture: { path: fixture },
      validators: [{
        type: "command",
        command: options.validator ?? [process.execPath, "-e", "void 0"],
      }],
    })),
  }));
  const config = path.join(root, "agentlift.yaml");
  await writeFile(config, JSON.stringify({
    version: 1,
    kind: "extension-impact",
    subject: {
      runner: {
        protocol: "jsonl",
        command: options.command ?? [process.execPath, "-e", `(function(){${runner}})()`],
      },
      model: {
        provider: "openai-compatible",
        baseUrlEnv: "FAKE_MODEL_BASE_URL",
        apiKeyEnv: "FAKE_MODEL_API_KEY",
        name: "test",
      },
    },
    candidate: { type: "mcp", transport: "stdio", command: [process.execPath] },
    suite: { file: "./tasks.yaml" },
    execution: { repeats: options.repeats ?? 1, timeoutMs: 1000 },
    security: { maxOutputBytes: 1024 },
    storage: { output: "./results" },
  }));
  return { root, config };
}

test("retains failure evidence, continues later cases and excludes whole invalid pairs", async () => {
  const failures = {
    "invalid-json": "protocol_error",
    "missing-end": "protocol_error",
    "duplicate-end": "protocol_error",
    "invalid-status": "protocol_error",
    "exit-error": "process_exit",
    overflow: "output_limit",
    timeout: "timeout",
  };
  const { root, config } = await experiment([
    ...Object.keys(failures), "agent-failed", "improved", "after",
  ]);
  try {
    const report = await runImpact(config);
    assert.equal(report.runs.length, 20);
    for (const [caseId, code] of Object.entries(failures)) {
      const run = report.runs.find(r => r.caseId === caseId && r.condition === "candidate")!;
      assert.equal(run.outcome, "infrastructure_failure");
      assert.equal(run.runtime.failure?.code, code);
      assert.deepEqual(run.validators, []);
      assert.equal(run.events.at(-2)?.status, "skipped");
      assert.equal(run.events.at(-1)?.outcome, run.outcome);
    }
    const failed = report.runs.filter(r => r.caseId === "agent-failed");
    assert(failed.every(r => r.outcome === "task_failure"));
    assert(failed.every(r => r.validators.every(v => v.success)));
    assert(report.runs.filter(r => r.caseId === "after").every(r => r.success));
    assert.equal(report.summary.totalPairs, 10);
    assert.equal(report.summary.validPairs, 3);
    assert.equal(report.summary.excludedPairs.length, 7);
    assert.equal(report.summary.infrastructureFailures, 7);
    assert.equal(report.summary.baselineSuccesses, 1);
    assert.equal(report.summary.candidateSuccesses, 2);
    assert.equal(report.summary.successRateDeltaPp, 33.33);
    assert(report.summary.excludedPairs.every(p =>
      p.reasons.length === 1 && p.reasons[0]?.condition === "candidate"));
    assert.match(formatImpactReport(report), /Baseline: 1\/3 successful/);
    assert.deepEqual(
      JSON.parse(await readFile(path.join(root, "results/results.json"), "utf8")),
      report,
    );
    for (const run of report.runs) {
      const workspace = run.events.find(e => e.type === "probe")?.workspace;
      if (typeof workspace === "string") await assert.rejects(access(workspace), { code: "ENOENT" });
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("missing executable produces a report with null delta and no valid pairs", async () => {
  const { root, config } = await experiment(["first", "later"], {
    command: ["/agentlift-test-nonexistent/runner"],
    repeats: 2,
  });
  try {
    const report = await runImpact(config);
    assert.equal(report.runs.length, 8);
    assert(report.runs.every(r => r.runtime.failure?.code === "spawn_error"));
    assert.equal(report.summary.validPairs, 0);
    assert.equal(report.summary.excludedPairs.length, 4);
    assert.equal(report.summary.successRateDeltaPp, null);
    assert.match(formatImpactReport(report), /Observed delta: unavailable/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("validator spawn errors are infrastructure failures, nonzero exits are task failures", async () => {
  for (const command of [
    ["/agentlift-test-nonexistent/validator"],
    [process.execPath, "-e", "process.exitCode = 1"],
  ]) {
    const { root, config } = await experiment(["after"], { validator: command });
    try {
      const report = await runImpact(config);
      const missing = command.length === 1;
      assert(report.runs.every(r =>
        r.outcome === (missing ? "infrastructure_failure" : "task_failure")));
      assert.equal(report.summary.validPairs, missing ? 0 : 1);
      assert.equal(report.summary.successRateDeltaPp, missing ? null : 0);
      if (missing) {
        assert.equal(report.summary.excludedPairs[0]?.reasons[0]?.stage, "validator");
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("duplicate case ids are rejected before any task executes", async () => {
  const { root, config } = await experiment(["same", "same"]);
  try {
    await assert.rejects(runImpact(config), /Duplicate case id: same/);
    await assert.rejects(access(path.join(root, "results")), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("early input closure yields evidence instead of an unhandled EPIPE", async () => {
  const result = await runCommand({
    command: [process.execPath, "-e", "process.exit(0)"],
    input: "x".repeat(8 * 1024 * 1024),
    cwd: os.tmpdir(),
    timeoutMs: 5000,
  });
  assert.equal(result.failure?.code, "stdin_error");
});

test("validator timeouts, signals and stderr overflow invalidate pairs", async () => {
  const behaviors = [
    { script: "setInterval(() => {}, 1000)", code: "timeout" },
    { script: "process.kill(process.pid, 'SIGTERM')", code: "process_exit" },
    { script: "process.stderr.write('x'.repeat(4096))", code: "output_limit" },
  ];
  for (const { script, code } of behaviors) {
    const { root, config } = await experiment(["after"], {
      validator: [process.execPath, "-e", script],
    });
    try {
      const report = await runImpact(config);
      assert.equal(report.summary.validPairs, 0);
      assert.equal(report.summary.infrastructureFailures, 2);
      for (const run of report.runs) {
        assert.equal(run.validators[0]?.failure?.code, code);
        assert.deepEqual(run.events.at(-2)?.failure, run.validators[0]?.failure);
      }
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("CLI persists the report before exiting nonzero on infrastructure failures", async () => {
  const { root, config } = await experiment(["after"], {
    command: ["/agentlift-test-nonexistent/runner"],
  });
  try {
    const result = await runCommand({
      command: [
        process.execPath,
        "--import",
        "tsx",
        fileURLToPath(new URL("../src/cli.ts", import.meta.url)),
        "impact",
        "--config",
        config,
      ],
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      timeoutMs: 10000,
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.stdout, /Infrastructure failures: 2/);
    const report = JSON.parse(await readFile(path.join(root, "results/results.json"), "utf8"));
    assert.equal(report.summary.successRateDeltaPp, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
