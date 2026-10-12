#!/usr/bin/env node

import { parseArgs } from "node:util";
import { writeFile } from "node:fs/promises";
import { formatImpactReport, runImpact } from "./impact.js";
import { loadReport } from "./evidence/bundle.js";
import { analyzeReport, renderReport } from "./analysis/report.js";
import { compareReports, evaluateGate } from "./analysis/commands.js";
import { doctor } from "./doctor.js";
import { runWorkflow } from "./workflow.js";

function printUsage() {
  process.stdout.write(`AgentLift

Usage:
  agentlift doctor [--config <file>] [--json]
  agentlift impact --config <file> [--json]
  agentlift workflow --config <file> [--before <evidence>] [--json]
  agentlift report <evidence-dir-or-results.json> [--json] [--output <file>]
  agentlift compare <before> <after> [--json]
  agentlift ci --evidence <path> [--min-success-delta-pp=-5]
               [--max-cost-increase-pct=20] [--max-tool-error-rate=0.05]
               [--max-regressions=0] [--json]
               [--min-activation-rate=1] [--max-false-activation-rate=0]

CI exit codes: 0 PASS, 1 FAIL, 2 unavailable/invalid input.
workflow accepts the same gate thresholds as ci.
impact executes trusted external commands with host permissions.
`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h" || args.includes("--help")) {
    printUsage();
    return;
  }

  if (!["impact", "workflow", "doctor", "report", "compare", "ci"].includes(command)) {
    throw new Error(`Unknown command: ${command}`);
  }

  const commandOptions: Record<string, string[]> = {
    impact: ["config"], doctor: ["config"], report: ["output"], compare: [],
    ci: ["evidence", "min-success-delta-pp", "max-cost-increase-pct", "max-tool-error-rate", "max-regressions"],
  };
  const gateOptions = ["min-activation-rate", "max-false-activation-rate"];
  commandOptions.ci!.push(...gateOptions);
  commandOptions.workflow = ["config", "before", ...commandOptions.ci!.filter(name => name !== "evidence")];
  const { values, positionals } = parseArgs({
    args,
    options: {
      ...Object.fromEntries(commandOptions[command]!.map(name => [name, { type: "string" as const }])),
      json: { type: "boolean" },
    },
    strict: true,
    allowPositionals: true,
  });
  const value = (key: string) => (values as Record<string, string | boolean | undefined>)[key] as string | undefined;
  const required = (key: string) => {
    const result = value(key);
    if (!result) throw new Error(`${command} requires --${key}`);
    return result;
  };
  const print = (object: unknown, text?: string) => process.stdout.write(
    values.json || !text ? `${JSON.stringify(object, null, 2)}\n` : `${text}\n`,
  );
  const expected = command === "report" ? 1 : command === "compare" ? 2 : 0;
  if (positionals.length !== expected) throw new Error(`${command} expects ${expected} positional paths`);
  const gatePolicy = () => {
    const number = (key: string, min: number, max = Infinity) => {
      const raw = value(key);
      if (raw === undefined) return undefined;
      const result = Number(raw);
      if (!raw.trim() || !Number.isFinite(result) || result < min || result > max) throw new Error(`Invalid --${key}`);
      return result;
    };
    const policy = {
      minSuccessDeltaPp: number("min-success-delta-pp", -100, 100) ?? 0,
      maxCostIncreasePct: number("max-cost-increase-pct", -100),
      maxToolErrorRate: number("max-tool-error-rate", 0, 1),
      maxRegressions: number("max-regressions", 0),
      minActivationRate: number("min-activation-rate", 0, 1),
      maxFalseActivationRate: number("max-false-activation-rate", 0, 1),
    };
    if (policy.maxRegressions !== undefined && !Number.isInteger(policy.maxRegressions)) throw new Error("max-regressions must be an integer");
    return policy;
  };
  if (command === "doctor") {
    const result = await doctor(value("config"));
    print(result, result.checks.map(c => `${c.status} ${c.name}: ${c.detail}`).join("\n"));
    process.exitCode = result.ok ? 0 : 1;
  } else if (command === "impact" || command === "workflow") {
    const policy = command === "workflow" ? gatePolicy() : undefined;
    process.stderr.write("Running external commands with host filesystem/network permissions. Use trusted fixtures and test credentials.\n");
    const controller = new AbortController();
    const interrupt = () => controller.abort(new Error("Experiment interrupted; temporary resources cleaned"));
    process.once("SIGINT", interrupt);
    process.once("SIGTERM", interrupt);
    try {
      if (command === "workflow") {
        const result = await runWorkflow(required("config"), {
          signal: controller.signal, before: value("before"), policy,
        });
        print(result);
        process.exitCode = result.exitCode;
      } else {
        const report = await runImpact(required("config"), { signal: controller.signal });
        print(report, formatImpactReport(report) + `Evidence: ${report.evidenceDir}`);
        if (report.summary.infrastructureFailures > 0) process.exitCode = 1;
      }
    } finally {
      process.removeListener("SIGINT", interrupt);
      process.removeListener("SIGTERM", interrupt);
    }
  } else if (command === "report") {
    const report = await loadReport(positionals[0]!);
    const result = values.json ? JSON.stringify(analyzeReport(report), null, 2) + "\n" : renderReport(report, true);
    if (value("output")) await writeFile(value("output")!, result);
    else process.stdout.write(result);
  } else if (command === "compare") {
    const comparison = compareReports(await loadReport(positionals[0]!), await loadReport(positionals[1]!));
    print(comparison);
  } else {
    const policy = gatePolicy();
    const result = evaluateGate(await loadReport(required("evidence")), policy);
    print(result);
    process.exitCode = result.exitCode;
  }
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = ["ci", "workflow"].includes(process.argv[2] ?? "") ? 2 : 1;
});
