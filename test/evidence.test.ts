import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { parse } from "yaml";
import { loadImpactConfig, loadTaskSuite } from "../src/config.js";
import { loadReport } from "../src/evidence/bundle.js";
import { runImpact } from "../src/impact.js";

test("independent evidence bundles retain snapshots, validate hashes and reject tampering", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentlift-evidence-test-"));
  try {
    const config = parse(await readFile("examples/agentlift.yaml", "utf8"));
    config.subject.runner.cwd = path.resolve("examples");
    config.candidate.cwd = path.resolve("examples");
    config.suite.file = path.resolve("examples/tasks.yaml");
    config.execution.repeats = 1;
    config.storage.output = path.join(root, "output");
    const file = path.join(root, "config.yaml");
    await writeFile(file, JSON.stringify(config));
    const a = await runImpact(file);
    const b = await runImpact(file);
    assert.notEqual(a.evidenceDir, b.evidenceDir);
    assert.deepEqual(a.environment?.fixtures, b.environment?.fixtures);
    assert.equal(a.environment?.comparisonKey, b.environment?.comparisonKey);
    assert.deepEqual((await loadReport(a.evidenceDir!)).summary, a.summary);
    await writeFile(path.join(a.evidenceDir!, "traces.jsonl"), "changed");
    await assert.rejects(loadReport(a.evidenceDir!), /checksum mismatch/);
    assert.deepEqual((await loadReport(config.storage.output)).summary, b.summary);
    config.security.envAllowlist = ["HOME"];
    await writeFile(file, JSON.stringify(config));
    await assert.rejects(loadImpactConfig(file), /Cannot override/);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("JSONL suites and run limits are validated before commands start", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentlift-jsonl-test-"));
  try {
    const suite = path.join(root, "tasks.jsonl");
    const entry = { id: "one", task: "test", fixture: { path: path.resolve("examples/fixture") },
      validators: [{ type: "command", command: ["node", "-e", "void 0"] }] };
    await writeFile(suite, JSON.stringify(entry) + "\n");
    assert.equal((await loadTaskSuite(suite)).cases[0]?.id, "one");
    const config = parse(await readFile("examples/agentlift.yaml", "utf8"));
    config.execution.maxRuns = 2;
    config.suite.file = suite;
    const file = path.join(root, "config.yaml");
    await writeFile(file, JSON.stringify(config));
    await assert.rejects(runImpact(file), /maxRuns/);
    await writeFile(suite, "not json");
    await assert.rejects(loadTaskSuite(suite), /Invalid task JSONL/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
