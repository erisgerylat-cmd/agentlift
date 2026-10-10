import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { runImpact } from "../src/impact.js";
import { OpenAICompatibleClient, MAX_RESPONSE_BYTES } from "../src/models/openai-compatible.js";
import type { ModelConfig } from "../src/models/config.js";

const projectRoot = fileURLToPath(new URL("..", import.meta.url));
const runnerFile = path.join(projectRoot, "src/runners/openai.ts");
const model: ModelConfig = {
  provider: "openai-compatible",
  baseUrlEnv: "AGENTLIFT_TEST_MODEL_URL",
  apiKeyEnv: "AGENTLIFT_TEST_MODEL_KEY",
  name: "offline-chat-model",
  temperature: 0,
  maxTokens: 128,
  requestTimeoutMs: 1000,
};
const fakeKey = "local-test-credential-not-a-real-secret";

function completion(content: string | null, tool = false) {
  return {
    model: "offline-chat-model-v1",
    choices: [{
      finish_reason: tool ? "tool_calls" : "stop",
      message: tool ? {
        role: "assistant", content,
        tool_calls: [{
          id: "call_1", type: "function",
          function: { name: "mcp_0", arguments: JSON.stringify({ prompt: "review" }) },
        }],
      } : { role: "assistant", content },
    }],
    usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
  };
}

async function withServer(
  handler: (request: IncomingMessage, response: ServerResponse) => void,
  run: () => Promise<void>,
) {
  const server = createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  const previousUrl = process.env[model.baseUrlEnv];
  const previousKey = process.env[model.apiKeyEnv];
  process.env[model.baseUrlEnv] = `http://127.0.0.1:${address.port}/v1`;
  process.env[model.apiKeyEnv] = fakeKey;
  try { await run(); } finally {
    for (const [name, value] of [
      [model.baseUrlEnv, previousUrl], [model.apiKeyEnv, previousKey],
    ]) {
      if (value === undefined) delete process.env[name!];
      else process.env[name!] = value;
    }
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

async function withExperiment(
  run: (config: string, root: string) => Promise<void>,
  options: { maxTurns?: number; repeats?: number; serverScript?: string; existingResult?: boolean } = {},
) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentlift-openai-test-"));
  try {
    await mkdir(path.join(root, "fixture"));
    if (options.existingResult) {
      await writeFile(path.join(root, "fixture/result.txt"), "existing");
    }
    await writeFile(path.join(root, "fixture/check.mjs"), `
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
assert.equal((await readFile('result.txt', 'utf8')).trim(), 'RACE_FOUND');
`);
    const mcpScript = path.join(root, "mcp.mjs");
    await writeFile(mcpScript, options.serverScript ?? `
import fs from 'node:fs';
// Marker proves only candidate starts MCP and model credentials are not inherited.
fs.appendFileSync(${JSON.stringify(path.join(root, "starts"))}, String(process.pid) + '\\n');
if (process.env.AGENTLIFT_TEST_MODEL_KEY) process.exit(9);
import ${JSON.stringify(new URL("../examples/fake-mcp.mjs", import.meta.url).href)};
`);
    await writeFile(path.join(root, "tasks.yaml"), JSON.stringify({
      version: 1,
      cases: [{
        id: "review", task: "Review the repository; reply RACE_FOUND when a race is found.",
        fixture: { path: "./fixture" },
        validators: [{ type: "command", command: [process.execPath, "check.mjs"] }],
      }],
    }));
    const config = path.join(root, "agentlift.yaml");
    await writeFile(config, JSON.stringify({
      version: 1, kind: "extension-impact",
      subject: {
        runner: {
          protocol: "jsonl", cwd: projectRoot,
          command: [process.execPath, "--import", "tsx", runnerFile],
        },
        model: { ...model, maxTurns: options.maxTurns ?? 3 },
      },
      candidate: { type: "mcp", transport: "stdio", command: [process.execPath, mcpScript] },
      suite: { file: "./tasks.yaml" },
      execution: { repeats: options.repeats ?? 1, timeoutMs: 10000 },
      storage: { output: "./results" },
    }));
    await run(config, root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("reference runner completes real HTTP + stdio AB/BA with usage and credential isolation", async () => {
  const requests: Record<string, any>[] = [];
  const faults: string[] = [];
  await withServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      if (req.url !== "/v1/chat/completions") faults.push("wrong endpoint");
      if (req.headers.authorization !== `Bearer ${fakeKey}`) faults.push("missing auth");
      const request = JSON.parse(body);
      requests.push(request);
      const hasResult = request.messages.some((m: any) => m.role === "tool");
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(hasResult
        ? completion("RACE_FOUND")
        : request.tools ? completion(null, true) : completion("NO_FINDING")));
    });
  }, async () => {
    await withExperiment(async (config, root) => {
      const report = await runImpact(config);
      assert.deepEqual(faults, []);
      assert.deepEqual(report.runs.map(r => r.condition), ["baseline", "candidate", "candidate", "baseline"]);
      assert.equal(report.summary.validPairs, 2);
      assert.equal(report.summary.baselineSuccesses, 0);
      assert.equal(report.summary.candidateSuccesses, 2);
      assert.equal(report.summary.successRateDeltaPp, 100);
      assert.equal(report.summary.infrastructureFailures, 0);
      assert.equal(requests.length, 6);
      assert(requests.every(r => r.model === model.name && r.max_tokens === 128 && r.temperature === 0));
      assert.equal(requests.filter(r => !r.tools).length, 2);
      const calls = report.runs.flatMap(r => r.events).filter(e => e.type === "tool.call");
      assert.equal(calls.length, 2);
      assert(calls.every(e => e.name === "review_code"));
      const usage = report.runs.flatMap(r => r.events).filter(e => e.type === "model.usage");
      assert.equal(usage.length, 6);
      assert(usage.every(e => e.totalTokens === 12 && e.model === "offline-chat-model-v1"));
      const disk = await readFile(path.join(root, "results/results.json"), "utf8");
      assert(!disk.includes(fakeKey));
      const pids = (await readFile(path.join(root, "starts"), "utf8")).trim().split("\n");
      assert.equal(pids.length, 2);
      for (const pid of pids) assert.throws(() => process.kill(Number(pid), 0));
    }, { repeats: 2 });
  });
});

