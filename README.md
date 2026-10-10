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
Baseline: 2/4 successful
Candidate: 4/4 successful
Infrastructure failures: 0
Observed delta: 50pp
Decision: INCONCLUSIVE (smoke run; no confidence interval yet)
```

The structured result is written to `.agentlift/results.json`.

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
