import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

import { modelConfigSchema } from "./models/config.js";
import { RESERVED_ENV } from "./security.js";

const commandSchema = z.array(z.string().min(1)).min(1);
const envNameSchema = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/u)
  .refine(name => !RESERVED_ENV.test(name), "Cannot override isolation environment");

const impactConfigSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("extension-impact"),
    subject: z
      .object({
        runner: z
          .object({
            protocol: z.enum(["jsonl", "claude-code"]),
            command: commandSchema,
            cwd: z.string().optional(),
            allowedTools: z.array(z.string().min(1)).optional(),
          })
          .strict(),
        model: modelConfigSchema,
      })
      .strict(),
    candidate: z.discriminatedUnion("type", [
      z.object({
        type: z.literal("mcp"),
        name: z.string().min(1).default("candidate"),
        transport: z.literal("stdio"),
        command: commandSchema,
        cwd: z.string().optional(),
        envAllowlist: z.array(envNameSchema).default([]),
      })
      .strict(),
      z.object({
        type: z.literal("skill"),
        name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u).max(64),
        path: z.string().min(1),
        cwd: z.string().optional(),
        envAllowlist: z.array(envNameSchema).length(0).default([]),
      }).strict(),
    ]),
    suite: z
      .object({
        file: z.string().min(1),
      })
      .strict(),
    execution: z
      .object({
        repeats: z.number().int().min(1).max(100).default(1),
        order: z.literal("ab-ba-balanced").default("ab-ba-balanced"),
        timeoutMs: z.number().int().min(100).default(30_000),
        maxRuns: z.number().int().min(2).max(10000).default(1000),
        seed: z.number().int().min(0).max(4294967295).default(42),
      })
      .strict()
      .default({
        repeats: 1,
        order: "ab-ba-balanced",
        timeoutMs: 30_000,
        maxRuns: 1000,
        seed: 42,
      }),
    decision: z.object({
      minimumQualityLiftPp: z.number().min(0).max(100).default(0),
      maximumCostIncreasePct: z.number().min(0).default(20),
    }).strict().default({ minimumQualityLiftPp: 0, maximumCostIncreasePct: 20 }),
    security: z
      .object({
        envAllowlist: z.array(envNameSchema).default([]),
        maxOutputBytes: z
          .number()
          .int()
          .min(1_024)
          .max(100 * 1_024 * 1_024)
          .default(1_048_576),
        network: z.literal("inherit").default("inherit"),
      })
      .strict()
      .default({
        envAllowlist: [],
        maxOutputBytes: 1_048_576,
        network: "inherit",
      }),
    storage: z
      .object({
        capture: z.enum(["metadata", "redacted", "full"]).default("redacted"),
        output: z.string().min(1).default(".agentlift"),
      })
      .strict()
      .default({
        capture: "redacted",
        output: ".agentlift",
      }),
  })
  .strict();

const taskSuiteSchema = z
  .object({
    version: z.literal(1),
    cases: z
      .array(
        z
          .object({
            id: z
              .string()
              .regex(
                /^[A-Za-z0-9][A-Za-z0-9._-]*$/u,
                "Case id may contain only letters, numbers, dots, underscores, and hyphens",
              ),
            task: z.string().min(1),
            tags: z.array(z.string().min(1)).default([]),
            fixture: z
              .object({
                path: z.string().min(1),
              })
              .strict(),
            validators: z
              .array(
                z
                  .object({
                    type: z.literal("command"),
                    command: commandSchema,
                  })
                  .strict(),
              )
              .min(1),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();

type ParsedImpactConfig = z.infer<typeof impactConfigSchema>;
type ParsedTaskSuite = z.infer<typeof taskSuiteSchema>;

export interface LoadedImpactConfig
  extends Omit<ParsedImpactConfig, "subject" | "candidate"> {
  configPath: string;
  configDir: string;
  subject: {
    runner: ParsedImpactConfig["subject"]["runner"] & { cwd: string };
    model: ParsedImpactConfig["subject"]["model"];
  };
  candidate: ParsedImpactConfig["candidate"] & { cwd: string };
  suitePath: string;
  outputDir: string;
}

export interface LoadedTaskSuite {
  cases: Array<
    ParsedTaskSuite["cases"][number] & {
      fixture: {
        path: string;
      };
    }
  >;
}

export async function loadImpactConfig(
  configFile: string,
): Promise<LoadedImpactConfig> {
  const configPath = path.resolve(configFile);
  const configDir = path.dirname(configPath);
  const parsed = impactConfigSchema.parse(
    parseYaml(await readFile(configPath, "utf8")),
  );
  envNameSchema.parse(parsed.subject.model.baseUrlEnv);
  envNameSchema.parse(parsed.subject.model.apiKeyEnv);
  const claude = parsed.subject.runner.protocol === "claude-code";
  if (claude !== (parsed.subject.model.provider === "claude-code")) {
    throw new Error("Claude Code runner and model provider must be configured together");
  }
  if (parsed.candidate.type === "skill" && !claude) {
    throw new Error("Skill candidates require the Claude Code runner");
  }
  if (!claude && parsed.subject.runner.allowedTools !== undefined) {
    throw new Error("allowedTools is only supported by the Claude Code runner");
  }

  return {
    ...parsed,
    configPath,
    configDir,
    subject: {
      ...parsed.subject,
      runner: {
        ...parsed.subject.runner,
        cwd: path.resolve(configDir, parsed.subject.runner.cwd ?? "."),
      },
    },
    candidate: {
      ...parsed.candidate,
      cwd: path.resolve(configDir, parsed.candidate.cwd ?? "."),
      ...(parsed.candidate.type === "skill"
        ? { path: path.resolve(configDir, parsed.candidate.path) } : {}),
    },
    suitePath: path.resolve(configDir, parsed.suite.file),
    outputDir: path.resolve(configDir, parsed.storage.output),
  };
}

export async function loadTaskSuite(
  suiteFile: string,
): Promise<LoadedTaskSuite> {
  const suitePath = path.resolve(suiteFile);
  const suiteDir = path.dirname(suitePath);
  const source = await readFile(suitePath, "utf8");
  const data = suitePath.endsWith(".jsonl")
    ? {
        version: 1,
        cases: source.split(/\r?\n/u).filter(line => line.trim()).map((line, index) => {
          try { return JSON.parse(line); }
          catch { throw new Error(`Invalid task JSONL at line ${index + 1}`); }
        }),
      }
    : parseYaml(source);
  const parsed = taskSuiteSchema.parse(data);
  const caseIds = new Set<string>();
  for (const testCase of parsed.cases) {
    if (caseIds.has(testCase.id)) {
      throw new Error(`Duplicate case id: ${testCase.id}`);
    }
    caseIds.add(testCase.id);
  }

  return {
    cases: parsed.cases.map((testCase) => ({
      ...testCase,
      fixture: {
        path: path.resolve(suiteDir, testCase.fixture.path),
      },
    })),
  };
}
