# AgentLift Product Requirements Document

[English](./PRD.md) | [简体中文](./PRD.zh-CN.md)

> Status: Draft for review
> Version: 0.3
> Updated: 2026-10-10
> Product name: AgentLift (repository created; package availability not verified)

Implementation checkpoint: `0.0.1-prototype` now delivers the core CLI workflow
(`doctor`, `impact`, offline `report`, `compare`, `ci`). See
[prototype acceptance guide](./PROTOTYPE.md) for runnable commands and current
limits. Sections below include later Beta requirements; additional validators,
LLM judges, container isolation and Web UI are not implemented
in this prototype. Intervals use seeded case-cluster bootstrap and a case-level
sign test; case-subgroup enablement is not automated.

Claude Code checkpoint: basic Skill and stdio MCP paired evaluation is implemented,
with temporary configuration, native tool traces and CLI usage/cost estimates.
See [Claude Code acceptance](./CLAUDE-CODE.md). Offline contracts are verified;
live Claude model calls await manual acceptance. Detailed Skill activation,
conflict and context-overhead metrics below remain future requirements.

## 1. Executive Summary

AgentLift is a local-first experiment tool that measures whether an Agent
extension creates real net value.

The first supported extension type is an MCP server. Basic Skill evaluation now
uses Claude Code as its first native host.

The product answers one primary question:

> After enabling this MCP or Skill, how much does task quality improve, and is
> that improvement worth the added cost, latency, complexity, and risk?

AgentLift runs a controlled baseline/candidate experiment:

```text
Baseline:  Agent + Model + Tasks, without the extension
Candidate: Same Agent + Model + Tasks, with the extension
```

It then produces:

- paired outcome measurements;
- effect sizes and confidence intervals;
- failed and regressed cases;
- baseline/candidate trace differences;
- extension-specific overhead;
- a bounded enablement recommendation;
- a reproducible evidence bundle;
- an optional CI regression gate.

AgentLift is not a general model leaderboard or a universal Agent benchmark
platform. Models and Agents remain experiment variables, not separate product
lines.

## 2. Product Positioning

### 2.1 One-line Positioning

> AgentLift validates whether Agent extensions actually improve task outcomes.

### 2.2 English Tagline

> Measure the real impact of agent extensions.

### 2.3 Product Category

Agent extension impact evaluation and regression testing.

### 2.4 Product Promise

AgentLift provides a fair, reproducible, explainable experiment that supports a
real enablement decision:

- enable;
- enable only for specific task classes;
- do not enable;
- insufficient evidence.

### 2.5 Core Differentiation

Existing evaluation tools often report scores. AgentLift focuses on net impact
and decision support:

```text
Quality gain
- cost overhead
- latency overhead
- failure and safety risk
= task-bounded extension value
```

The value is not the number of evaluation engines integrated. The value is the
quality of the controlled experiment and the usefulness of its conclusion.

## 3. Problem Statement

Agent users and extension developers currently lack a reliable way to answer:

- Does this MCP improve actual task completion?
- Which task types benefit?
- Which task types regress?
- Does the extension trigger when it should?
- Does it trigger when it should not?
- How much context, token, latency, and tool-call overhead does it add?
- Is an observed improvement stable across repeated runs?
- Did an extension update introduce a regression?
- Can the result be reproduced by another developer or in CI?

Common current approaches are insufficient:

- one successful demo is treated as proof;
- baseline and candidate run in different environments;
- Agent or model versions drift between runs;
- only average scores are shown;
- failures and outliers are hidden;
- trace differences are inspected manually;
- extensions are installed globally before their value is known;
- results cannot be reused as release evidence.

## 4. Target Users

### 4.1 Primary: MCP Developer

An MCP author who needs to prove that the server improves a target workflow
before publishing a release.

Jobs to be done:

- compare the new MCP release with no MCP;
- detect quality or cost regressions;
- publish a reproducible impact report;
- block a release when key tasks regress.

### 4.2 Primary: Agent Power User

A developer considering whether to install an MCP or Skill.

Jobs to be done:

- test an extension without changing global configuration;
- understand where the extension helps or hurts;
- make an evidence-based enablement decision.

### 4.3 Secondary: Agent Platform Team

A team maintaining approved extension bundles.

Jobs to be done:

