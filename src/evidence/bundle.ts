import { mkdir, readFile, writeFile, rename, stat } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { digest } from "./environment.js";
import { summarizeImpact } from "../analysis/summary.js";
import { analyzeReport, renderReport } from "../analysis/report.js";
import type { ImpactReport } from "../types.js";
import { assertSafeFixture } from "../security.js";

const failure = z.object({ code: z.string(), message: z.string() }).nullable();
const reportSchema = z.object({
  schemaVersion: z.literal(1), experimentId: z.string(), generatedAt: z.string(),
  configPath: z.string(),
  runs: z.array(z.object({
    runId: z.string(), caseId: z.string(), repeat: z.number().int().positive(),
    condition: z.enum(["baseline", "candidate"]),
    outcome: z.enum(["task_success", "task_failure", "infrastructure_failure"]),
    success: z.boolean(), durationMs: z.number().nonnegative(),
    events: z.array(z.object({ type: z.string() }).passthrough()),
    validators: z.array(z.object({
      failure, success: z.boolean(), exitCode: z.number().nullable(),
      durationMs: z.number().nonnegative(), command: z.array(z.string()),
      timedOut: z.boolean(), stdoutTruncated: z.boolean(), stderrTruncated: z.boolean(),
      stdout: z.string(), stderr: z.string(),
    })),
    runtime: z.object({
      failure, agentStatus: z.enum(["completed", "failed"]).nullable(),
      exitCode: z.number().nullable(), timedOut: z.boolean(),
      stdoutTruncated: z.boolean(), stderrTruncated: z.boolean(), stderr: z.string(),
    }),
  }).passthrough()).min(2),
}).passthrough();

export async function saveBundle(
  report: ImpactReport, output: string, spec: unknown, suite: unknown,
): Promise<void> {
  const directory = path.join(output, report.experimentId);
  await mkdir(output, { recursive: true });
  await assertSafeFixture(output);
  await mkdir(directory); // Never overwrite a previous experiment.
  report.evidenceDir = directory;
  report.summary.decision = analyzeReport(report).decision;
  const files: Record<string, string> = {
    "experiment.json": JSON.stringify(spec, null, 2),
    "tasks.json": JSON.stringify(suite, null, 2),
    "environment.lock": JSON.stringify(report.environment, null, 2),
    "results.json": JSON.stringify(report, null, 2),
    "analysis.json": JSON.stringify(analyzeReport(report), null, 2),
    "report.md": renderReport(report, true).trimEnd(),
    "traces.jsonl": report.runs.flatMap(run =>
      run.events.map(event => JSON.stringify({ runId: run.runId, event }))).join("\n"),
  };
  if (report.environment?.adapters.runtime === "claude-code@1") {
    files["artifacts.json"] = JSON.stringify(report.runs.map(run => ({
      runId: run.runId, caseId: run.caseId, condition: run.condition,
      changes: run.events.filter(event => event.type === "file.change"),
      answers: run.events.filter(event => event.type === "agent.result"),
    })), null, 2);
  }
  const hashes: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    const bytes = `${content}\n`;
    await writeFile(path.join(directory, name), bytes, { flag: "wx", mode: 0o600 });
    hashes[name] = digest(bytes);
  }
  await writeFile(path.join(directory, "checksums.json"), JSON.stringify(hashes, null, 2));
  // Compatibility pointers update atomically; independent experiment directories remain intact.
  const temporary = path.join(output, `${report.experimentId}.latest`);
  await writeFile(temporary, files["results.json"]! + "\n", { mode: 0o600 });
  await rename(temporary, path.join(output, "results.json"));
  await writeFile(path.join(output, "latest.json"), JSON.stringify({ directory: report.experimentId }));
}

export async function loadReport(input: string): Promise<ImpactReport> {
  let file = path.resolve(input);
  if ((await stat(file)).isDirectory()) file = path.join(file, "results.json");
  const raw = await readFile(file, "utf8");
  if (Buffer.byteLength(raw) > 100 * 1024 * 1024) throw new Error("Evidence exceeds 100 MiB");
  const report = reportSchema.parse(JSON.parse(raw)) as unknown as ImpactReport;
  let manifest: string | undefined;
  try { manifest = await readFile(path.join(path.dirname(file), "checksums.json"), "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (manifest) {
    const hashes = z.record(z.string(), z.string().regex(/^[a-f0-9]{64}$/u)).parse(JSON.parse(manifest));
    if (!hashes["results.json"]) throw new Error("Evidence checksum manifest is incomplete");
    for (const [name, hash] of Object.entries(hashes)) {
      if (path.basename(name) !== name || name === "." || name === "..") throw new Error("Invalid artifact path");
      if (digest(await readFile(path.join(path.dirname(file), name))) !== hash) {
        throw new Error(`Evidence checksum mismatch: ${name}`);
      }
    }
  }
  for (const run of report.runs) {
    if (run.success !== (run.outcome === "task_success")) throw new Error("Inconsistent run outcome");
  }
  // Recompute instead of trusting stale or edited summary fields.
  report.summary = summarizeImpact(report.runs);
  report.summary.decision = analyzeReport(report).decision;
  return report;
}
