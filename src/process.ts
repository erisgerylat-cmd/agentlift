import { spawn } from "node:child_process";

import type { ExecutionFailure } from "./types.js";

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
  failure: ExecutionFailure | null;
}

export interface RunCommandOptions {
  command: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes?: number;
  input?: string;
  env?: NodeJS.ProcessEnv;
  signal?: AbortSignal;
}

function terminateProcessTree(pid: number | undefined, signal: NodeJS.Signals) {
  if (pid === undefined) {
    return;
  }

  try {
    if (process.platform === "win32") {
      process.kill(pid, signal);
    } else {
      process.kill(-pid, signal);
    }
  } catch {
    // The process may already have exited.
  }
}

function commandFailure(
  exitCode: number | null,
  signal: NodeJS.Signals | null,
  timedOut: boolean,
  outputExceeded: boolean,
): ExecutionFailure | null {
  if (outputExceeded) {
    return { code: "output_limit", message: "Command output exceeded the byte limit" };
  }
  if (timedOut) {
    return { code: "timeout", message: "Command exceeded its time limit" };
  }
  if (exitCode !== 0) {
    return {
      code: "process_exit",
      message: signal
        ? `Command terminated by ${signal}`
        : `Command exited with code ${exitCode}`,
    };
  }
  return null;
}

export async function runCommand(
  options: RunCommandOptions,
): Promise<CommandResult> {
  const [program, ...args] = options.command;
  if (!program) {
    throw new Error("Command cannot be empty");
  }

  const startedAt = Date.now();
  options.signal?.throwIfAborted();
  const maxOutputBytes = options.maxOutputBytes ?? 1_048_576;

  return await new Promise<CommandResult>((resolve) => {
    const child = spawn(program, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      detached: process.platform !== "win32",
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let failure: ExecutionFailure | null = null;
    let terminationStarted = false;
    let settled = false;
    let forceKillTimer: NodeJS.Timeout | undefined;

    const terminate = () => {
      if (terminationStarted) {
        return;
      }
      terminationStarted = true;
      terminateProcessTree(child.pid, "SIGTERM");
      forceKillTimer = setTimeout(() => {
        terminateProcessTree(child.pid, "SIGKILL");
      }, 500);
    };
    const abort = () => {
      failure = { code: "process_exit", message: "Command interrupted" };
      terminate();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();

    const appendOutput = (
      current: string,
      chunk: string,
      bytes: number,
      markTruncated: () => void,
    ): { text: string; bytes: number } => {
      const chunkBytes = Buffer.byteLength(chunk);
      const remaining = Math.max(0, maxOutputBytes - bytes);
      if (chunkBytes <= remaining) {
        return {
          text: current + chunk,
          bytes: bytes + chunkBytes,
        };
      }

      markTruncated();
      terminate();
      return {
        text:
          current +
          Buffer.from(chunk, "utf8").subarray(0, remaining).toString("utf8"),
        bytes: maxOutputBytes,
      };
    };

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      const appended = appendOutput(stdout, chunk, stdoutBytes, () => {
        stdoutTruncated = true;
      });
      stdout = appended.text;
      stdoutBytes = appended.bytes;
    });
    child.stderr.on("data", (chunk: string) => {
      const appended = appendOutput(stderr, chunk, stderrBytes, () => {
        stderrTruncated = true;
      });
      stderr = appended.text;
      stderrBytes = appended.bytes;
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      terminate();
    }, options.timeoutMs);

    child.once("error", () => {
      // Do not include command arguments or environment values in diagnostics.
      failure = { code: "spawn_error", message: "Unable to start command" };
      terminateProcessTree(child.pid, "SIGKILL");
    });

    child.stdin.on("error", () => {
      if (settled || terminationStarted || failure) return;
      failure = { code: "stdin_error", message: "Unable to deliver command input" };
      terminate();
    });

    child.once("close", (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      options.signal?.removeEventListener("abort", abort);
      clearTimeout(timeout);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      terminateProcessTree(child.pid, "SIGTERM");
      setTimeout(() => {
        terminateProcessTree(child.pid, "SIGKILL");
        resolve({
          exitCode,
          stdout,
          stderr,
          durationMs: Date.now() - startedAt,
          timedOut,
          stdoutTruncated,
          stderrTruncated,
          failure: failure ?? commandFailure(
            exitCode,
            signal,
            timedOut,
            stdoutTruncated || stderrTruncated,
          ),
        });
      }, 50);
    });

    child.stdin.end(options.input ?? "");
  });
}