- validate upgrades against internal task suites;
- define CI policies;
- preserve historical evidence.

## 5. Goals

### 5.1 User Goals

- Run the first valid impact experiment within ten minutes.
- Avoid modifying the normal workspace or global Agent configuration.
- Receive a direct, bounded recommendation instead of raw metrics only.
- Inspect failed and regressed cases.
- Reproduce the result locally or in CI.
- Compare extension versions over time.

### 5.2 Product Goals

- Make baseline/candidate comparison fair by default.
- Make every conclusion traceable to raw evidence.
- Treat stochastic variation explicitly.
- Explain where and why behavior diverged.
- Keep the MVP local-first and command-line first.
- Support continued use through CI, not only one-off evaluation.

### 5.3 Project Goals

- Deliver one trustworthy vertical workflow before broad integrations.
- Keep the core implementation comprehensible and extensible.
- Establish an evidence bundle format that can support future ecosystem tools.

## 6. Non-goals

The MVP will not:

- provide a general model leaderboard;
- provide broad Agent benchmarking;
- support multiple Agent frameworks through automatic engine routing;
- implement a hosted dashboard;
- implement a marketplace;
- support multi-agent role attribution;
- implement Shapley-value contribution analysis;
- implement complex security ratings;
- install candidate extensions globally;
- automatically apply Agent-generated changes to the original repository;
- use an LLM judge as the sole decision authority;
- claim that one task or one run proves general extension value.

## 7. Product Principles

1. **One primary question.**  
   Every feature must help determine whether an extension should be enabled.

2. **Only one treatment variable.**  
   Baseline and candidate differ only by the tested extension.

3. **Paired evidence over aggregate impressions.**  
   Compare the same case under baseline and candidate conditions.

4. **Outcome over exact trajectory.**  
   Different valid tool paths are allowed unless the path violates a declared
   constraint.

5. **Hard failures cannot be averaged away.**  
   Security violations, data corruption, and mandatory-validator failures are
   reported separately.

6. **No opaque confidence label.**  
   Show sample count, effect size, interval, failures, and exclusions directly.

7. **Inconclusive is a valid result.**  
   Insufficient evidence must not produce an enablement recommendation.

8. **Explain the delta.**  
   Reports must identify where behavior first diverged and which cases improved
   or regressed.

9. **Local-first and reversible.**  
   Running an experiment must not permanently alter the user's environment.

10. **Evidence is portable.**  
    Every completed experiment creates a standalone evidence bundle.

## 8. Primary User Workflow

### 8.1 Minimal Command

```bash
agentlift impact ./mcp-server --suite ./evals/tasks.yaml
```

### 8.2 Execution Flow

1. Detect and validate the experiment configuration.
2. Resolve Agent, model, extension, and task versions.
3. Show planned runs, estimated cost, and time budget.
4. Create paired baseline/candidate workspaces.
5. Run baseline and candidate in randomized blocks.
6. Collect normalized traces and resource metrics.
7. Execute deterministic validators.
8. Optionally execute a calibrated LLM judge.
9. Compute paired effects and intervals.
10. Identify improved, regressed, and unstable cases.
11. Generate the enablement decision and evidence bundle.
12. Clean temporary resources.

### 8.3 Example Terminal Result

```text
Decision: ENABLE FOR CODE REVIEW TASKS

Scope
  Agent:   generic-command@sha256:8f3...
  Model:   example-model-2026-09-18
  MCP:     review-server@sha256:17a...
  Cases:   12
  Repeats: 10

Outcome
  Baseline success: 71 / 120
  Candidate success: 88 / 120
  Paired lift: +14.2 percentage points
  95% CI: [+5.1pp, +23.0pp]

Overhead
  Median input tokens: +8.1%
  Median latency: +4.6%
  Tool schema context: +1,842 tokens

Regressions
  2 formatting-only cases regressed
  1 unnecessary search call occurred

Recommendation
  Enable for repository review tasks.
  Disable for formatting-only tasks.
```

## 9. Experiment Contract

### 9.1 Configuration Example

