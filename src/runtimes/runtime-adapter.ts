import type { ExecutionFailure, RunEvent, RunStartMessage } from "../types.js";

export interface RuntimeRunRequest {
  message: RunStartMessage;
  env: NodeJS.ProcessEnv;
}

export interface RuntimeExecution {
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  stderr: string;
  events: RunEvent[];
  failure: ExecutionFailure | null;
  agentStatus: "completed" | "failed" | null;
}

export interface RuntimeAdapter {
  readonly name: string;
  run(request: RuntimeRunRequest): Promise<RuntimeExecution>;
}
