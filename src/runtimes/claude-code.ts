import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

import { runCommand } from "../process.js";
import { assertSafeFixture } from "../security.js";
import { workspaceChanges, workspaceManifest } from "../evidence/workspace.js";
import type { RunEvent } from "../types.js";
import type { RuntimeAdapter, RuntimeExecution, RuntimeRunRequest } from "./runtime-adapter.js";

const envelope = z.object({ type: z.string().min(1) }).passthrough();
const terminal = z.object({
  type: z.literal("result"),
  subtype: z.string(),
  is_error: z.boolean(),
  result: z.string().optional(),
  total_cost_usd: z.number().nonnegative().optional(),
  usage: z.object({
    input_tokens: z.number().int().nonnegative().optional(),
    output_tokens: z.number().int().nonnegative().optional(),
    cache_creation_input_tokens: z.number().int().nonnegative().optional(),
    cache_read_input_tokens: z.number().int().nonnegative().optional(),
  }).optional(),
}).passthrough();

export function parseClaudeOutput(stdout: string, partial = false, events: RunEvent[] = []) {
  let end: z.infer<typeof terminal> | null = null;
  let version: string | null = null;
  const lines = stdout.split(/\r?\n/u);
  if (partial && !stdout.endsWith("\n")) lines.pop();
  for (const line of lines.filter(line => line.trim())) {
    if (end) throw new Error("Claude Code emitted data after result");
    const event = envelope.parse(JSON.parse(line));
    if (event.type === "system" && event.subtype === "init") {
      version = typeof event.claude_code_version === "string" ? event.claude_code_version : null;
      events.push({ type: "agent.init", version, model: event.model,
        tools: event.tools, skills: event.skills, mcpServers: event.mcp_servers });
      const servers = event.mcp_servers;
      if (Array.isArray(servers) && servers.some(server =>
        typeof server === "object" && server !== null && server.status !== "connected")) {
        throw new Error("Claude Code MCP server did not connect");
      }
    }
    if (event.type === "assistant" || event.type === "user") {
      const message = event.message as { content?: unknown; model?: unknown } | undefined;
      if (Array.isArray(message?.content)) for (const block of message.content) {
        if (!block || typeof block !== "object") continue;
        if (block.type === "tool_use") {
          events.push({ type: "tool.call", name: block.name, callId: block.id, arguments: block.input });
          if (block.name === "Skill") events.push({
            type: "skill.activation", name: block.input?.skill,
            callId: block.id, evidence: "tool_use",
          });
        } else if (block.type === "tool_result") {
          events.push({ type: "tool.result", callId: block.tool_use_id,
            status: block.is_error ? "error" : "ok", result: block.content });
        }
      }
      // An assistant model ID is evidence of the resolved model, not token usage.
      if (typeof message?.model === "string") events.push({
        type: "agent.model", model: message.model,
      });
    }
    if (event.type === "result") {
      end = terminal.parse(event);
      const usage = end.usage;
      const inputTokens = usage?.input_tokens === undefined ? null :
        usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0);
      const outputTokens = usage?.output_tokens ?? null;
      events.push({ type: "model.usage", inputTokens, outputTokens,
        totalTokens: inputTokens === null || outputTokens === null ? null : inputTokens + outputTokens,
        costUSD: end.total_cost_usd ?? null, source: "claude-code-result",
        cacheReadTokens: usage?.cache_read_input_tokens ?? null,
        cacheCreationTokens: usage?.cache_creation_input_tokens ?? null });
    }
  }
  if (!end) throw new Error("Claude Code did not emit a result");
  events.push({ type: "agent.result", status: end.subtype, text: end.result ?? null });
  if (Array.isArray(end.permission_denials) && end.permission_denials.length) {
    events.push({ type: "permission.denied", count: end.permission_denials.length });
  }
  if (end.subtype === "success" && !end.is_error && typeof end.result !== "string") {
    throw new Error("Claude Code success result requires text");
  }
  // API/authentication/runtime errors are infrastructure failures; turn limits are task failures.
  if (end.is_error && !["error_max_turns", "error_max_budget_usd"].includes(end.subtype)) {
    throw new Error("Claude Code returned an execution error");
  }
  return { events, end, version };
}

export class ClaudeCodeRuntime implements RuntimeAdapter {
  readonly name = "claude-code";
  constructor(private readonly options: {
    command: string[]; cwd: string; timeoutMs: number; maxOutputBytes: number;
    allowedTools?: string[];
    tools?: string[];
    resultMode?: "text" | "workspace";
  }) {}