```yaml
version: 1
kind: extension-impact

subject:
  runner:
    protocol: jsonl
    command: ["node", "./agent-runner.mjs"]
  model:
    provider: openai-compatible
    baseUrlEnv: MODEL_BASE_URL
    apiKeyEnv: MODEL_API_KEY
    name: example-model-2026-09-18

candidate:
  type: mcp
  transport: stdio
  command: ["node", "./dist/server.js"]
  envAllowlist:
    - MCP_TEST_TOKEN

suite:
  file: ./evals/tasks.yaml

execution:
  repeats: 10
  order: ab-ba-balanced
  timeout: 15m
  maxRuns: 240
  maxCostUSD: 20

decision:
  primaryMetric: task_success
  minimumQualityLiftPp: 5
  maximumTokenOverheadPct: 20
  maximumLatencyOverheadPct: 25

security:
  envAllowlist: []
  maxOutputBytes: 1048576
  network: inherit

storage:
  capture: redacted
  output: ./agentlift-results
```

### 9.2 Locked Variables

The experiment manifest locks:

- repository snapshot;
- task suite and case hashes;
- Agent command and version;
- model provider and resolved model ID;
- model settings;
- extension content hash;
- extension configuration;
- validator versions;
- environment allowlist;
- run budgets;
- execution order policy.

### 9.3 Treatment Variable

For the MCP MVP:

```text
Baseline:  candidate MCP unavailable
Candidate: candidate MCP available through a temporary stdio configuration
```

No other material variable may change.

## 10. Task Suite

### 10.1 YAML Example

```yaml
version: 1
profile: repository-review

cases:
  - id: find-race-condition
    task: Find and fix the race condition in the order writer.
    fixture:
      repository: ./fixtures/order-service
      commit: abc123
    validators:
      - type: command
        run: go test -race ./...
        required: true
      - type: diff
        denyPaths:
          - vendor/
        maxFiles: 8
    tags:
      - code-review
      - concurrency

  - id: formatting-only-control
    task: Normalize formatting without changing behavior.
    fixture:
      repository: ./fixtures/order-service
      commit: def456
    validators:
      - type: command
        run: gofmt -d .
        required: true
      - type: command
        run: go test ./...
        required: true
    tags:
      - formatting
      - negative-control
```

### 10.2 JSONL Example

```json
{"id":"find-race-condition","task":"Find and fix the race condition.","fixture":{"path":"./fixtures/order-service","commit":"abc123"},"validators":[{"type":"command","run":"go test -race ./...","required":true}]}
{"id":"formatting-control","task":"Normalize formatting only.","fixture":{"path":"./fixtures/order-service","commit":"def456"},"tags":["negative-control"]}
```

### 10.3 Case Categories

- positive-target cases where the extension should help;
- negative-control cases where it should not trigger;
- edge cases;
- known historical failures;
- cost-sensitive simple tasks;
- permission and side-effect cases.

### 10.4 Task Source Priority

1. Historical real-world failure and pre-fix snapshot.
2. Real repository with a controlled mutation.
3. Manually authored fixture.
4. Generated task, used only as supplemental coverage.

## 11. Validators

### 11.1 Deterministic Validators

MVP validator types:

- command exit status;
- test result;
- file existence;
- JSON Schema;
- diff scope;
- forbidden path modification;
- structured external-state probe;
- normalized trace assertion.

Required deterministic validators define primary task success whenever
available.

### 11.2 Optional LLM Judge

The LLM judge is optional and secondary.

Rules:

- deterministic failures remain failures;
- the judge cannot override a hard gate;
- the tested output is anonymized;
- baseline/candidate order is randomized;
- the rubric is frozen before execution;
- judge model and prompt versions are locked;
- judge evidence is labeled separately;
- uncalibrated judge output cannot independently produce `ENABLE`.

The MVP may ship the interface and one reference judge, but a complete
experiment must remain possible without it.

## 12. Decision Model

### 12.1 Decision States

| Decision | Meaning |
|---|---|
| ENABLE | Net benefit is supported for the declared task scope |
| ENABLE_CONDITIONALLY | Benefit exists only for specific tags or constraints |
| DO_NOT_ENABLE | Harm, overhead, or instability outweighs demonstrated benefit |
| INCONCLUSIVE | Evidence is insufficient or materially incomparable |

### 12.2 Decision Inputs

- primary task-success effect;
- confidence interval;
- hard-gate violations;
- task-tag subgroup effects;
- token and cost overhead;
- latency overhead;
- tool and transport failure rate;
- unnecessary activation rate;
- missing or excluded evidence.

