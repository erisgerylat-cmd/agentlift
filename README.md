# AgentLift

[English](./README.md) | [简体中文](./README.zh-CN.md)

Measure the real impact of agent extensions.

AgentLift runs paired baseline/candidate experiments to determine whether an
MCP server improves task outcomes enough to justify its cost and complexity.

## Status

Early development. The offline demo uses a deterministic Agent and stdio MCP.
An OpenAI-compatible reference runner is also available for text-answer tasks,
with local HTTP/stdio integration tests.

## Quick Start

Requirements:

- Node.js 22 or newer
- npm

```bash
npm install
npm run demo
```

Expected smoke result:

```text
Valid pairs: 4; excluded pairs: 0
Baseline: 2/4 successful
Candidate: 4/4 successful
Infrastructure failures: 0
Observed delta: 50pp
Decision: INCONCLUSIVE (smoke run; no confidence interval yet)
```

The structured result is written to `.agentlift/results.json`.

## OpenAI-compatible Reference Runner

Use [examples/openai-agentlift.yaml](./examples/openai-agentlift.yaml) with a
Chat Completions provider that supports function tool calls:

1. Set `MODEL_BASE_URL` (the API prefix, such as your provider's `/v1` URL) and
   `MODEL_API_KEY` in your shell. Keep credential values out of YAML.
2. Replace `subject.model.name` with your provider's model name.
3. Run `npm run impact:openai` to build and execute the example.

This command sends prompts and MCP tool results to the configured provider and
can incur charges. The example still uses the deterministic Fake MCP and a
synthetic task suite; its lift is a connectivity check, not evidence of real
product value. Results are written to `.agentlift/openai/results.json`.

The runner is `dist/runners/openai.js`, invoked through GenericCommandRuntime.
It makes non-streaming `POST <base-url>/chat/completions` requests, sends no tools
for Baseline, and discovers tools from one stdio MCP in Candidate. Tool schemas
are converted to function definitions; tool arguments are validated locally.
The final answer is written to `result.txt` inside the temporary workspace.
The runner never overwrites an existing result file. It does not read repository
files automatically or provide shell/file editing tools.

Optional `subject.model` fields:

| Field | Default | Meaning |
|---|---|---|
| `temperature` | omitted | Provider sampling setting, identical in both conditions |
| `maxTokens` | `2048` | `max_tokens` per completion, not a total experiment budget |
| `maxTurns` | `8` | Maximum completion requests per run |
| `requestTimeoutMs` | `30000` | Per HTTP/MCP request timeout; the execution timeout still caps the run |

Provider token counts and returned model identity are captured in `model.usage`
events; missing counts are `null`. No token-price estimates, confidence
intervals, or automatic retries are added. API redirects are rejected.
HTTP responses, runner input, MCP messages/results and MCP stderr are bounded
at 1 MiB; model request bodies are bounded at 4 MiB. Discovery supports at most
128 tools across 16 pages and each completion at most 32 calls.

Model credentials are read in the Agent and are not automatically passed to MCP;
only explicit `candidate.envAllowlist` values and runtime directories/search
paths are forwarded. MCP `isError` results are returned to the model for recovery,
while transport/JSON-RPC errors invalidate the run. Exhausting `maxTurns` is a
task failure. Validation so far uses a local simulated provider, not a live paid
provider. Responses API, streaming, images, multiple MCP servers, and general
repository editing are outside this first runner.

## Failure Evidence

Command startup, input delivery, timeout, output-limit, process-exit, and JSONL
protocol failures are recorded per run. Remaining runs continue, and the report
retains events parsed before the failure. Validators are skipped when the
Runtime has an infrastructure failure.

The runner must exit with code zero and emit exactly one final `run.end` event,
with status `completed` or `failed`. An explicit `failed` status or a nonzero
validator exit is a task failure. A nonzero runner exit, a validator killed by a
signal, or a malformed/missing/duplicate terminal event is an infrastructure
failure. Validator timeouts and output overflow also invalidate a run.

Success counts and the observed delta use only **valid pairs**: both conditions
for the same case and repeat must be free of infrastructure failures.
`summary.excludedPairs` lists each excluded case/repeat and the affected run,
condition, stage, and failure reason; all runs remain in `runs`.
With no valid pairs, `successRateDeltaPp` is `null` and the terminal displays
`unavailable`. Smoke decisions remain `INCONCLUSIVE`.

The CLI writes its report before returning exit code `1` if any run has an
infrastructure failure. Deterministic task failures alone do not change the
smoke command's exit code. Invalid experiment configuration, duplicate case IDs,
unsafe fixtures, and setup/storage errors remain fatal errors; they are not
silently converted to task failures.

## Current Flow

```text
tasks.yaml
    |
    v
AgentLift impact runner
    |-- GenericCommandRuntime: launch Agent and collect JSONL
    `-- StdioMcpExtension
        |-- Baseline: disabled
        `-- Candidate: enabled
            |
            v
      Deterministic validators
            |
            v
       results.json
```

The example Candidate performs a real MCP JSON-RPC exchange:

```text
initialize -> tools/list -> tools/call
```

Runs use AB/BA-balanced condition order. Each run receives an isolated temporary
HOME, an explicit environment allowlist, bounded stdout/stderr capture, and a
fixture copy that rejects symbolic links. The original fixture is never used as
the Agent workspace.

## Development

```bash
npm run build
npm test
npm run check
```

Product scope and acceptance criteria are defined in [PRD.md](./PRD.md).