test("HTTP errors yield persisted infrastructure failures without leaking provider bodies", async () => {
  await withServer((_req, res) => {
    res.writeHead(401);
    res.end(fakeKey);
  }, async () => {
    await withExperiment(async (config, root) => {
      const report = await runImpact(config);
      assert.equal(report.summary.infrastructureFailures, 2);
      assert.equal(report.summary.validPairs, 0);
      assert(!JSON.stringify(report).includes(fakeKey));
      assert.equal(JSON.parse(await readFile(path.join(root, "results/results.json"), "utf8")).runs.length, 2);
    });
  });
});

test("tool loop exhaustion is a task failure and does not produce a fabricated result", async () => {
  await withServer((_req, res) => res.end(JSON.stringify(completion(null, true))), async () => {
    await withExperiment(async (config) => {
      const report = await runImpact(config);
      const baseline = report.runs[0]!;
      const candidate = report.runs[1]!;
      assert.equal(baseline.outcome, "infrastructure_failure");
      assert.equal(candidate.outcome, "task_failure");
      assert.equal(candidate.runtime.agentStatus, "failed");
      assert.equal(candidate.events.filter(e => e.type === "tool.call").length, 1);
    }, { maxTurns: 1 });
  });
});

test("invalid tool arguments are reported to the model without invoking MCP", async () => {
  let rejectedResult = false;
  await withServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      const request = JSON.parse(body);
      const toolResult = request.messages.find((m: any) => m.role === "tool");
      if (toolResult) {
        rejectedResult = JSON.parse(toolResult.content).isError;
        res.end(JSON.stringify(completion("NO_FINDING")));
      } else if (request.tools) {
        const response = completion(null, true);
        response.choices[0]!.message.tool_calls![0]!.function.arguments = '{"prompt":3}';
        res.end(JSON.stringify(response));
      } else res.end(JSON.stringify(completion("NO_FINDING")));
    });
  }, async () => {
    await withExperiment(async (config) => {
      const report = await runImpact(config);
      assert(rejectedResult);
      assert.equal(report.summary.infrastructureFailures, 0);
      const result = report.runs[1]!.events.find(e => e.type === "tool.result");
      assert.equal(result?.status, "error");
      assert.match(JSON.stringify(result), /Invalid tool arguments/);
    });
  });
});