### 12.3 Practical Thresholds

Decision thresholds are explicit and stored in the manifest.

Example:

```yaml
decision:
  minimumQualityLiftPp: 5
  nonInferiorityMarginPp: 3
  maximumTokenOverheadPct: 20
  maximumLatencyOverheadPct: 25
  maximumUnnecessaryActivationRate: 0.05
```

### 12.4 Task-bounded Recommendations

Recommendations must state:

- affected task categories;
- tested Agent and model;
- extension version;
- quality effect;
- overhead;
- known regressions;
- stop or rollback conditions.

AgentLift must not generalize beyond the tested scope.

## 13. Statistical Design

### 13.1 Pairing

Baseline and candidate runs are paired by:

- case;
- fixture snapshot;
- run block;
- Agent and model configuration;
- validator version.

Execution order is balanced within paired blocks.

The implementation uses balanced AB/BA blocks:

```text
odd repeat:  baseline -> candidate
even repeat: candidate -> baseline
```

The experiment records cache state, provider rate-limit signals, resolved model
identity, and any detectable model-version drift. Randomization may be added
inside balanced blocks later, but must not destroy order balance.

### 13.2 Reported Statistics

Every primary comparison displays:

- valid sample count;
- baseline and candidate event counts;
- absolute and relative paired effect sizes;
- 95% confidence interval;
- excluded runs and reasons;
- per-case outcomes;
- observed failure samples.

Only pairs with no infrastructure failure on either side contribute to primary
success counts and the observed delta. Exclude the whole case/repeat pair when
either side is invalid, retain both runs, and report every exclusion reason.
With zero valid pairs the observed delta is unavailable (`null`), never zero.

### 13.3 Default Methods

| Metric | Method |
|---|---|
| paired binary success | paired bootstrap effect interval; exact McNemar test as supporting evidence |
| pass rate | Wilson interval |
| token, latency, tool-call count | paired median difference with bootstrap interval |
| subgroup result | same method with explicit reduced sample count |
| multiple subgroup checks | Holm correction where formal claims are made |

Bootstrap intervals from small samples are descriptive, not proof of a stable
effect. Deterministic pass rates and LLM-judge scores remain separate measures
and are never collapsed into one total score.

### 13.4 No Opaque Confidence Grade

The MVP does not display `HIGH`, `MEDIUM`, or `LOW`.

It displays evidence directly:

```text
n = 120 paired runs
effect = +14.2pp
95% CI = [+5.1pp, +23.0pp]
excluded = 3 infrastructure failures
```

### 13.5 Conservative Decision Rules

The first decision rules are intentionally narrow:

- `ENABLE`: the success-rate interval lower bound is above zero and measured
  overhead remains within the user's declared budget;
- `DO_NOT_ENABLE`: success decreases materially, or a security or permission
  hard gate fails;
- `INCONCLUSIVE`: the sample is insufficient, the interval crosses zero, or
  the paired evidence is materially incomparable.

`ENABLE_CONDITIONALLY` requires enough evidence for an explicitly named task
subgroup. A smoke run always remains `INCONCLUSIVE`.

### 13.6 Run Modes

| Mode | Default use |
|---|---|
| smoke | validate configuration; not decision-grade |
| standard | routine local comparison |
| release | release and CI evidence |

The report labels non-decision-grade runs clearly.

## 14. Failure Explanation

### 14.1 Trace Diff

The vertical slice starts with only five normalized events:

- `run.start`;
- tool call;
- tool result;
- `validation`;
- `run.end`.

Later collection may add `model.usage`, `tool.discovery`, and `file.change`.
Trace analysis initially supports:

- event-type counts;
- tool-call sequence diff;
- changed tool arguments;
- changed tool results;
- the first observable divergence;
- longest common subsequence or simple stage alignment.

General semantic Trace alignment is explicitly deferred. Agent trajectories can
be valid while structurally different, so it is not on the Alpha critical path.

### 14.2 MCP-specific Explanation

The report measures:

- MCP startup success and time;
- initialization and capability negotiation;
- Tool Schema size;
- schema contribution to model context;
- tool-call success rate;
- invalid argument rate;
- transport failures;
- duplicate calls;
- unused tool exposure;
- permission and side-effect violations;
- shutdown and cleanup failures.

