import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { runCommand } from "../src/process.js";

test("aborting a run terminates both its command and inherited process group", { skip: process.platform === "win32" }, async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentlift-interrupt-test-"));
  const marker = path.join(root, "pid");
  const controller = new AbortController();
  const result = runCommand({
    command: [process.execPath, "-e", `
      const child = require('node:child_process').spawn(process.execPath, ['-e','setInterval(()=>{},1000)'], {stdio:'ignore'});
      child.on('spawn', () => require('node:fs').writeFileSync(process.argv[1], String(child.pid)));
      setInterval(()=>{},1000);
    `, marker],
    cwd: root, timeoutMs: 5000, signal: controller.signal,
  });
  try {
    let pid: number | undefined;
    for (let attempt = 0; attempt < 100; attempt++) {
      try { pid = Number(await readFile(marker, "utf8")); break; }
      catch { await delay(20); }
    }
    assert(pid, "Child did not start");
    controller.abort();
    assert.equal((await result).failure?.message, "Command interrupted");
    assert.throws(() => process.kill(pid, 0));
  } finally {
    controller.abort();
    await result;
    await rm(root, { recursive: true, force: true });
  }
});
