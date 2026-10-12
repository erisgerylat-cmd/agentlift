# AgentLift

[English](./README.md) | [简体中文](./README.zh-CN.md)

Measure the real impact of agent extensions.

AgentLift runs paired baseline/candidate experiments to determine whether an
MCP server or Claude Code Skill improves task outcomes enough to justify its cost and complexity.

## Status

`0.0.1-prototype`: a runnable local CLI for manual acceptance. The core workflow
is `doctor → impact → report → compare → ci`. Includes YAML/JSONL suites,
independent evidence bundles, offline reports, conservative statistics, tool
sequence differences, an OpenAI-compatible text runner and a native Claude Code
runtime for text and code-editing tasks.

See [PROTOTYPE.md](./PROTOTYPE.md) for the full acceptance guide (Chinese).

Claude Code now supports baseline vs Skill and baseline vs stdio MCP. Start
with `npm run demo:claude`, then use `npm run impact:claude:skill` or
`npm run impact:claude:mcp` with your credentials. See the
[Claude Code guide](./CLAUDE-CODE.md) for setup and validation scope.

Run `npm run prototype:claude` to verify the complete Claude workflow, including
regressed extensions and CI rejection. `agentlift workflow --config <file>`
combines preflight, A/B execution, evidence validation, report, optional historical
comparison and CI. Workspace mode supports code editing with deterministic tests.

## Quick Start

Requirements:

- Node.js 22 or newer
- npm

```bash
npm ci
npm run prototype:claude
```

This uses an offline Claude CLI fixture and real stdio MCP connections to verify
working and regressed Skill/MCP experiments, reports, historical comparisons and
CI. No Claude installation or API credentials are needed. Open
`.agentlift/claude-workflow/ACCEPTANCE.json` for report paths. Each working
Candidate scores `4/4`, each regressed Candidate `2/4`; historical change is
`-50pp`, with CI `PASS` and expected `FAIL`. Synthetic results verify integration;
they do not measure live Claude quality and keep decision `INCONCLUSIVE`.

For the OpenAI-compatible offline prototype, run `npm run prototype`.

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
Ctrl+C interrupts `impact` or `workflow` and cleans its running process group and workspace.

## Use Claude Code

Install official Claude Code and set `ANTHROPIC_API_KEY`, or allowlisted
`CLAUDE_CODE_OAUTH_TOKEN` generated through your own `claude setup-token`.
Runs use temporary HOME and Claude configuration; personal interactive login
is not automatically inherited. Live calls incur model costs.

```bash
npm run build
node dist/cli.js workflow --config examples/claude/skill.yaml
node dist/cli.js workflow --config examples/claude/mcp.yaml
node dist/cli.js compare .agentlift/claude-skill .agentlift/claude-mcp
```

Replace the candidate Skill path or MCP command and provide your own fixture
and deterministic validators. Workspace mode enables explicitly configured
editing tools and validates modified code. Reports retain tool/parameter
differences, Token/cost estimates, final answers, file hashes and labeled
activation/control rates. `workflow` supports historical `--before` evidence
and the same explicit gate thresholds as `ci`.

See [Claude Code setup and code-task guide](./CLAUDE-CODE.md). Live Claude calls
await manual acceptance; managed settings and CLI versions can affect results.

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

The Generic Command runner must exit with code zero and emit exactly one final `run.end` event,
with status `completed` or `failed`. An explicit `failed` status or a nonzero
validator exit is a task failure. A nonzero runner exit, a validator killed by a
signal, or a malformed/missing/duplicate terminal event is an infrastructure
failure. Validator timeouts and output overflow also invalidate a run.

The Claude Code runtime translates its native stream-json result into this
contract. Valid turn/budget exhaustion is a task failure, including numeric
nonzero exits; authentication/API failures invalidate the pair.

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
AgentLift workflow / impact
    |-- GenericCommandRuntime or ClaudeCodeRuntime
    |-- StdioMcpExtension or ClaudeSkillExtension
    |     Baseline: disabled; Candidate: enabled
    v
Deterministic validators
    v
Checksummed evidence + offline report
    v
Historical comparison + CI gate
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
npm run demo
npm run prototype:claude
npm run prototype
```

Validated on macOS; Linux is a target but has not been verified in this environment.
Process isolation requires trusted commands and does not restrict host filesystem
or network access. Container isolation, LLM judges, additional validator types
and Web UI remain future work. Skills currently require Claude Code; live
paid-provider compatibility still requires manual testing. The full build and
32 automated tests, original demo and Claude workflow acceptance have passed.

Product scope and acceptance criteria are defined in [PRD.md](./PRD.md).