### 14.3 Case Classification

Each case is classified as:

- improved;
- unchanged-success;
- unchanged-failure;
- regressed;
- unstable;
- infrastructure-invalid.

### 14.4 Explanation Language

Preferred:

> The MCP first diverged at step 3 by calling `web_search` in 8 of 10 candidate
> runs. Those runs used 21% more input tokens and failed the repository-local
> evidence requirement.

Avoid:

> The MCP probably confused the Agent.

## 15. Evidence Bundle

### 15.1 Layout

```text
agentlift-evidence-<experiment-id>/
├── experiment.yaml
├── environment.lock
├── results.json
├── report.md
├── traces/
│   ├── baseline/
│   └── candidate/
├── artifacts/
├── failures/
└── regressions/
```

### 15.2 `environment.lock`

Records:

- OS and architecture;
- Node version;
- Agent and MCP commands and versions;
- Git commit and working-tree status;
- resolved model ID and any available version metadata;
- ExperimentSpec hash;
- task suite hash;
- Adapter versions;
- validator versions;
- repeat count and random seed;
- isolation mode and network policy;
- environment-variable names, never values;
- AgentLift version.

### 15.3 Portability

An evidence bundle must:

- render a report without rerunning the experiment;
- identify missing private inputs;
- validate artifact hashes;
- expose a reproduction command;
- avoid storing secrets.

## 16. CLI

### 16.1 Core Command

```bash
agentlift impact <extension> --suite <suite>
```

### 16.2 Supporting Commands

```bash
agentlift compare <experiment-a> <experiment-b>
agentlift doctor
agentlift ci
```

### 16.3 Examples

```bash
agentlift impact ./mcp-server --suite ./evals/review.yaml

agentlift compare ./results/v1 ./results/v2

agentlift doctor

agentlift ci \
  --min-success-delta-pp=-5 \
  --max-cost-increase-pct=20 \
  --max-tool-error-rate=0.05
```

The first CI interface uses explicit typed flags. An expression DSL is deferred
until repeated user demand justifies its parser and error-handling surface.

### 16.4 Deferred Commands

```bash
agentlift benchmark
agentlift marketplace
agentlift dashboard
```

These commands are not reserved for MVP behavior and must not appear in the
initial public documentation as available features.

## 17. Runtime Architecture

### 17.1 Components

```text
CLI
├── Manifest loader
├── Experiment planner
├── Workspace manager
├── RuntimeAdapter
│   └── GenericCommandRuntime
├── ExtensionAdapter
│   └── StdioMcpExtension
├── Trace normalizer
├── Validator engine
├── Statistics and decision engine
└── Evidence bundle renderer
```

`RuntimeAdapter` launches the Agent, sends the task, and collects normalized
output. `ExtensionAdapter` validates, installs, enables, disables, and removes
the tested extension. The two responsibilities must not be combined in a
single generic runner.

### 17.2 Generic Command Runner Protocol

AgentLift invokes the subject Agent through a user-provided command.

Input is JSONL:

```json
{"type":"run.start","runId":"run_123","workspace":"/tmp/...","task":{"id":"case_1","prompt":"Fix the race condition"},"model":{"name":"example-model"},"mcpConfig":null}
```

Candidate mode includes a temporary MCP configuration:

```json
{"type":"run.start","runId":"run_124","workspace":"/tmp/...","task":{"id":"case_1","prompt":"Fix the race condition"},"model":{"name":"example-model"},"mcpConfig":{"servers":[{"name":"candidate","transport":"stdio","command":["node","./dist/server.js"]}]}}
```

The runner emits normalized or mappable JSONL events:

```json
{"type":"run.start","runId":"run_124","condition":"candidate"}
{"type":"tool.call","name":"candidate.search","arguments":{"query":"..."}}
{"type":"tool.result","name":"candidate.search","status":"ok"}
{"type":"validation","validator":"command","success":true}
{"type":"run.end","status":"completed"}
```

The current runner contract requires exit code zero and exactly one final
`run.end`, whose status is `completed` or `failed`. Explicit Agent failure
and ordinary nonzero command-validator exits are task failures. Runner nonzero
exit, command startup/input failure, timeout, output overflow, validator signal
termination, and invalid or missing terminal events are infrastructure failures.
Normalized `validation` events are generated by AgentLift.

