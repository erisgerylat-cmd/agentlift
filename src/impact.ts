import { randomUUID } from "node:crypto";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

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
import type { RuntimeAdapter } from "./runtimes/runtime-adapter.js";
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

    results.push(
      redactSecrets(
        {
          command,
          exitCode: result.exitCode,
          success:
            result.exitCode === 0 &&
            !result.timedOut &&
            !result.stdoutTruncated &&
            !result.stderrTruncated,
          durationMs: result.durationMs,
          timedOut: result.timedOut,
          stdoutTruncated: result.stdoutTruncated,
          stderrTruncated: result.stderrTruncated,
          stdout: result.stdout,
          stderr: result.stderr,
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
  runtime: {
    exitCode: number | null;
    timedOut: boolean;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  },
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
  }));

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
    },
  ];
}

function classifyOutcome(
  runtime: {
    exitCode: number | null;
    timedOut: boolean;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
  },
  validators: ValidatorResult[],
): RunOutcome {
  const runtimeFailed =
    runtime.exitCode !== 0 ||
    runtime.timedOut ||
    runtime.stdoutTruncated ||
    runtime.stderrTruncated;
  const validatorInfrastructureFailed = validators.some(
    (validator) =>
      validator.exitCode === null ||
      validator.timedOut ||
      validator.stdoutTruncated ||
      validator.stderrTruncated,
  );
  if (runtimeFailed || validatorInfrastructureFailed) {
    return "infrastructure_failure";
  }
  return validators.every((validator) => validator.success)
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
    model: {
      name: config.subject.model.name,
    },
    mcpConfig,
  };

  const runtimeResult = await runtime.run({
    message,
    env,
  });
  const validators = await runValidators(
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
    normalizedEvents(message, runtimeResult.events, validators, outcome, {
      exitCode: runtimeResult.exitCode,
      timedOut: runtimeResult.timedOut,
      stdoutTruncated: runtimeResult.stdoutTruncated,
      stderrTruncated: runtimeResult.stderrTruncated,
    }),
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
    },
  };
}

function summarize(runs: RunResult[]): ImpactReport["summary"] {
  const baseline = runs.filter((run) => run.condition === "baseline");
  const candidate = runs.filter((run) => run.condition === "candidate");
  const baselineSuccesses = baseline.filter((run) => run.success).length;
  const candidateSuccesses = candidate.filter((run) => run.success).length;
  const infrastructureFailures = runs.filter(
    (run) => run.outcome === "infrastructure_failure",
  ).length;
  const baselineRate =
    baseline.length === 0 ? 0 : baselineSuccesses / baseline.length;
  const candidateRate =
    candidate.length === 0 ? 0 : candidateSuccesses / candidate.length;

  return {
    totalPairs: Math.min(baseline.length, candidate.length),
    baselineSuccesses,
    candidateSuccesses,
    infrastructureFailures,
    successRateDeltaPp: Number(
      ((candidateRate - baselineRate) * 100).toFixed(2),
    ),
    decision: "INCONCLUSIVE",
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
    summary: summarize(runs),
  };

  await mkdir(config.outputDir, { recursive: true });
  await writeFile(
    path.join(config.outputDir, "results.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  return report;
}

export function formatImpactReport(report: ImpactReport): string {
  const baselineTotal = report.runs.filter(
    (run) => run.condition === "baseline",
  ).length;
  const candidateTotal = report.runs.filter(
    (run) => run.condition === "candidate",
  ).length;

  return [
    "AgentLift impact smoke report",
    "",
    `Experiment: ${report.experimentId}`,
    `Pairs: ${report.summary.totalPairs}`,
    `Baseline: ${report.summary.baselineSuccesses}/${baselineTotal} successful`,
    `Candidate: ${report.summary.candidateSuccesses}/${candidateTotal} successful`,
    `Infrastructure failures: ${report.summary.infrastructureFailures}`,
    `Observed delta: ${report.summary.successRateDeltaPp}pp`,
    `Decision: ${report.summary.decision} (smoke run; no confidence interval yet)`,
  ].join("\n");
}
