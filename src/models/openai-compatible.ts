import { z } from "zod";

import type { ModelConfig } from "./config.js";

export const MAX_RESPONSE_BYTES = 1_048_576;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

const toolCallSchema = z.object({
  id: z.string().min(1),
  type: z.literal("function"),
  function: z.object({
    name: z.string().min(1),
    arguments: z.string(),
  }),
});

const completionSchema = z.object({
  model: z.string().optional(),
  choices: z.array(z.object({
    finish_reason: z.string().nullable(),
    message: z.object({
      role: z.literal("assistant"),
      content: z.string().nullable().optional(),
      tool_calls: z.array(toolCallSchema).max(32).optional(),
    }),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().nonnegative().optional(),
    completion_tokens: z.number().int().nonnegative().optional(),
    total_tokens: z.number().int().nonnegative().optional(),
  }).optional(),
});

export type ToolCall = z.infer<typeof toolCallSchema>;
export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content?: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ChatTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters: Record<string, unknown>;
  };
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("Model response has no body");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_RESPONSE_BYTES) {
        throw new Error("Model response exceeded the byte limit");
      }
      chunks.push(value);
    }
    try {
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
      throw new Error("Model returned invalid JSON");
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export class OpenAICompatibleClient {
  private readonly endpoint: URL;
  private readonly apiKey: string;

  constructor(private readonly config: ModelConfig) {
    const baseUrl = process.env[config.baseUrlEnv];
    const apiKey = process.env[config.apiKeyEnv];
    if (!baseUrl || !apiKey) {
      throw new Error("Model base URL or API key environment variable is missing");
    }
    const url = new URL(baseUrl);
    if (!["http:", "https:"].includes(url.protocol) ||
        url.username || url.password || url.search || url.hash) {
      throw new Error("Model base URL must be HTTP(S), without credentials, query or fragment");
    }
    url.pathname = `${url.pathname.replace(/\/+$/u, "")}/chat/completions`;
    this.endpoint = url;
    this.apiKey = apiKey;
  }

  async complete(messages: ChatMessage[], tools: ChatTool[]) {
    const body = JSON.stringify({
      model: this.config.name,
      messages,
      stream: false,
      temperature: this.config.temperature,
      max_tokens: this.config.maxTokens ?? 2048,
      ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
    });
    if (Buffer.byteLength(body) > 4 * MAX_RESPONSE_BYTES) {
      throw new Error("Model conversation exceeded the request byte limit");
    }
    const signal = AbortSignal.timeout(
      this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    );
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        // Do not forward credentials to redirected hosts or retry billed requests.
        redirect: "error",
        signal,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body,
      });
    } catch {
      throw new Error(signal.aborted ? "Model request timed out" : "Model request failed");
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`Model HTTP request failed with status ${response.status}`);
    }
    let value: unknown;
    try {
      value = await readResponse(response);
    } catch {
      throw new Error(signal.aborted
        ? "Model response timed out"
        : "Model response is unreadable, invalid or exceeds the byte limit");
    }
    const parsed = completionSchema.safeParse(value);
    if (!parsed.success) throw new Error("Model response does not match Chat Completions");
    const completion = parsed.data;
    const choice = completion.choices[0]!;
    const calls = choice.message.tool_calls ?? [];
    if (choice.finish_reason === "tool_calls" && calls.length > 0) {
      if (new Set(calls.map(call => call.id)).size !== calls.length) {
        throw new Error("Model returned duplicate tool call IDs");
      }
    } else if (choice.finish_reason !== "stop" ||
               calls.length > 0 || typeof choice.message.content !== "string") {
      throw new Error("Model response did not finish with text or tool calls");
    }
    return { message: choice.message, model: completion.model, usage: completion.usage };
  }
}
