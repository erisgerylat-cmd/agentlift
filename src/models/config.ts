import { z } from "zod";

export const modelConfigSchema = z.object({
  provider: z.enum(["openai-compatible", "claude-code"]),
  baseUrlEnv: z.string().min(1).default("ANTHROPIC_BASE_URL"),
  apiKeyEnv: z.string().min(1).default("ANTHROPIC_API_KEY"),
  name: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(128_000).optional(),
  maxTurns: z.number().int().min(1).max(32).optional(),
  requestTimeoutMs: z.number().int().min(100).max(300_000).optional(),
  inputPricePerMillion: z.number().nonnegative().optional(),
  outputPricePerMillion: z.number().nonnegative().optional(),
}).strict().superRefine((model, context) => {
  if (model.provider === "claude-code" &&
      (model.temperature !== undefined || model.maxTokens !== undefined ||
       model.requestTimeoutMs !== undefined)) {
    context.addIssue({ code: "custom", message: "Claude Code does not support temperature, maxTokens or requestTimeoutMs overrides" });
  }
});

export type ModelConfig = z.infer<typeof modelConfigSchema>;