Infrastructure failures retain structured reasons and valid preceding events.
They do not stop later runs; Runtime failure skips validators for that run.
The CLI writes the report before exiting nonzero if any run is invalid.
Configuration, fixture-safety, setup, and storage errors remain fatal.

### 17.3 Source Layout

The first implementation remains one TypeScript package with internal modules:

```text
src/
├── cli/
├── experiment/
├── runtimes/
├── extensions/
├── validators/
├── events/
├── analysis/
└── report/
```

Runtime Adapters or evaluators become separate workspace packages only when
they require independent release and versioning.

### 17.4 OpenAI-compatible Model Interface

MVP supports one model-provider contract:

- OpenAI-compatible base URL;
- API key by environment-variable reference;
- explicit model name;
- temperature and token budget;
- resolved model identity when the provider exposes it.

AgentLift does not proxy or store the API key.

The first reference runner uses non-streaming Chat Completions with function
tools (`POST <base-url>/chat/completions`). It supports one stdio MCP through
the official SDK and uses the existing Generic Command JSONL contract.
The task prompt and tool results are the model inputs; the final text is written
to a new workspace `result.txt`. No implicit repository reading or editing is provided.

Optional model settings are `temperature`, `maxTokens` (per request, default
2048), `maxTurns` (default 8), and `requestTimeoutMs` (default 30000).
The outer execution timeout still caps the run. Model usage and returned model
identity are recorded as `model.usage`; absent counts remain `null`.
No price estimates, automatic HTTP retries, or redirects are supported.
Model credentials are not automatically inherited by MCP.

The runnable sample is `examples/openai-agentlift.yaml`; the task fixture is
synthetic. Acceptance currently uses a local simulated provider plus real stdio
processes. Live-provider compatibility remains an external validation milestone.

## 18. MCP Lifecycle

For every candidate run:

1. `StdioMcpExtension` validates the command and allowed environment.
2. The Extension Adapter installs an experiment-local configuration.
3. Baseline calls `disable`; Candidate calls `enable`.
4. `GenericCommandRuntime` runs the Agent with that temporary configuration.
5. AgentLift captures MCP tool events and transport failures.
6. The Runtime Adapter terminates the entire process group on completion or
   timeout.
7. The Extension Adapter removes temporary configuration.
8. AgentLift removes the temporary workspace.

Baseline runs must not expose the candidate MCP server.

## 19. Workspace Isolation

### 19.1 Default Behavior

- Never execute in the original repository.
- Create an independent temporary repository copy for each run.
- Keep baseline and candidate copies separate.
- Exclude ignored files and secrets by default.
- Exclude uncommitted changes unless explicitly included.
- Use a temporary HOME and Agent configuration root.
- Reject fixture and workspace symbolic links.
- Restrict inherited environment variables to an explicit allowlist.
- Cap captured stdout and stderr and mark overflow as infrastructure failure.
- Apply timeouts to every external command and terminate its process tree.
- Do not modify global Git or Agent configuration.
- Never auto-apply candidate changes.

### 19.2 Integrity Check

Before and after the experiment, record:

- original repository commit;
- working-tree status;
- configured file digest set;
- global configuration digest where safe.

Any unexpected original-workspace modification invalidates the experiment.

### 19.3 External Side Effects

Workspace isolation does not isolate external systems.

MVP guidance requires:

- test credentials;
- mock or disposable services;
- explicit environment allowlists;
- no production tokens;
- extension-specific side-effect documentation.

Optional network disable is exposed only when the selected isolation backend
can enforce it. AgentLift must not claim network isolation when running in the
default process-only mode. Untrusted projects require an explicit warning
before command execution.

## 20. Privacy and Redaction

### 20.1 Capture Modes

| Mode | Data |
|---|---|
| metadata | metrics, hashes, statuses, validator results |
| redacted | metadata plus redacted event summaries |
| full | prompts, tool inputs/outputs, logs, patches |

Default: `redacted`.

### 20.2 Secret Handling

- Secret values are never serialized.
- Environment variables are referenced by name.
- Known credential patterns are redacted from logs.
- Reports list redaction counts.
- Full capture requires explicit consent.

