#!/usr/bin/env node

import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

import { runImpact } from "./impact.js";
import { doctor } from "./doctor.js";
import { loadReport } from "./evidence/bundle.js";
import { renderReport } from "./analysis/report.js";
import { compareReports, evaluateGate } from "./analysis/commands.js";
import type { ImpactReport } from "./types.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const output = path.join(projectRoot, ".agentlift", "prototype");

async function main() {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "agentlift-prototype-"));
  const controller = new AbortController();
  const interrupt = () => controller.abort(new Error("Prototype demo interrupted"));
  process.once("SIGINT", interrupt);
  process.once("SIGTERM", interrupt);
  const oldUrl = process.env.AGENTLIFT_DEMO_URL, oldKey = process.env.AGENTLIFT_DEMO_KEY;
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      try {
        const input = JSON.parse(body);
        const prompt = input.messages.find((m: { role: string }) => m.role === "user").content as string;
        const control = prompt.includes("formatting-only");
        const result = input.messages.find((m: { role: string }) => m.role === "tool");
        const content = control ? "FORMAT_OK" : result ? JSON.parse(result.content).content[0].text : "NO_FINDING";
        const shouldCall = input.tools && !result && !control;
        response.setHeader("Content-Type", "application/json");
        response.end(JSON.stringify({
          model: "agentlift-local-demo-v1",
          choices: [{
            finish_reason: shouldCall ? "tool_calls" : "stop",
            message: shouldCall
              ? { role: "assistant", content: null, tool_calls: [{
                  id: "demo_call", type: "function",
                  function: { name: input.tools[0].function.name, arguments: JSON.stringify({ prompt }) },
                }] }
              : { role: "assistant", content },
          }],
          usage: { prompt_tokens: input.tools ? 30 : 20, completion_tokens: 10, total_tokens: input.tools ? 40 : 30 },
        }));
      } catch { response.writeHead(400); response.end("Invalid local demo request"); }
    });
  });
  try {
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    assert(address && typeof address !== "string");
    process.env.AGENTLIFT_DEMO_URL = `http://127.0.0.1:${address.port}/v1`;
    process.env.AGENTLIFT_DEMO_KEY = "agentlift-local-demo-credential";
    const reports: ImpactReport[] = [];
    for (const scenario of ["working", "regression"]) {
      const config = parse(await readFile(path.join(projectRoot, "examples/openai-agentlift.yaml"), "utf8"));
      config.subject.runner = {
        protocol: "jsonl", cwd: projectRoot,
        command: [process.execPath, path.join(projectRoot, "dist/runners/openai.js")],
      };
      config.subject.model = {
        ...config.subject.model, name: "agentlift-local-demo",
        baseUrlEnv: "AGENTLIFT_DEMO_URL", apiKeyEnv: "AGENTLIFT_DEMO_KEY",
        inputPricePerMillion: 1, outputPricePerMillion: 2,
      };
      config.suite.file = path.join(projectRoot, "examples/openai-tasks.yaml");
      config.storage.output = path.join(output, scenario);
      const source = await readFile(path.join(projectRoot, "examples/fake-mcp.mjs"), "utf8");
      const mcp = path.join(temporary, `${scenario}.mjs`);
      await writeFile(mcp, scenario === "regression" ? source.replace("RACE_FOUND", "WRONG_FINDING") : source);
      config.candidate.command = [process.execPath, mcp];
      config.candidate.cwd = temporary;
      const configFile = path.join(temporary, `${scenario}.yaml`);
      await writeFile(configFile, JSON.stringify(config));
      const health = await doctor(configFile);
      assert(health.ok, JSON.stringify(health));
      console.log(`Running ${scenario} scenario with local HTTP model and stdio MCP...`);
      const report = await runImpact(configFile, { signal: controller.signal });
      assert.equal(report.summary.infrastructureFailures, 0);
      assert.equal(report.summary.validPairs, 4);
      assert.equal(report.summary.candidateSuccesses, scenario === "working" ? 4 : 2);
      assert.deepEqual((await loadReport(report.evidenceDir!)).summary, report.summary);
      reports.push(report);
      console.log(renderReport(report));
    }
    const comparison = compareReports(reports[0]!, reports[1]!);
    assert.equal(comparison.candidateSuccessChangePp, -50);
    const policy = { minSuccessDeltaPp: 1, maxToolErrorRate: 0.05 };
    const gates = { working: evaluateGate(reports[0]!, policy), regression: evaluateGate(reports[1]!, policy) };
    assert.equal(gates.working.exitCode, 0);
    assert.equal(gates.regression.exitCode, 1);
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, "comparison.json"), JSON.stringify(comparison, null, 2));
    await writeFile(path.join(output, "ci-results.json"), JSON.stringify(gates, null, 2));
    const text = [
      "# AgentLift prototype acceptance",
      "",
      "Local simulated provider only; no external credentials or paid API calls.",
      "",
      `Working report: ${reports[0]!.evidenceDir}/report.md`,
      `Regression report: ${reports[1]!.evidenceDir}/report.md`,
      "Candidate success change: -50pp",
      "CI working: PASS; CI regression: FAIL (expected)",
      "",
      "All demonstration assertions passed.",
    ].join("\n");
    await writeFile(path.join(output, "ACCEPTANCE.md"), text);
    console.log(text);
  } finally {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
    for (const [name, value] of [["AGENTLIFT_DEMO_URL", oldUrl], ["AGENTLIFT_DEMO_KEY", oldKey]]) {
      if (value === undefined) delete process.env[name!]; else process.env[name!] = value;
    }
    server.closeAllConnections();
    if (server.listening) await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(temporary, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Prototype demo failed");
  process.exitCode = 1;
});
