import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

function emit(event) {
  process.stdout.write(`${JSON.stringify(event)}\n`);
}

async function readStartMessage() {
  const input = readline.createInterface({
    input: process.stdin,
    crlfDelay: Infinity,
  });

  for await (const line of input) {
    if (line.trim()) {
      input.close();
      return JSON.parse(line);
    }
  }

  throw new Error("Missing run.start message");
}

async function withMcp(server, prompt) {
  const [program, ...args] = server.command;
  const child = spawn(program, args, {
    cwd: server.cwd,
    env: {
      ...process.env,
      ...server.env,
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
  const responses = readline.createInterface({
    input: child.stdout,
    crlfDelay: Infinity,
  });
  const pending = new Map();
  let nextId = 1;

  responses.on("line", (line) => {
    const response = JSON.parse(line);
    const waiter = pending.get(response.id);
    if (!waiter) {
      return;
    }
    pending.delete(response.id);
    if (response.error) {
      waiter.reject(new Error(response.error.message));
    } else {
      waiter.resolve(response.result);
    }
  });

  function request(method, params) {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      child.stdin.write(
        `${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`,
      );
    });
  }

  try {
    const initialized = await request("initialize", {
      protocolVersion: "2025-11-25",
      capabilities: {},
      clientInfo: {
        name: "agentlift-fake-agent",
        version: "0.0.0",
      },
    });
    if (!initialized.protocolVersion) {
      throw new Error("MCP initialize response is missing protocolVersion");
    }
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: "2.0",
        method: "notifications/initialized",
      })}\n`,
    );

    const listed = await request("tools/list", {});
    if (!listed.tools.some((tool) => tool.name === "review_code")) {
      throw new Error("MCP server did not expose review_code");
    }
    emit({
      type: "tool.call",
      server: server.name,
      name: "review_code",
      arguments: { prompt },
    });
    const result = await request("tools/call", {
      name: "review_code",
      arguments: { prompt },
    });
    emit({
      type: "tool.result",
      server: server.name,
      name: "review_code",
      status: "ok",
    });
    return result.content[0].text;
  } finally {
    child.kill("SIGTERM");
    responses.close();
  }
}

async function main() {
  const message = await readStartMessage();
  emit({
    type: "run.start",
    runId: message.runId,
    condition: message.condition,
  });

  const isFormattingControl = message.task.prompt
    .toLowerCase()
    .includes("formatting");
  let output;

  if (isFormattingControl) {
    output = "FORMAT_OK";
  } else if (message.mcpConfig?.servers?.length) {
    output = await withMcp(
      message.mcpConfig.servers[0],
      message.task.prompt,
    );
  } else {
    output = "NO_FINDING";
  }

  const outputPath = path.join(message.workspace, "result.txt");
  await writeFile(outputPath, `${output}\n`);
  emit({
    type: "run.end",
    status: "completed",
  });
}

main().catch((error) => {
  emit({
    type: "run.end",
    status: "failed",
  });
  process.stderr.write(`${error.stack ?? error.message}\n`);
  process.exitCode = 1;
});
