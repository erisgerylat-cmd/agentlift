import { runCommand } from "../process.js";
import type { RunEvent } from "../types.js";
import type {
  RuntimeAdapter,
  RuntimeExecution,
  RuntimeRunRequest,
} from "./runtime-adapter.js";

export interface GenericCommandRuntimeOptions {
  command: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes: number;
}

function parseEvents(
  stdout: string,
  allowTrailingPartial: boolean,
): Pick<RuntimeExecution, "events" | "failure" | "agentStatus"> {
  const lines = stdout.split(/\r?\n/u);
  if (allowTrailingPartial && !stdout.endsWith("\n")) {
    lines.pop();
  }

  const events: RunEvent[] = [];
  const invalid = (message: string): ReturnType<typeof parseEvents> => ({
    events,
    agentStatus: null,
    failure: { code: "protocol_error", message },
  });

  let agentStatus: RuntimeExecution["agentStatus"] = null;
  for (const [index, line] of lines.entries()) {
    if (!line.trim()) continue;
    if (agentStatus !== null) {
      return invalid(`Runner emitted data after run.end at line ${index + 1}`);
    }
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      return invalid(`Runner emitted invalid JSONL at line ${index + 1}`);
    }

    if (
      typeof value !== "object" ||
      value === null ||
      Array.isArray(value) ||
      typeof (value as { type?: unknown }).type !== "string" ||
      (value as { type: string }).type.length === 0
    ) {
      return invalid(`Runner event at line ${index + 1} requires a nonempty type`);
    }
    const event = value as RunEvent;
    if (event.type === "run.end") {
      if (event.status !== "completed" && event.status !== "failed") {
        return invalid(`Runner run.end at line ${index + 1} has an invalid status`);
      }
      agentStatus = event.status;
    }
    events.push(event);
  }

  if (agentStatus === null) return invalid("Runner did not emit run.end");
  return { events, agentStatus, failure: null };
}

export class GenericCommandRuntime implements RuntimeAdapter {
  readonly name = "generic-command";

  constructor(private readonly options: GenericCommandRuntimeOptions) {}

  async run(request: RuntimeRunRequest): Promise<RuntimeExecution> {
    const result = await runCommand({
      command: this.options.command,
      cwd: this.options.cwd,
      timeoutMs: this.options.timeoutMs,
      maxOutputBytes: this.options.maxOutputBytes,
      input: `${JSON.stringify(request.message)}\n`,
      env: request.env,
      signal: request.signal,
    });
    const parsed = parseEvents(result.stdout, result.stdoutTruncated);

    return {
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      stderr: result.stderr,
      events: parsed.events,
      agentStatus: parsed.agentStatus,
      // Transport/process failure takes precedence over incomplete JSONL on termination.
      failure: result.failure ?? parsed.failure,
    };
  }
}
