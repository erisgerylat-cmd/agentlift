import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { summarizeImpact } from "./analysis/summary.js";
import {
  loadImpactConfig,
  loadTaskSuite,
  type LoadedImpactConfig,
  type LoadedTaskSuite,
} from "./config.js";
import type { ExtensionAdapter } from "./extensions/extension-adapter.js";
import { StdioMcpExtension } from "./extensions/stdio-mcp.js";
import { runCommand } from "./process.js";
import { GenericCommandRuntime } from "./runtimes/generic-command.js";
import type {
  RuntimeAdapter,
  RuntimeExecution,
} from "./runtimes/runtime-adapter.js";
import {
  assertPathWithin,
  assertSafeFixture,
  createIsolatedEnvironment,
  environmentValues,
  redactSecrets,
} from "./security.js";
import type {
  Condition,
  ImpactReport,
  RunEvent,
  RunOutcome,
  RunResult,
  RunStartMessage,
  ValidatorResult,
} from "./types.js";

export function conditionOrderForRepeat(
  repeat: number,
): readonly [Condition, Condition] {
  return repeat % 2 === 1
    ? ["baseline", "candidate"]
    : ["candidate", "baseline"];
}

async function runValidators(
  commands: string[][],
  workspace: string,
  timeoutMs: number,
  maxOutputBytes: number,
  env: NodeJS.ProcessEnv,
  secretValues: string[],
): Promise<ValidatorResult[]> {
  const results: ValidatorResult[] = [];

  for (const command of commands) {
    const result = await runCommand({
      command,
      cwd: workspace,
      timeoutMs,
      maxOutputBytes,
      env,
    });
    // A validator's numeric nonzero exit is a deterministic rejection.
    // Signals and transport/resource failures invalidate the experiment pair.
    const failure =
      result.failure?.code === "process_exit" && result.exitCode !== null
        ? null
        : result.failure;

    results.push(
      redactSecrets(
        {
          command,
          exitCode: result.exitCode,
          success: result.exitCode === 0 && failure === null,
          durationMs: result.durationMs,
          timedOut: result.timedOut,
          stdoutTruncated: result.stdoutTruncated,
          stderrTruncated: result.stderrTruncated,
          stdout: result.stdout,
          stderr: result.stderr,
          failure,
        },
        secretValues,
      ),
    );
  }

  return results;
}

function normalizedEvents(
  message: RunStartMessage,
  runtimeEvents: RunEvent[],
  validators: ValidatorResult[],
  outcome: RunOutcome,
  runtime: RuntimeExecution,
): RunEvent[] {
  const body = runtimeEvents.filter(
    (event) =>
      event.type !== "run.start" &&
      event.type !== "validation" &&
      event.type !== "run.end",
  );
  const validationEvents: RunEvent[] = validators.map((validator) => ({
    type: "validation",
    validator: "command",
    command: validator.command,
    success: validator.success,
    exitCode: validator.exitCode,
    durationMs: validator.durationMs,
    timedOut: validator.timedOut,
    stdoutTruncated: validator.stdoutTruncated,
    stderrTruncated: validator.stderrTruncated,
    failure: validator.failure,
  }));
  if (runtime.failure) {
    validationEvents.push({
      type: "validation",
      status: "skipped",
      reason: "runtime_infrastructure_failure",
    });
  }

  return [
    {
      type: "run.start",
      runId: message.runId,
      condition: message.condition,
      caseId: message.task.id,
    },
    ...body,
    ...validationEvents,
    {
      type: "run.end",
      status: outcome === "task_success" ? "completed" : "failed",
      outcome,
      runtimeExitCode: runtime.exitCode,
      timedOut: runtime.timedOut,
      stdoutTruncated: runtime.stdoutTruncated,
      stderrTruncated: runtime.stderrTruncated,
      failure: runtime.failure,
      agentStatus: runtime.agentStatus,
    },
  ];
}

function classifyOutcome(
  runtime: RuntimeExecution,
  validators: ValidatorResult[],
): RunOutcome {
  if (runtime.failure || validators.some((validator) => validator.failure)) {
    return "infrastructure_failure";
  }
  return runtime.agentStatus === "completed" &&
    validators.every((validator) => validator.success)
    ? "task_success"
    : "task_failure";
}

