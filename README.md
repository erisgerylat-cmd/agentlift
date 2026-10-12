# AgentLift

[English](./README.md) | [简体中文](./README.zh-CN.md)

Measure the real impact of agent extensions.

AgentLift runs paired baseline/candidate experiments to determine whether an
MCP server or Claude Code Skill improves task outcomes enough to justify its cost and complexity.

## Status

`0.0.1-prototype`: a runnable local CLI for manual acceptance. The core workflow
is `doctor → impact → report → compare → ci`. Includes YAML/JSONL suites,
independent evidence bundles, offline reports, conservative statistics, tool
sequence differences and an OpenAI-compatible text runner.

See [PROTOTYPE.md](./PROTOTYPE.md) for the full acceptance guide (Chinese).

Claude Code now supports baseline vs Skill and baseline vs stdio MCP. Start
with `npm run demo:claude`, then use `npm run impact:claude:skill` or
`npm run impact:claude:mcp` with your credentials. See the
[Claude Code guide](./CLAUDE-CODE.md) for setup and validation scope.

## Quick Start

Requirements:

- Node.js 22 or newer
- npm

```bash
npm install
npm run prototype
```

This starts a local simulated model, runs working and intentionally regressed
MCP scenarios, verifies reports/comparison/CI, then shuts down the server. No
API credentials are needed. Open `.agentlift/prototype/ACCEPTANCE.md` for report paths.
Expected results: working Candidate `4/4`, regressed Candidate `2/4`, historical
change `-50pp`, CI `PASS` and expected `FAIL`. Both are small synthetic suites
and keep decision `INCONCLUSIVE`.

For the smaller deterministic smoke experiment, run `npm run demo`:

```text
Decision: INCONCLUSIVE
Pairs: 4; valid: 4; excluded: 0
Baseline: 2/4 successful
Candidate: 4/4 successful
Observed delta: 50pp
95% lift interval: 0 to 100pp
```

Each experiment writes to `.agentlift/<experimentId>/`. `.agentlift/results.json`
is the latest compatibility copy. Evidence includes locked metadata, checksums,
traces, `results.json`, `analysis.json` and `report.md`.

```bash
npm run build
node dist/cli.js doctor --config examples/agentlift.yaml
node dist/cli.js report .agentlift/prototype/working
node dist/cli.js compare .agentlift/prototype/working .agentlift/prototype/regression
node dist/cli.js ci --evidence .agentlift/prototype/working --min-success-delta-pp=1
```

`report` supports `--json` and `--output`; `compare` checks task/fixture/Agent/model
compatibility. CI uses explicit thresholds, returns 0 for pass, 1 for violation
and 2 for unavailable evidence or invalid input. The default minimum lift is 0pp.
Ctrl+C interrupts `impact` and cleans its running process group and workspace.

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
| `inputPricePerMillion` | unavailable | User-declared USD per million input tokens |
| `outputPricePerMillion` | unavailable | User-declared USD per million output tokens |

Provider token counts and returned model identity are captured in `model.usage`
events; missing counts are `null`. Cost estimates require the declared prices.
Lift intervals use 2000 seeded case-cluster bootstrap samples; Wilson rate
intervals are descriptive. Recommendations require at least 10 cases and 20
valid pairs, a case-level sign test, positive interval, and the declared cost budget.
No automatic retries are added. API redirects are rejected.
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
npm run prototype
```

Validated on macOS; Linux is a target but has not been verified in this environment.
Process isolation requires trusted commands and does not restrict host filesystem
or network access. Container isolation, LLM judges, additional validator types,
Skills are supported through Claude Code; Web UI remains outside this prototype. Live paid-provider
compatibility still requires manual testing.

Product scope and acceptance criteria are defined in [PRD.md](./PRD.md).
