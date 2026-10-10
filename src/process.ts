import { spawn } from "node:child_process";

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
}

export interface RunCommandOptions {
  command: string[];
  cwd: string;
  timeoutMs: number;
  maxOutputBytes?: number;
  input?: string;
  env?: NodeJS.ProcessEnv;
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

export async function runCommand(
  options: RunCommandOptions,
): Promise<CommandResult> {
  const [program, ...args] = options.command;
  if (!program) {
    throw new Error("Command cannot be empty");
  }

  const startedAt = Date.now();
  const maxOutputBytes = options.maxOutputBytes ?? 1_048_576;

  return await new Promise<CommandResult>((resolve, reject) => {
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

    child.once("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      if (forceKillTimer) {
        clearTimeout(forceKillTimer);
      }
      terminateProcessTree(child.pid, "SIGKILL");
      reject(error);
    });

    child.once("close", (exitCode) => {
      if (settled) {
        return;
      }
      settled = true;
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
        });
      }, 50);
    });

    child.stdin.end(options.input ?? "");
  });
}
