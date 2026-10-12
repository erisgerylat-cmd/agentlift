import assert from "node:assert/strict";
import { access, cp, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";

import { analyzeReport } from "../src/analysis/report.js";
import { loadImpactConfig } from "../src/config.js";
import { loadReport } from "../src/evidence/bundle.js";
import { fixtureDigest } from "../src/evidence/environment.js";
import { ClaudeSkillExtension } from "../src/extensions/claude-skill.js";
import { runImpact } from "../src/impact.js";
import { parseClaudeOutput } from "../src/runtimes/claude-code.js";
import { runCommand } from "../src/process.js";
import { runWorkflow } from "../src/workflow.js";

test("Claude Code Skill and MCP offline A/B runs preserve fixtures, native traces and evidence", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentlift-claude-test-"));
  const original = await fixtureDigest(path.resolve("examples/fixture"));
  const skillDigest = await fixtureDigest(path.resolve("examples/claude/skills/race-review"));
  try {
    for (const type of ["skill", "mcp"]) {
      const config = parse(await readFile(`examples/claude/offline-${type}.yaml`, "utf8"));
      config.subject.runner.cwd = path.resolve("examples/claude");
      config.suite.file = path.resolve("examples/claude/tasks.yaml");
      config.candidate.cwd = path.resolve("examples");
      if (type === "skill") config.candidate.path = path.resolve("examples/claude/skills/race-review");
      config.storage.output = path.join(root, type);
      const file = path.join(root, `${type}.yaml`);
      await writeFile(file, JSON.stringify(config));
      const report = await runImpact(file);
      assert.equal(report.summary.validPairs, 4);
      assert.equal(report.summary.baselineSuccesses, 2);
      assert.equal(report.summary.candidateSuccesses, 4);
      assert.equal(report.summary.infrastructureFailures, 0, JSON.stringify(report.runs.map(r => r.runtime)));
      assert.deepEqual(report.runs.slice(0, 4).map(r => r.condition), ["baseline", "candidate", "candidate", "baseline"]);
      assert.equal(report.environment?.agent.version, "offline-fixture");
      assert(report.runs.every(run => run.events.some(e => e.type === "model.usage" && e.totalTokens === 115)));
      assert(report.runs.filter(r => r.condition === "baseline").every(r => !r.events.some(e => e.type === "tool.call")));
      assert(report.runs.filter(r => r.caseId === "formatting-control").every(r => !r.events.some(e => e.type === "tool.call")));
      assert.equal(analyzeReport(report).metrics.costUSD.baseline, 0.001);
      assert.equal(analyzeReport(report).metrics.candidateSkillActivations, type === "skill" ? 2 : 0);
      assert.equal((await loadReport(report.evidenceDir!)).summary.candidateSuccesses, 4);
      if (type === "skill") assert.equal(report.environment?.skill?.digest, skillDigest);
    }
    assert.equal(await fixtureDigest(path.resolve("examples/fixture")), original);
    assert.equal(await fixtureDigest(path.resolve("examples/claude/skills/race-review")), skillDigest);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Claude native result parser rejects authentication, missing terminals and broken MCP while treating limits as task failure", () => {
  const line = (value: object) => JSON.stringify(value) + "\n";
  const success = { type: "result", subtype: "success", is_error: false, result: "ok" };
  assert.throws(() => parseClaudeOutput(line({ ...success, result: undefined })), /requires text/);
  assert.throws(() => parseClaudeOutput(line({ type: "result", subtype: "error_during_execution", is_error: true })), /execution error/);
  assert.throws(() => parseClaudeOutput(line({ type: "system", subtype: "init", mcp_servers: [{ status: "failed" }] })), /did not connect/);
  assert.throws(() => parseClaudeOutput(line({ type: "assistant" })), /did not emit/);
  assert.throws(() => parseClaudeOutput(line(success) + line(success)), /after result/);
  const limited = parseClaudeOutput(line({ type: "result", subtype: "error_max_turns", is_error: true }));
  assert.equal(limited.end.subtype, "error_max_turns");
  assert.equal(limited.events[0]?.totalTokens, null);
  assert.throws(() => parseClaudeOutput(line(success) + "invalid"));
  assert.equal(parseClaudeOutput(line(success) + "partial", true).end.result, "ok");
});

test("Skill snapshots reject unsafe manifests and paths and remain stable when the source changes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentlift-skill-test-"));
  try {
    const source = path.join(root, "source");
    const experiment = path.join(root, "experiment");
    const workspace = path.join(root, "workspace");
    await cp("examples/claude/skills/race-review", source, { recursive: true });
    await mkdir(experiment);
    await mkdir(workspace);
    const extension = new ClaudeSkillExtension({ name: "race-review", path: source });
    await extension.validate();
    await extension.install(experiment);
    await writeFile(path.join(source, "reference.txt"), "CHANGED");
    assert.equal(await extension.prepare(workspace, "baseline"), undefined);
    await assert.rejects(access(path.join(workspace, ".claude")));
    const skill = await extension.prepare(workspace, "candidate");
    assert.equal((await readFile(path.join(skill!.path, "reference.txt"), "utf8")).trim(), "RACE_FOUND");
    await extension.uninstall();
    await assert.rejects(extension.prepare(workspace, "candidate"), /installed/);
    await writeFile(path.join(source, "SKILL.md"), "---\nname: wrong\ndescription: test\n---\nbody");
    await assert.rejects(extension.validate(), /matching name/);
    await symlink(path.join(source, "reference.txt"), path.join(source, "escape"));
    await assert.rejects(extension.validate(), /symbolic link/);
    const config = parse(await readFile("examples/claude/skill.yaml", "utf8"));
    config.subject.runner.protocol = "jsonl";
    const file = path.join(root, "config.json");
    await writeFile(file, JSON.stringify(config));
    await assert.rejects(loadImpactConfig(file), /configured together/);
    config.subject.runner.protocol = "claude-code";
    config.subject.model.temperature = 0;
    await writeFile(file, JSON.stringify(config));
    await assert.rejects(loadImpactConfig(file), /does not support/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("MCP launcher preserves its cwd and only passes explicitly allowlisted credentials", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentlift-launch-test-"));
  try {
    const script = path.join(root, "server.mjs");
    await writeFile(script, "console.log(JSON.stringify({ cwd: process.cwd(), key: process.env.ANTHROPIC_API_KEY, allowed: process.env.TOOL_TOKEN }))");
    const file = path.join(root, "servers.json");
    await writeFile(file, JSON.stringify([{ command: [process.execPath, script], cwd: root, env: { TOOL_TOKEN: "allowed" } }]));
    const result = await runCommand({
      command: [process.execPath, "--import", "tsx", path.resolve("src/runners/mcp-launch.ts"), file, "0"],
      cwd: process.cwd(), env: { PATH: process.env.PATH, ANTHROPIC_API_KEY: "never-forward" }, timeoutMs: 10000,
    });
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), { cwd: await realpath(root), allowed: "allowed" });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Claude execution failures retain earlier tool evidence and numeric turn-limit exits remain task failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentlift-claude-fault-"));
  try {
    const config = parse(await readFile("examples/claude/offline-mcp.yaml", "utf8"));
    const script = path.join(root, "fault.mjs");
    config.subject.runner.command = [process.execPath, script];
    config.subject.runner.cwd = root;
    config.candidate.cwd = path.resolve("examples");
    config.suite.file = path.resolve("examples/claude/tasks.yaml");
    config.execution.repeats = 1;
    config.storage.output = path.join(root, "output");
    const file = path.join(root, "config.json");
    await writeFile(file, JSON.stringify(config));
    const call = { type: "assistant", message: { content: [
      { type: "tool_use", id: "early", name: "Read", input: { file_path: "sample" } },
    ] } };
    for (const subtype of ["error_during_execution", "error_max_turns"]) {
      await writeFile(script, `console.log(${JSON.stringify(JSON.stringify(call))});
console.log(JSON.stringify({type:"result",subtype:${JSON.stringify(subtype)},is_error:true}));
process.exitCode=1;`);
      const report = await runImpact(file);
      assert(report.runs.every(r => r.events.some(e => e.type === "tool.call")));
      if (subtype === "error_during_execution") {
        assert.equal(report.summary.validPairs, 0);
        assert.equal(report.summary.infrastructureFailures, 4);
      } else {
        assert.equal(report.summary.validPairs, 2);
        assert.equal(report.summary.infrastructureFailures, 0);
        assert(report.runs.every(r => r.outcome === "task_failure"));
      }
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Claude workspace workflow validates code edits, saves artifacts and enforces extension regression gates", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentlift-claude-code-"));
  try {
    const config = parse(await readFile("examples/claude/offline-skill.yaml", "utf8"));
    config.subject.runner.cwd = path.resolve("examples/claude");
    config.subject.runner.resultMode = "workspace";
    config.subject.runner.tools = ["Read", "Edit", "Skill"];
    config.subject.runner.allowedTools = ["Read", "Edit", "Skill"];
    config.candidate.path = path.resolve("examples/claude/skills/race-review");
    config.suite.file = path.resolve("examples/claude/code-tasks.yaml");
    config.storage.output = path.join(root, "output");
    const file = path.join(root, "config.json");
    await writeFile(file, JSON.stringify(config));
    const working = await runWorkflow(file);
    assert.equal(working.exitCode, 0, JSON.stringify(working));
    assert.equal(working.analysis!.summary.baselineSuccesses, 0);
    assert.equal(working.analysis!.summary.candidateSuccesses, 2);
    assert(working.analysis!.pairs.every(p => p.fileChanges.some(e => e.path === "sum.mjs")));
    const artifacts = JSON.parse(await readFile(path.join(working.evidenceDir!, "artifacts.json"), "utf8"));
    assert(artifacts.every((r: { changes: { path: string }[] }) => !r.changes.some(e => e.path === "result.txt")));
    assert.equal((await loadReport(working.evidenceDir!)).summary.validPairs, 2);
    const changed = path.join(root, "skill");
    await cp(config.candidate.path, changed, { recursive: true });
    await writeFile(path.join(changed, "reference.txt"), "WRONG_FINDING");
    config.candidate.path = changed;
    await writeFile(file, JSON.stringify(config));
    const regressed = await runWorkflow(file, { before: working.evidenceDir, policy: { minSuccessDeltaPp: 1 } });
    assert.equal(regressed.exitCode, 1);
    assert.equal(regressed.comparison?.candidateSuccessChangePp, -100);
    config.suite.file = path.resolve("examples/claude/tasks.yaml");
    config.subject.runner.resultMode = "text";
    await writeFile(file, JSON.stringify(config));
    const labeled = await runWorkflow(file, { policy: { minActivationRate: 1, maxFalseActivationRate: 0 } });
    assert.equal(labeled.analysis!.extension.activationRate, 1);
    assert.equal(labeled.analysis!.extension.falseActivationRate, 0);
    const cli = await runCommand({
      command: [process.execPath, "--import", "tsx", path.resolve("src/cli.ts"), "workflow", "--config", file,
        "--min-activation-rate=1", "--max-false-activation-rate=0"],
      cwd: process.cwd(), timeoutMs: 15000,
    });
    assert.equal(cli.exitCode, 0, cli.stderr);
    assert.equal(JSON.parse(cli.stdout).status, "PASS");
  } finally { await rm(root, { recursive: true, force: true }); }
});
