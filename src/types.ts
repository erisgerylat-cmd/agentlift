import type { ModelConfig } from "./models/config.js";
import type { EnvironmentLock } from "./evidence/environment.js";

export type Condition = "baseline" | "candidate";
export type RunOutcome =
  | "task_success"
  | "task_failure"
  | "infrastructure_failure";

export interface ExecutionFailure {
  code:
    | "spawn_error"
    | "stdin_error"
    | "timeout"
    | "output_limit"
    | "process_exit"
    | "protocol_error";
  message: string;
}

export interface McpServerConfig {
  name: string;
  transport: "stdio";
  command: string[];
  cwd: string;
  env: Record<string, string>;
}

export interface RunStartMessage {
  type: "run.start";
  runId: string;
  condition: Condition;
  workspace: string;
  task: {
    id: string;
    prompt: string;
  };
  model: Pick<ModelConfig, "name"> & Partial<Omit<ModelConfig, "name">>;
  mcpConfig: {
    servers: McpServerConfig[];
  } | null;
  skillConfig?: { name: string; path: string };
}

export interface RunEvent {
  type: string;
  [key: string]: unknown;
}

export interface ValidatorResult {
  command: string[];
  exitCode: number | null;
  success: boolean;
  durationMs: number;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  stdout: string;
  stderr: string;
  failure: ExecutionFailure | null;
}

export interface RunResult {
  runId: string;
  caseId: string;
  repeat: number;
  condition: Condition;
  outcome: RunOutcome;
  success: boolean;
  tags?: string[];
  durationMs: number;
  events: RunEvent[];
  validators: ValidatorResult[];
  runtime: {
    exitCode: number | null;
    timedOut: boolean;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
    stderr: string;
    failure: ExecutionFailure | null;
    agentStatus: "completed" | "failed" | null;
  };
}

export interface ExcludedPair {
  caseId: string;
  repeat: number;
  reasons: Array<{
    runId: string;
    condition: Condition;
    stage: "runtime" | "validator";
    validatorIndex?: number;
    failure: ExecutionFailure;
  }>;
}

export interface ImpactSummary {
  totalPairs: number;
  validPairs: number;
  excludedPairs: ExcludedPair[];
  baselineSuccesses: number;
  candidateSuccesses: number;
  infrastructureFailures: number;
  successRateDeltaPp: number | null;
  decision: "ENABLE" | "DO_NOT_ENABLE" | "INCONCLUSIVE";
}

export interface ImpactReport {
  schemaVersion: 1;
  experimentId: string;
  generatedAt: string;
  configPath: string;
  runs: RunResult[];
  summary: ImpactSummary;
  environment?: EnvironmentLock;
  policy?: {
    minimumQualityLiftPp: number;
    maximumCostIncreasePct: number;
  };
  evidenceDir?: string;
}