async function executeRun(
  config: LoadedImpactConfig,
  testCase: LoadedTaskSuite["cases"][number],
  condition: Condition,
  repeat: number,
  experimentId: string,
  workspaceRoot: string,
  runtime: RuntimeAdapter,
  extension: ExtensionAdapter,
  secretValues: string[],
): Promise<RunResult> {
  const runId = `${experimentId.slice(0, 8)}-${testCase.id}-${repeat}-${condition}`;
  const workspace = path.join(workspaceRoot, runId);
  const stateRoot = path.join(workspaceRoot, "runtime", runId);
  assertPathWithin(workspaceRoot, workspace);
  assertPathWithin(workspaceRoot, stateRoot);
  await assertSafeFixture(testCase.fixture.path);
  await cp(testCase.fixture.path, workspace, {
    recursive: true,
    errorOnExist: true,
  });
  await assertSafeFixture(workspace);

  const env = await createIsolatedEnvironment(stateRoot, [
    ...config.security.envAllowlist,
    config.subject.model.baseUrlEnv,
    config.subject.model.apiKeyEnv,
  ]);
  const mcpConfig =
    condition === "candidate"
      ? await extension.enable()
      : await extension.disable();

  const message: RunStartMessage = {
    type: "run.start",
    runId,
    condition,
    workspace,
    task: {
      id: testCase.id,
      prompt: testCase.task,
    },
    model: config.subject.model,
    mcpConfig,
  };

  const runtimeResult = await runtime.run({
    message,
    env,
  });
  const validators = runtimeResult.failure
    ? []
    : await runValidators(
        testCase.validators.map((validator) => validator.command),
        workspace,
        config.execution.timeoutMs,
        config.security.maxOutputBytes,
        env,
        secretValues,
      );
  const outcome = classifyOutcome(runtimeResult, validators);
  const success = outcome === "task_success";
  const events = redactSecrets(
    normalizedEvents(
      message,
      runtimeResult.events,
      validators,
      outcome,
      runtimeResult,
    ),
    secretValues,
  );

  return {
    runId,
    caseId: testCase.id,
    repeat,
    condition,
    outcome,
    success,
    durationMs:
      runtimeResult.durationMs +
      validators.reduce((total, validator) => total + validator.durationMs, 0),
    events,
    validators,
    runtime: {
      exitCode: runtimeResult.exitCode,
      timedOut: runtimeResult.timedOut,
      stdoutTruncated: runtimeResult.stdoutTruncated,
      stderrTruncated: runtimeResult.stderrTruncated,
      stderr: redactSecrets(runtimeResult.stderr, secretValues),
      failure: runtimeResult.failure,
      agentStatus: runtimeResult.agentStatus,
    },
  };
}

export async function runImpact(configFile: string): Promise<ImpactReport> {
  const config = await loadImpactConfig(configFile);
  const suite = await loadTaskSuite(config.suitePath);
  const experimentId = randomUUID();
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "agentlift-impact-"),
  );
  const runtime = new GenericCommandRuntime({
    command: config.subject.runner.command,
    cwd: config.subject.runner.cwd,
    timeoutMs: config.execution.timeoutMs,
    maxOutputBytes: config.security.maxOutputBytes,
  });
  const extension = new StdioMcpExtension({
    name: config.candidate.name,
    command: config.candidate.command,
    cwd: config.candidate.cwd,
    envAllowlist: config.candidate.envAllowlist,
  });
  const secretValues = environmentValues([
    ...config.security.envAllowlist,
    config.subject.model.baseUrlEnv,
    config.subject.model.apiKeyEnv,
    ...config.candidate.envAllowlist,
  ]);
  const runs: RunResult[] = [];
  let extensionInstalled = false;

  try {
    await extension.validate();
    await extension.install(workspaceRoot);
    extensionInstalled = true;

    for (const testCase of suite.cases) {
      for (let repeat = 1; repeat <= config.execution.repeats; repeat += 1) {
        for (const condition of conditionOrderForRepeat(repeat)) {
          runs.push(
            await executeRun(
              config,
              testCase,
              condition,
              repeat,
              experimentId,
              workspaceRoot,
              runtime,
              extension,
              secretValues,
            ),
          );
        }
      }
    }
  } finally {
    try {
      if (extensionInstalled) {
        await extension.uninstall();
      }
    } finally {
      await rm(workspaceRoot, { recursive: true, force: true });
    }
  }

  const report: ImpactReport = {
    schemaVersion: 1,
    experimentId,
    generatedAt: new Date().toISOString(),
    configPath: config.configPath,
    runs,
    summary: summarizeImpact(runs),
  };

  await mkdir(config.outputDir, { recursive: true });
  await writeFile(
    path.join(config.outputDir, "results.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  return report;
}

export function formatImpactReport(report: ImpactReport): string {
  const { summary } = report;
  const delta = summary.successRateDeltaPp === null
    ? "unavailable (no valid pairs)"
    : `${summary.successRateDeltaPp}pp`;

  return [
    "AgentLift impact smoke report",
    "",
    `Experiment: ${report.experimentId}`,
    `Pairs: ${summary.totalPairs}`,
    `Valid pairs: ${summary.validPairs}; excluded pairs: ${summary.excludedPairs.length}`,
    `Baseline: ${summary.baselineSuccesses}/${summary.validPairs} successful`,
    `Candidate: ${summary.candidateSuccesses}/${summary.validPairs} successful`,
    `Infrastructure failures: ${summary.infrastructureFailures}`,
    `Observed delta: ${delta}`,
    `Decision: ${summary.decision} (smoke run; no confidence interval yet)`,
  ].join("\n");
}
