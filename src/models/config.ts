import { z } from "zod";

export const modelConfigSchema = z.object({
  provider: z.literal("openai-compatible"),
  baseUrlEnv: z.string().min(1),
  apiKeyEnv: z.string().min(1),
  name: z.string().min(1),
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(1).max(128_000).optional(),
  maxTurns: z.number().int().min(1).max(32).optional(),
  requestTimeoutMs: z.number().int().min(100).max(300_000).optional(),
}).strict();

export type ModelConfig = z.infer<typeof modelConfigSchema>;