  async run(request: RuntimeRunRequest): Promise<RuntimeExecution> {
    const { message, env } = request;
    const state = path.dirname(env.HOME!);
    const configDir = path.join(state, "claude");
    await mkdir(configDir, { recursive: true });
    const source = path.join(state, "mcp-source.json");
    const mcpFile = path.join(state, "mcp.json");
    const servers = message.mcpConfig?.servers ?? [];
    const before = await workspaceManifest(message.workspace);
    await writeFile(source, JSON.stringify(servers), { mode: 0o600, flag: "wx" });
    const development = import.meta.url.endsWith(".ts");
    const launcher = fileURLToPath(new URL(`../runners/mcp-launch.${development ? "ts" : "js"}`, import.meta.url));
    const launchArgs = development ? ["--import", import.meta.resolve("tsx"), launcher] : [launcher];
    await writeFile(mcpFile, JSON.stringify({ mcpServers: Object.fromEntries(servers.map((server, i) => [
      server.name, { type: "stdio", command: process.execPath, args: [...launchArgs, source, String(i)] },
    ])) }), { mode: 0o600, flag: "wx" });
    const program = this.options.command[0]!;
    const command = [
      program.includes("/") || program.includes("\\") ? path.resolve(this.options.cwd, program) : program,
      ...this.options.command.slice(1).map(arg => arg.startsWith(".") ? path.resolve(this.options.cwd, arg) : arg),
      "-p", "--output-format", "stream-json", "--verbose",
      "--model", message.model.name, "--max-turns", String(message.model.maxTurns ?? 8),
      "--setting-sources", "", "--settings", '{"disableAllHooks":true,"disableBundledSkills":true}',
      "--strict-mcp-config", "--mcp-config", mcpFile, "--no-session-persistence",
      "--permission-mode", "dontAsk",
      "--tools", (this.options.tools ?? ["Read", "Glob", "Grep", "Skill"]).join(","),
      "--allowedTools", [...(this.options.allowedTools ?? ["Read", "Glob", "Grep", "Skill"]),
        ...servers.map(server => `mcp__${server.name}__*`)].join(","),
      "--append-system-prompt",
      this.options.resultMode === "workspace"
        ? "Complete the task by editing files in this workspace. Return a short final explanation."
        : "Return your final answer as plain text. AgentLift saves it as result.txt. Do not write result.txt yourself.",
    ];
    const result = await runCommand({
      command, cwd: message.workspace, env: { ...env, CLAUDE_CONFIG_DIR: configDir,
        CLAUDE_CODE_DISABLE_AUTO_MEMORY: "1",
        ...(message.model.apiKeyEnv && env[message.model.apiKeyEnv]
          ? { ANTHROPIC_API_KEY: env[message.model.apiKeyEnv] } : {}),
        ...(message.model.baseUrlEnv && env[message.model.baseUrlEnv]
          ? { ANTHROPIC_BASE_URL: env[message.model.baseUrlEnv] } : {}),
      },
      input: message.task.prompt + "\n", timeoutMs: this.options.timeoutMs,
      maxOutputBytes: this.options.maxOutputBytes, signal: request.signal,
    });
    let events: RunEvent[] = [];
    let agentStatus: RuntimeExecution["agentStatus"] = null;
    let failure = result.failure;
    try {
      const parsed = parseClaudeOutput(result.stdout, result.stdoutTruncated, events);
      events = parsed.events;
      agentStatus = parsed.end.subtype === "success" && !parsed.end.is_error ? "completed" : "failed";
      if (parsed.end.is_error && ["error_max_turns", "error_max_budget_usd"].includes(parsed.end.subtype) &&
          failure?.code === "process_exit" && result.exitCode !== null) {
        failure = null;
      }
      if (!failure && agentStatus === "completed" && this.options.resultMode !== "workspace") {
        await assertSafeFixture(message.workspace);
        await writeFile(path.join(message.workspace, "result.txt"), parsed.end.result!.trimEnd() + "\n",
          { flag: "wx", mode: 0o600 });
      }
    } catch {
      failure ??= { code: "protocol_error",
        message: "Claude Code output, MCP connection or result artifact is invalid; check CLI compatibility and authentication" };
    }
    try {
      events.push(...workspaceChanges(before, await workspaceManifest(message.workspace)));
    } catch {
      failure ??= { code: "protocol_error", message: "Claude workspace contains unsafe or unreadable artifacts" };
    }
    return { ...result, events, agentStatus, failure };
  }
}
