import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { Ajv } from "ajv";

import type { ChatTool } from "../models/openai-compatible.js";
import { MAX_RESPONSE_BYTES } from "../models/openai-compatible.js";
import type { McpServerConfig, RunEvent } from "../types.js";

const MAX_TOOLS = 128;
const MAX_TOOL_PAGES = 16;

// Inherit only runtime directories/search paths; model credentials stay in the Agent.
function mcpEnvironment(extra: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const name of [
    "HOME", "PATH", "TMPDIR", "TMP", "TEMP",
    "XDG_CONFIG_HOME", "XDG_CACHE_HOME", "XDG_DATA_HOME",
    "SystemRoot", "ComSpec", "PATHEXT",
  ]) {
    if (process.env[name] !== undefined) env[name] = process.env[name]!;
  }
  return { ...env, ...extra };
}

export class McpTools {
  readonly tools: ChatTool[] = [];
  private readonly client = new Client({ name: "agentlift-reference-runner", version: "0.0.0" });
  private readonly transport: StdioClientTransport;
  private stderrBytes = 0;
  private readonly aliases = new Map<string, {
    name: string;
    validate: (input: unknown) => boolean | Promise<unknown>;
  }>();

  constructor(
    private readonly server: McpServerConfig,
    private readonly timeout: number,
    private readonly emit: (event: RunEvent) => void,
  ) {
    this.transport = new StdioClientTransport({
      command: server.command[0]!,
      args: server.command.slice(1),
      cwd: server.cwd,
      env: mcpEnvironment(server.env),
      stderr: "pipe",
      maxBufferSize: MAX_RESPONSE_BYTES,
    });
    // Bound and drain diagnostics without exposing credential-bearing server messages.
    this.transport.stderr?.on("data", (chunk: Buffer) => {
      this.stderrBytes += chunk.length;
      if (this.stderrBytes > MAX_RESPONSE_BYTES) {
        void this.transport.close().catch(() => {});
      }
    });
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport, { timeout: this.timeout });
    const ajv = new Ajv({ strict: false, allErrors: false, logger: false });
    const names = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_TOOL_PAGES; page += 1) {
      const result = await this.client.listTools({ cursor }, { timeout: this.timeout });
      if (this.stderrBytes > MAX_RESPONSE_BYTES) throw new Error("MCP stderr limit exceeded");
      for (const tool of result.tools) {
        if (names.has(tool.name) || this.tools.length >= MAX_TOOLS) {
          throw new Error("MCP tool list contains duplicate names or exceeds its limit");
        }
        names.add(tool.name);
        // Aliases avoid OpenAI function-name restrictions on valid MCP names.
        const alias = `mcp_${this.tools.length}`;
        if (tool.inputSchema.$async) throw new Error("Async tool schemas are unsupported");
        const validate = ajv.compile(tool.inputSchema);
        this.aliases.set(alias, { name: tool.name, validate });
        this.tools.push({
          type: "function",
          function: {
            name: alias,
            description: tool.description,
            parameters: tool.inputSchema,
          },
        });
      }
      if (!result.nextCursor) return;
      if (cursors.has(result.nextCursor)) throw new Error("MCP pagination repeated a cursor");
      cursors.add(result.nextCursor);
      cursor = result.nextCursor;
    }
    throw new Error("MCP tool pagination exceeded its limit");
  }

  async call(alias: string, rawArguments: string, callId: string): Promise<string> {
    if (this.stderrBytes > MAX_RESPONSE_BYTES) throw new Error("MCP stderr limit exceeded");
    const tool = this.aliases.get(alias);
    let args: unknown;
    try { args = JSON.parse(rawArguments); } catch { args = undefined; }
    this.emit({
      type: "tool.call", server: this.server.name, name: tool?.name ?? alias,
      callId, arguments: args ?? null,
    });
    let result: unknown;
    let status = "error";
    if (!tool) {
      result = { isError: true, content: [{ type: "text", text: "Unknown tool name" }] };
    } else if (!args || typeof args !== "object" || Array.isArray(args) ||
               tool.validate(args) !== true) {
      result = { isError: true, content: [{ type: "text", text: "Invalid tool arguments" }] };
    } else {
      // JSON-RPC/transport errors propagate; a tool's isError result may be recovered by the model.
      try {
        const response = await this.client.callTool(
          { name: tool.name, arguments: args as Record<string, unknown> },
          undefined,
          { timeout: this.timeout },
        );
        result = response;
        status = response.isError ? "error" : "ok";
      } catch {
        this.emit({
          type: "tool.result", server: this.server.name, name: tool.name,
          callId, status: "error", reason: "mcp_request_failed",
        });
        throw new Error("MCP tool request failed");
      }
      if (this.stderrBytes > MAX_RESPONSE_BYTES) throw new Error("MCP stderr limit exceeded");
    }
    const content = JSON.stringify(result);
    if (Buffer.byteLength(content) > MAX_RESPONSE_BYTES) {
      throw new Error("MCP tool result exceeded the byte limit");
    }
    this.emit({
      type: "tool.result", server: this.server.name, name: tool?.name ?? alias,
      callId, status, result,
    });
    return content;
  }

  async close(): Promise<void> {
    await this.client.close();
    await this.transport.close();
  }
}
