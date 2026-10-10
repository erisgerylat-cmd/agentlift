import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse as parseYaml } from "yaml";
import { z } from "zod";

const commandSchema = z.array(z.string().min(1)).min(1);

const impactConfigSchema = z
  .object({
    version: z.literal(1),
    kind: z.literal("extension-impact"),
    subject: z
      .object({
        runner: z
          .object({
            protocol: z.literal("jsonl"),
            command: commandSchema,
            cwd: z.string().optional(),
          })
          .strict(),
        model: z
          .object({
            provider: z.literal("openai-compatible"),
            baseUrlEnv: z.string().min(1),
            apiKeyEnv: z.string().min(1),
            name: z.string().min(1),
          })
          .strict(),
      })
      .strict(),
    candidate: z
      .object({
        type: z.literal("mcp"),
        name: z.string().min(1).default("candidate"),
        transport: z.literal("stdio"),
        command: commandSchema,
        cwd: z.string().optional(),
        envAllowlist: z.array(z.string().min(1)).default([]),
      })
      .strict(),
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
      })
      .strict()
      .default({
        repeats: 1,
        order: "ab-ba-balanced",
        timeoutMs: 30_000,
      }),
    security: z
      .object({
        envAllowlist: z.array(z.string().min(1)).default([]),
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
  const parsed = taskSuiteSchema.parse(
    parseYaml(await readFile(suitePath, "utf8")),
  );

  return {
    cases: parsed.cases.map((testCase) => ({
      ...testCase,
      fixture: {
        path: path.resolve(suiteDir, testCase.fixture.path),
      },
    })),
  };
}
