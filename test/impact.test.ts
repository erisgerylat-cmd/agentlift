import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { runImpact } from "../src/impact.js";
import { runCommand } from "../src/process.js";
import { assertSafeFixture, redactSecrets } from "../src/security.js";

const projectRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const outputDir = path.join(projectRoot, ".agentlift");

test("runs a paired baseline/candidate MCP smoke experiment", async () => {
  try {
    const report = await runImpact(
      path.join(projectRoot, "examples", "agentlift.yaml"),
    );

    assert.equal(report.runs.length, 8);
    assert.equal(report.summary.totalPairs, 4);
    assert.equal(report.summary.baselineSuccesses, 2);
    assert.equal(report.summary.candidateSuccesses, 4);
    assert.equal(report.summary.infrastructureFailures, 0);
    assert.equal(report.summary.successRateDeltaPp, 50);

    for (const caseId of ["review-race-condition", "formatting-control"]) {
      assert.deepEqual(
        report.runs
          .filter((run) => run.caseId === caseId)
          .map((run) => run.condition),
        ["baseline", "candidate", "candidate", "baseline"],
      );
    }

    for (const run of report.runs) {
      assert.equal(run.events[0]?.type, "run.start");
      assert.equal(run.events.at(-2)?.type, "validation");
      assert.equal(run.events.at(-1)?.type, "run.end");
      assert.notEqual(run.outcome, "infrastructure_failure");
      assert.equal(run.runtime.stdoutTruncated, false);
      assert.equal(run.runtime.stderrTruncated, false);
    }

    const candidateToolCalls = report.runs
      .filter((run) => run.condition === "candidate")
      .flatMap((run) => run.events)
      .filter((event) => event.type === "tool.call");
    const baselineToolCalls = report.runs
      .filter((run) => run.condition === "baseline")
      .flatMap((run) => run.events)
      .filter((event) => event.type === "tool.call");

    assert.equal(candidateToolCalls.length, 2);
    assert.equal(baselineToolCalls.length, 0);
  } finally {
    await rm(outputDir, { recursive: true, force: true });
  }
});

test("caps command output and reports truncation", async () => {
  const result = await runCommand({
    command: [
      process.execPath,
      "-e",
      "process.stdout.write('x'.repeat(4096))",
    ],
    cwd: projectRoot,
    timeoutMs: 2_000,
    maxOutputBytes: 1_024,
  });

  assert.equal(result.stdoutTruncated, true);
  assert.equal(Buffer.byteLength(result.stdout), 1_024);
});

test("redacts secret values from keys and text", () => {
  assert.deepEqual(
    redactSecrets(
      { "token-key": "before-token-after", short: "x" },
      ["token", "x"],
    ),
    {
      "[REDACTED]-key": "before-[REDACTED]-after",
      short: "[REDACTED]",
    },
  );
});

test(
  "rejects fixture symlinks",
  { skip: process.platform === "win32" },
  async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agentlift-symlink-"));
    const fixture = path.join(root, "fixture");
    try {
      await mkdir(fixture);
      await writeFile(path.join(root, "outside.txt"), "outside\n");
      await symlink(
        path.join(root, "outside.txt"),
        path.join(fixture, "escape.txt"),
      );

      await assert.rejects(
        assertSafeFixture(fixture),
        /Fixture contains a symbolic link/u,
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
