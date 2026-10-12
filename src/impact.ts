import { randomUUID } from "node:crypto";
import { access, cp, mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { summarizeImpact } from "./analysis/summary.js";
import { renderReport } from "./analysis/report.js";
import { fixtureDigest, lockEnvironment } from "./evidence/environment.js";
import { saveBundle } from "./evidence/bundle.js";
import {
  loadImpactConfig,
  loadTaskSuite,
  type LoadedImpactConfig,
  type LoadedTaskSuite,
} from "./config.js";
import type { ExtensionAdapter } from "./extensions/extension-adapter.js";
import { StdioMcpExtension } from "./extensions/stdio-mcp.js";
import { ClaudeSkillExtension } from "./extensions/claude-skill.js";
import { ClaudeCodeRuntime } from "./runtimes/claude-code.js";
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
  signal?: AbortSignal,
): Promise<ValidatorResult[]> {
  const results: ValidatorResult[] = [];

  for (const command of commands) {
    const result = await runCommand({
      command,
      cwd: workspace,
      timeoutMs,
      maxOutputBytes,
      env,
      signal,
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
  signal?: AbortSignal,
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
  if (config.subject.runner.protocol === "claude-code") {
    for (const entry of [".claude", ".mcp.json", ".claude.json", "CLAUDE.md", "CLAUDE.local.md"]) {
      const exists = await access(path.join(workspace, entry)).then(() => true, () => false);
      if (exists) throw new Error(`Claude Code fixture must not contain pre-existing ${entry}`);
    }
  }
  const skillConfig = extension instanceof ClaudeSkillExtension
    ? await extension.prepare(workspace, condition) : undefined;

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
    ...(skillConfig ? { skillConfig } : {}),
  };

  const runtimeResult = await runtime.run({
    message,
    env,
    signal,
  });
  signal?.throwIfAborted();
  const validators = runtimeResult.failure
    ? []
    : await runValidators(
        testCase.validators.map((validator) => validator.command),
        workspace,
        config.execution.timeoutMs,
        config.security.maxOutputBytes,
        env,
        secretValues,
        signal,
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
    tags: testCase.tags,
    ...(testCase.extensionExpected === undefined ? {} : { extensionExpected: testCase.extensionExpected }),
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

export async function runImpact(
  configFile: string, options: { signal?: AbortSignal } = {},
): Promise<ImpactReport> {
  options.signal?.throwIfAborted();
  const config = await loadImpactConfig(configFile);
  const suite = await loadTaskSuite(config.suitePath);
  if (suite.cases.length * config.execution.repeats * 2 > config.execution.maxRuns) {
    throw new Error("Planned runs exceed execution.maxRuns");
  }
  for (const testCase of suite.cases) {
    const relative = path.relative(testCase.fixture.path, config.outputDir);
    if (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)) {
      throw new Error("Output directory must not be inside a fixture");
    }
  }
  const environment = await lockEnvironment(config, suite);
  const experimentId = randomUUID();
  const workspaceRoot = await mkdtemp(
    path.join(os.tmpdir(), "agentlift-impact-"),
  );
  const Runtime = config.subject.runner.protocol === "claude-code" ? ClaudeCodeRuntime : GenericCommandRuntime;
  const runtime = new Runtime({
    command: config.subject.runner.command,
    cwd: config.subject.runner.cwd,
    timeoutMs: config.execution.timeoutMs,
    maxOutputBytes: config.security.maxOutputBytes,
    allowedTools: config.subject.runner.allowedTools,
    tools: config.subject.runner.tools,
    resultMode: config.subject.runner.resultMode,
  });
  const extension = config.candidate.type === "skill"
    ? new ClaudeSkillExtension(config.candidate)
    : new StdioMcpExtension(config.candidate);
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
    if (config.candidate.type === "skill" &&
        await fixtureDigest(config.candidate.path) !== environment.skill?.digest) {
      throw new Error("Skill changed before experiment installation");
    }
    await extension.install(workspaceRoot);
    extensionInstalled = true;

    // Freeze each fixture once. Both conditions always copy the same snapshot.
    const snapshots = path.join(workspaceRoot, "snapshots");
    await mkdir(snapshots);
    for (const testCase of suite.cases) {
      const snapshot = path.join(snapshots, testCase.id);
      await cp(testCase.fixture.path, snapshot, { recursive: true });
      if (await fixtureDigest(snapshot) !== environment.fixtures[testCase.id]) {
        throw new Error("Fixture changed during snapshot creation");
      }
    }
    for (const testCase of suite.cases) {
      for (let repeat = 1; repeat <= config.execution.repeats; repeat += 1) {
        for (const condition of conditionOrderForRepeat(repeat)) {
          options.signal?.throwIfAborted();
          runs.push(
            await executeRun(
              config,
              { ...testCase, fixture: { path: path.join(snapshots, testCase.id) } },
              condition,
              repeat,
              experimentId,
              workspaceRoot,
              runtime,
              extension,
              secretValues,
              options.signal,
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

  options.signal?.throwIfAborted();
  for (const testCase of suite.cases) {
    if (await fixtureDigest(testCase.fixture.path) !== environment.fixtures[testCase.id]) {
      throw new Error("Original fixture changed during experiment; results are invalid");
    }
  }
  if (config.candidate.type === "skill" &&
      await fixtureDigest(config.candidate.path) !== environment.skill?.digest) {
    throw new Error("Original skill changed during experiment; results are invalid");
  }
  const versions = runs.flatMap(run => run.events
    .filter(event => event.type === "agent.init" && typeof event.version === "string")
    .map(event => event.version as string));
  environment.agent.version = versions.length ? [...new Set(versions)].join(",") : null;
  environment.model.resolvedVersions = [...new Set(runs.flatMap(run =>
    run.events.filter(event => ["model.usage", "agent.model"].includes(event.type) && typeof event.model === "string")
      .map(event => event.model as string)))].sort();
  environment.observations.modelDrift = environment.model.resolvedVersions.length > 1
    ? "detected" : "not-observed";
  const report: ImpactReport = {
    schemaVersion: 1,
    experimentId,
    generatedAt: new Date().toISOString(),
    configPath: config.configPath,
    runs,
    summary: summarizeImpact(runs),
    environment,
    policy: config.decision,
  };
  // Metadata capture retains comparison metrics, but strips prompts, arguments and logs.
  if (config.storage.capture === "metadata") {
    for (const run of report.runs) {
      run.runtime.stderr = "";
      for (const validator of run.validators) {
        validator.stdout = ""; validator.stderr = ""; validator.command = [];
      }
      run.events = run.events.map(event => Object.fromEntries(Object.entries(event).filter(
        ([key]) => ["type", "name", "server", "status", "callId", "model", "turn",
          "inputTokens", "outputTokens", "totalTokens", "costUSD", "path", "beforeHash",
          "afterHash", "bytes", "count"].includes(key),
      )) as RunEvent);
    }
  }
  Object.assign(report, redactSecrets(report, secretValues));
  await saveBundle(
    report, config.outputDir,
    redactSecrets(config, secretValues),
    config.storage.capture === "metadata"
      ? { cases: suite.cases.map(c => ({ id: c.id, tags: c.tags })) }
      : redactSecrets(suite, secretValues),
  );

  return report;
}

export function formatImpactReport(report: ImpactReport): string {
  return renderReport(report);
}
