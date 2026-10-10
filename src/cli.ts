#!/usr/bin/env node

import { parseArgs } from "node:util";

import { ZodError } from "zod";

import { formatImpactReport, runImpact } from "./impact.js";

function printUsage() {
  process.stdout.write(`AgentLift

Usage:
  agentlift impact --config <file>

Commands:
  impact    Run a baseline/candidate MCP impact smoke experiment
`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "--help" || command === "-h") {
    printUsage();
    return;
  }

  if (command !== "impact") {
    throw new Error(`Unknown command: ${command}`);
  }

  const parsed = parseArgs({
    args,
    options: {
      config: {
        type: "string",
        short: "c",
      },
    },
    strict: true,
    allowPositionals: false,
  });

  if (!parsed.values.config) {
    throw new Error("impact requires --config <file>");
  }

  const report = await runImpact(parsed.values.config);
  process.stdout.write(`${formatImpactReport(report)}\n`);
}

main().catch((error: unknown) => {
  if (error instanceof ZodError) {
    process.stderr.write(`${error.message}\n`);
  } else {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  process.exitCode = 1;
});
