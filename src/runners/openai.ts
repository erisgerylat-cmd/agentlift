#!/usr/bin/env node

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { modelConfigSchema } from "../models/config.js";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  OpenAICompatibleClient,
  type ChatMessage,
} from "../models/openai-compatible.js";
import { assertSafeFixture, environmentValues, redactSecrets } from "../security.js";
import type { RunEvent } from "../types.js";
import { McpTools } from "./mcp-tools.js";

const inputSchema = z.object({
  type: z.literal("run.start"),
  runId: z.string().min(1),
  condition: z.enum(["baseline", "candidate"]),
  workspace: z.string().min(1),
  task: z.object({ id: z.string(), prompt: z.string() }),
  model: modelConfigSchema,
  mcpConfig: z.object({
    servers: z.array(z.object({
      name: z.string().min(1),
      transport: z.literal("stdio"),
      command: z.array(z.string().min(1)).min(1),
      cwd: z.string(),
      env: z.record(z.string(), z.string()).default({}),
    })).length(1),
  }).nullable(),
});

async function readInput() {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > MAX_RESPONSE_BYTES) throw new Error("Runner input exceeded the byte limit");
    chunks.push(buffer);
  }
  return inputSchema.parse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
}

async function main(): Promise<void> {
  const input = await readInput();
  if ((input.condition === "baseline") !== (input.mcpConfig === null)) {
    throw new Error("MCP configuration does not match experiment condition");
  }
  const model = new OpenAICompatibleClient(input.model);
  const server = input.mcpConfig?.servers[0];
  const secrets = [
    ...environmentValues([input.model.apiKeyEnv, input.model.baseUrlEnv]),
    ...Object.values(server?.env ?? {}).filter(Boolean),
  ];
  const emit = (event: RunEvent) => {
    process.stdout.write(`${JSON.stringify(redactSecrets(event, secrets))}\n`);
  };
  const tools = server
    ? new McpTools(server, input.model.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS, emit)
    : null;

  emit({ type: "run.start", runId: input.runId, condition: input.condition });
  try {
    await assertSafeFixture(input.workspace);
    if (tools) await tools.connect();
    const messages: ChatMessage[] = [
      {
        role: "system",
        content: "Complete the user's task using the available tools when useful. " +
          "Return only the final answer text. It will be saved as result.txt for validation.",
      },
      { role: "user", content: input.task.prompt },
    ];
    const maxTurns = input.model.maxTurns ?? 8;
    for (let turn = 1; turn <= maxTurns; turn += 1) {
      const response = await model.complete(messages, tools?.tools ?? []);
      // Provider-reported counts only; absent usage remains unavailable.
      emit({
        type: "model.usage",
        turn,
        model: response.model ?? input.model.name,
        inputTokens: response.usage?.prompt_tokens ?? null,
        outputTokens: response.usage?.completion_tokens ?? null,
        totalTokens: response.usage?.total_tokens ?? null,
      });
      messages.push(response.message);
      const calls = response.message.tool_calls ?? [];
      if (calls.length === 0) {
        await assertSafeFixture(input.workspace);
        // Never follow a fixture/MCP-created result symlink or overwrite an existing artifact.
        await writeFile(
          path.join(input.workspace, "result.txt"),
          `${response.message.content!.trimEnd()}\n`,
          { flag: "wx", mode: 0o600 },
        );
        emit({ type: "run.end", status: "completed" });
        return;
      }
      for (const call of calls) {
        if (!tools) throw new Error("Model called a tool in baseline mode");
        const content = await tools.call(call.function.name, call.function.arguments, call.id);
        messages.push({ role: "tool", tool_call_id: call.id, content });
      }
    }
    emit({ type: "run.end", status: "failed", reason: "max_turns" });
  } finally {
    await tools?.close();
  }
}

// Keep provider responses, prompts and credentials out of fatal diagnostics.
main().catch(() => {
  process.stderr.write("Reference runner failed: check model configuration, response and MCP availability.\n");
  process.exitCode = 1;
});