## 21. CI Policy

### 21.1 Purpose

CI turns AgentLift from a one-off test into a release regression gate.

### 21.2 Example

```bash
agentlift ci \
  --evidence ./agentlift-results/latest \
  --min-success-delta-pp=-5 \
  --max-cost-increase-pct=20 \
  --max-tool-error-rate=0.02
```

### 21.3 Policy Rules

- Typed thresholds operate on normalized result fields.
- Unknown or missing values do not silently become zero.
- Infrastructure-invalid runs can fail or skip according to explicit policy.
- The CI output includes the exact failed evidence.

## 22. MVP Scope

### 22.1 W3 Alpha

- local CLI;
- `agentlift impact`;
- Generic Command Agent protocol;
- one OpenAI-compatible model interface;
- stdio MCP candidate;
- YAML task suites;
- deterministic command validators;
- paired AB/BA-balanced execution;
- repeated runs;
- minimal normalized Trace;
- temporary repository and configuration isolation;
- JSON and terminal reports.

### 22.2 Beta Target

- `agentlift compare`, `agentlift doctor`, and typed-flag `agentlift ci`;
- JSONL task suites;
- file, diff, JSON Schema, and trace validators;
- optional secondary LLM judge interface;
- direct sample counts, absolute and relative effects, and intervals;
- simple tool sequence/argument/result diff and first observable divergence;
- MCP lifecycle and overhead metrics;
- Markdown report;
- portable evidence bundle.

### 22.3 Excluded

- Skill evaluation;
- multiple native Agent adapters;
- multi-agent systems;
- model and Agent benchmark product modes;
- web UI;
- hosted storage;
- automatic evaluation-engine selection;
- Promptfoo, Inspect AI, and AutoGenBench adapters;
- marketplace;
- leaderboard;
- complex security score;
- automatic task generation;
- checkpoint counterfactual replay;
- role contribution attribution;
- distributed execution.

## 23. Roadmap

| Time | Goal | Acceptance gate |
|---|---|---|
| W1 | Technical Spike | Fake Agent and Fake MCP complete one isolated A/B run |
| W2-W3 | Minimal vertical slice | `agentlift impact` produces Terminal and JSON results |
| W3 | Alpha release | At least two external users complete one run |
| W4-W5 | Trustworthy experiment | Repeats, AB/BA balance, effects, and intervals |
| W5-W6 | Failure explanation | Tool-sequence diff and first observable divergence |
| W7 | Evidence bundle | Report rebuilds offline and contains no secrets |
| W8 | CI and hardening | Linux/macOS pass process and workspace safety tests |
| W9-W10 | Beta and ecosystem proof | Two real MCP cases and a five-minute Quick Start |

The W1 Spike must answer five questions before framework work continues:

1. Can AgentLift inject a temporary stdio MCP?
2. Can it run the same task without and with that MCP?
3. Can it restore an identical initial workspace?
4. Can it terminate the entire MCP process tree?
5. Can it produce a structured task result?

Failure to close this loop by the end of W1 triggers a product-assumption
review, not more framework construction. If external evidence arrives early,
Beta may ship in W8; elapsed roadmap time is not a reason to add scope.

Broader Skill evaluation, additional native Agent adapters, and ecosystem integrations begin
only after real MCP usage validates demand.

## 24. Success Metrics

### 24.1 Activation

- Median time to first valid smoke report: <=10 minutes.
- At least 80% of users who pass `doctor` complete the example experiment.
- At least two external users complete the W3 Alpha without maintainer edits.

### 24.2 Trust

- Original-workspace modification incidents: zero.
- Every decision includes sample count, effect, interval, and exclusions.
- Every report identifies the exact tested versions.
- Re-rendered reports match the canonical JSON decision.

### 24.3 Product Value

- Users can complete their first own-suite experiment within 15 minutes.
- Users have task suites they expect to reuse.
- Reports change at least some enable/disable decisions.
- Interviews identify whether success, cost, compatibility, or explanation is
  the dominant need.
- Users explicitly indicate whether they would add the experiment to CI.
- Percentage of experiments resulting in a bounded enable/disable decision.
- Percentage of users who rerun after an MCP version change.
- Number of MCP projects using AgentLift in CI.
- Number of regressions detected before release.