test("existing result artifact is never overwritten by the reference runner", async () => {
  await withServer((_req, res) => res.end(JSON.stringify(completion("RACE_FOUND"))), async () => {
    await withExperiment(async (config, root) => {
      const report = await runImpact(config);
      assert.equal(report.summary.infrastructureFailures, 2);
      assert.equal(await readFile(path.join(root, "fixture/result.txt"), "utf8"), "existing");
    }, { existingResult: true });
  });
});

test("MCP initialization failure invalidates candidate but baseline still runs", async () => {
  await withServer((_req, res) => res.end(JSON.stringify(completion("RACE_FOUND"))), async () => {
    await withExperiment(async (config) => {
      const report = await runImpact(config);
      assert.equal(report.runs[0]?.outcome, "task_success");
      assert.equal(report.runs[1]?.outcome, "infrastructure_failure");
      assert.equal(report.summary.validPairs, 0);
    }, { serverScript: "process.exit(1);" });
  });
});

test("model client rejects redirects, malformed JSON, oversized bodies, truncation and timeouts", async () => {
  for (const kind of ["redirect", "json", "large", "truncated", "timeout"]) {
    await withServer((_req, res) => {
      if (kind === "timeout") return;
      if (kind === "redirect") {
        res.writeHead(302, { location: "http://127.0.0.1:1/unexpected" });
        res.end();
      } else if (kind === "json") res.end("not JSON");
      else if (kind === "large") res.end(" ".repeat(MAX_RESPONSE_BYTES + 1));
      else {
        const response = completion("partial");
        response.choices[0]!.finish_reason = "length";
        res.end(JSON.stringify(response));
      }
    }, async () => {
      const client = new OpenAICompatibleClient({ ...model, requestTimeoutMs: 100 });
      await assert.rejects(client.complete([{ role: "user", content: "test" }], []));
    });
  }
});

test("missing usage remains unavailable and missing model credentials are rejected", async () => {
  await withServer((_req, res) => {
    const response = completion("answer");
    res.end(JSON.stringify({ ...response, usage: undefined }));
  }, async () => {
    const client = new OpenAICompatibleClient(model);
    const response = await client.complete([{ role: "user", content: "test" }], []);
    assert.equal(response.usage, undefined);
    delete process.env[model.apiKeyEnv];
    assert.throws(() => new OpenAICompatibleClient(model), /environment variable is missing/);
  });
});

test("conversation request limit rejects before contacting the provider", async () => {
  let received = 0;
  await withServer((_req, res) => {
    received += 1;
    res.end(JSON.stringify(completion("unexpected")));
  }, async () => {
    const client = new OpenAICompatibleClient(model);
    await assert.rejects(client.complete([{
      role: "user", content: "x".repeat(4 * MAX_RESPONSE_BYTES),
    }], []), /request byte limit/);
    assert.equal(received, 0);
  });
});

test("MCP isError results remain recoverable while JSON-RPC failures invalidate candidate", async () => {
  const source = await readFile(path.join(projectRoot, "examples/fake-mcp.mjs"), "utf8");
  for (const rpcFailure of [false, true]) {
    const script = rpcFailure
      ? source.replace('case "tools/call":', 'case "tools/call": fail(request.id, -32603, "test error"); break; case "unused":')
      : source.replace("content: [", "isError: true, content: [");
    let receivedError = false;
    await withServer((req, res) => {
      let body = "";
      req.on("data", chunk => { body += chunk; });
      req.on("end", () => {
        const request = JSON.parse(body);
        const toolResult = request.messages.find((m: any) => m.role === "tool");
        if (toolResult) {
          receivedError = JSON.parse(toolResult.content).isError;
          res.end(JSON.stringify(completion("RACE_FOUND")));
        } else {
          res.end(JSON.stringify(request.tools ? completion(null, true) : completion("NO_FINDING")));
        }
      });
    }, async () => {
      await withExperiment(async (config) => {
        const report = await runImpact(config);
        assert.equal(report.runs[1]?.outcome, rpcFailure ? "infrastructure_failure" : "task_success");
        assert.equal(receivedError, !rpcFailure);
        const result = report.runs[1]!.events.find(e => e.type === "tool.result");
        assert.equal(result?.status, "error");
      }, { serverScript: script });
    });
  }
});
