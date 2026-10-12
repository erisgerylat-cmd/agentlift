import assert from "node:assert/strict";
import { cp, mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { runWorkflow } from "./workflow.js";

async function main() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentlift-claude-demo-"));
  const output = path.resolve(".agentlift/claude-workflow");
  const controller = new AbortController();
  const stop = () => controller.abort(new Error("Claude demo interrupted"));
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    const results: unknown[] = [];
    for (const type of ["skill", "mcp"]) {
      const config = parse(await readFile(`examples/claude/offline-${type}.yaml`, "utf8"));
      config.subject.runner.cwd = path.resolve("examples/claude");
      config.suite.file = path.resolve("examples/claude/tasks.yaml");
      config.candidate.cwd = path.resolve("examples");
      if (type === "skill") config.candidate.path = path.resolve("examples/claude/skills/race-review");
      config.storage.output = path.join(output, type);
      const file = path.join(root, `${type}.json`);
      await writeFile(file, JSON.stringify(config));
      const policy = { minSuccessDeltaPp: 1, minActivationRate: 1, maxFalseActivationRate: 0 };
      const working = await runWorkflow(file, { policy, signal: controller.signal });
      assert.equal(working.exitCode, 0, JSON.stringify(working.diagnostics));
      assert.equal(working.analysis!.summary.candidateSuccesses, 4);
      results.push(working);
      if (type === "skill") {
        const skill = path.join(root, "regressed-skill");
        await cp(config.candidate.path, skill, { recursive: true });
        await writeFile(path.join(skill, "reference.txt"), "WRONG_FINDING\n");
        config.candidate.path = skill;
      } else {
        const script = path.join(root, "regressed-mcp.mjs");
        await writeFile(script, (await readFile("examples/fake-mcp.mjs", "utf8"))
          .replaceAll("RACE_FOUND", "WRONG_FINDING"));
        config.candidate.command = [process.execPath, script];
      }
      config.storage.output = path.join(output, `${type}-regressed`);
      await writeFile(file, JSON.stringify(config));
      const regressed = await runWorkflow(file, { before: working.evidenceDir, policy, signal: controller.signal });
      assert.equal(regressed.exitCode, 1);
      assert.equal(regressed.comparison?.candidateSuccessChangePp, -50);
      results.push(regressed);
    }
    await mkdir(output, { recursive: true });
    await writeFile(path.join(output, "ACCEPTANCE.json"), JSON.stringify(results, null, 2) + "\n");
    process.stdout.write(`Claude workflow acceptance passed: Skill/MCP PASS, regressions FAIL (-50pp).\nEvidence: ${output}\n`);
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await rm(root, { recursive: true, force: true });
  }
}
main().catch(error => { process.stderr.write(String(error) + "\n"); process.exitCode = 1; });