### 24.4 Community

- Number of reusable public task suites.
- Number of third-party Generic Command runners.
- Time required to reproduce a published evidence bundle.
- GitHub stars are tracked as a distribution signal, not a quality metric.

## 25. Risks and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Product remains too broad | weak execution | MCP-only MVP |
| Generic runner requires setup | onboarding friction | reference runner and offline demo |
| Model nondeterminism | false conclusions | pairing, repeats, intervals, failures |
| LLM judge bias | misleading decision | optional only, deterministic gates dominant |
| MCP changes Agent context | confounded result | record schema/context overhead explicitly |
| External tool side effects | unsafe experiment | test credentials, allowlists, mocks |
| Trace formats vary | weak explanation | one normalized MVP protocol |
| Cost grows quickly | user distrust | plan preview and hard budgets |
| Report overgeneralizes | misuse | mandatory task and version scope |
| Evidence leaks data | privacy incident | redacted default, no secret serialization |

## 26. Open Decisions

1. License.
2. Published npm package name.
3. Exact OpenAI-compatible API subset.
4. Default repeat counts for standard and release modes.
5. Default practical quality and overhead thresholds.
6. Bootstrap implementation and random seed recording.
7. Canonical expanded Trace schema after the five-event minimum.
8. Evidence bundle archive format.
9. Default local retention period.
10. Whether the reference LLM judge ships in MVP or only the interface ships.
11. Minimum MCP protocol versions.

## 27. MVP Acceptance Criteria

The MVP is ready for public beta only when:

1. A fresh user can run the reference experiment within ten minutes.
2. Baseline and candidate use the same repository snapshot.
3. The original workspace remains unchanged under adversarial tests.
4. The candidate MCP is absent from baseline configuration.
5. The candidate MCP starts and stops without leaked child processes.
6. Agent, model, MCP, task, and validator versions are locked.
7. Run ordering is AB/BA-balanced and recorded.
8. Repeated paired outcomes produce sample counts, effects, and intervals.
9. Deterministic hard-gate failures cannot be overridden by the LLM judge.
10. Reports include improved, regressed, and invalid cases.
11. Trace Diff identifies added, removed, and changed tool calls.
12. The evidence bundle can render a report without rerunning the Agent.
13. JSON, Markdown, and terminal outputs agree on the decision.
14. CI can fail on a declared regression policy.
15. Missing metrics are shown as unavailable, never zero.
16. No secret value appears in the evidence bundle.
17. Insufficient evidence produces `INCONCLUSIVE`.
18. Environment inheritance is allowlisted and uses temporary HOME/XDG roots.
19. Fixture symlinks and path escapes are rejected.
20. stdout/stderr overflow is bounded and reported as infrastructure failure.
21. Optional network isolation is labeled unavailable unless actively enforced.
22. Untrusted-project execution requires an explicit warning.

## 28. Future Skill Evaluation

Skill evaluation will reuse the same experiment model:

```text
Baseline:  no Skill
Candidate: temporary Skill injection
```

Additional Skill metrics:

- instruction-context overhead;
- correct activation;
- false activation;
- instruction conflict;
- task-category lift;
- model and Agent sensitivity.

Broader Skill support begins only after the MCP vertical workflow meets MVP acceptance
criteria.

## 29. Glossary

- **Agent extension**: An MCP server or, later, a Skill that changes Agent
  behavior or available capabilities.
- **Baseline**: The subject Agent without the candidate extension.
- **Candidate**: The same subject Agent with the candidate extension.
- **Case**: One task, fixture, validator set, and task tags.
- **Suite**: A versioned collection of cases.
- **Task Contract**: The frozen task, objective, constraints, validators, and
  budget.
- **Paired run**: Baseline and candidate executions matched by case and run
  block.
- **Effect size**: The measured baseline/candidate difference.
- **Evidence bundle**: The portable manifest, lock file, results, traces,
  failures, and report for an experiment.
- **Hard gate**: A condition whose failure cannot be offset by other metrics.
- **Regression**: A case where candidate behavior is materially worse than
  baseline.
- **Trace Diff**: A comparison of normalized baseline and candidate execution
  events.
- **Net value**: Quality benefit considered together with cost, latency,
  reliability, and risk overhead.
