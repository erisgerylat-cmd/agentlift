export type Condition = "baseline" | "candidate";
export type RunOutcome =
  | "task_success"
  | "task_failure"
  | "infrastructure_failure";

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
  model: {
    name: string;
  };
  mcpConfig: {
    servers: McpServerConfig[];
  } | null;
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
}

export interface RunResult {
  runId: string;
  caseId: string;
  repeat: number;
  condition: Condition;
  outcome: RunOutcome;
  success: boolean;
  durationMs: number;
  events: RunEvent[];
  validators: ValidatorResult[];
  runtime: {
    exitCode: number | null;
    timedOut: boolean;
    stdoutTruncated: boolean;
    stderrTruncated: boolean;
    stderr: string;
  };
}

export interface ImpactSummary {
  totalPairs: number;
  baselineSuccesses: number;
  candidateSuccesses: number;
  infrastructureFailures: number;
  successRateDeltaPp: number;
  decision: "INCONCLUSIVE";
}

export interface ImpactReport {
  schemaVersion: 1;
  experimentId: string;
  generatedAt: string;
  configPath: string;
  runs: RunResult[];
  summary: ImpactSummary;
}
