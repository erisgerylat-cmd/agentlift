# AgentLift

[English](./README.md) | [简体中文](./README.zh-CN.md)

Measure the real impact of agent extensions.

AgentLift runs paired baseline/candidate experiments to determine whether an
MCP server improves task outcomes enough to justify its cost and complexity.

## Status

Early development. The current milestone is an offline vertical slice with a
Generic Command Agent and a deterministic stdio MCP server.

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
