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

function parseEvents(stdout: string, allowTrailingPartial: boolean): RunEvent[] {
  const lines = stdout.split(/\r?\n/u);
  if (allowTrailingPartial && !stdout.endsWith("\n")) {
    lines.pop();
  }

  return lines
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(`Runner emitted invalid JSONL at line ${index + 1}`);
      }

      if (
        typeof value !== "object" ||
        value === null ||
        typeof (value as { type?: unknown }).type !== "string"
      ) {
        throw new Error(`Runner event ${index + 1} is missing a string type`);
      }

      return value as RunEvent;
    });
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
    });

    return {
      exitCode: result.exitCode,
      durationMs: result.durationMs,
      timedOut: result.timedOut,
      stdoutTruncated: result.stdoutTruncated,
      stderrTruncated: result.stderrTruncated,
      stderr: result.stderr,
      events: parseEvents(result.stdout, result.stdoutTruncated),
    };
  }
}
