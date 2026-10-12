# Claude Code Skill / MCP evaluation

[简体中文](./CLAUDE-CODE.zh-CN.md)

Run baseline vs Skill and baseline vs stdio MCP with the same Claude Code, model
and task suite. Each experiment runs two cases twice in AB/BA order: eight CLI
calls. `compare` can also compare the candidate outcomes across both experiments.

## Offline verification

From the repository root with Node.js 22+:

```bash
npm ci
npm run check
npm run demo
npm run demo:claude
```

The last command uses an offline CLI fixture and a real stdio MCP connection.
Each experiment should produce baseline 2/4, candidate 4/4, +50pp, no
infrastructure failures and `INCONCLUSIVE`. This verifies the integration
contract, not Claude's quality. Evidence goes to `.agentlift/claude-offline-skill`
and `.agentlift/claude-offline-mcp`.

## Live Claude Code acceptance

Install official Claude Code, preferably the latest stable release. It must
support stream-json, setting-sources, strict-mcp-config, no-session-persistence
and permission-mode dontAsk:

```bash
claude --version
claude --help
npm run build
```

Runs use temporary HOME and CLAUDE_CONFIG_DIR without loading or changing personal
Claude settings. Interactive login is not automatically inherited. Set either
`ANTHROPIC_API_KEY` or an OAuth token from your own `claude setup-token` command
as `CLAUDE_CODE_OAUTH_TOKEN`. The examples allowlist the latter. Never store
credentials in YAML, Git or feedback screenshots. Hidden terminal input:

```bash
read -s ANTHROPIC_API_KEY
export ANTHROPIC_API_KEY
```

Both configs default to `sonnet`; replace it with the same full model ID when
available. Unsupported temperature, maxTokens and requestTimeoutMs overrides
are rejected.

```bash
node dist/cli.js doctor --config examples/claude/skill.yaml
node dist/cli.js doctor --config examples/claude/mcp.yaml
npm run impact:claude:skill
npm run impact:claude:mcp
```

`doctor` checks configuration, executables, fixtures and credential presence.
It does not validate the network, authentication or CLI version compatibility.
Live runs incur model costs: sixteen calls for both configs with a three-minute
timeout per call.

```bash
node dist/cli.js report .agentlift/claude-skill
node dist/cli.js report .agentlift/claude-mcp
node dist/cli.js compare .agentlift/claude-skill .agentlift/claude-mcp
node dist/cli.js ci --evidence .agentlift/claude-skill --min-success-delta-pp=0
```

Live outcomes may differ. Inspect valid pairs, case outcomes, tool sequences and
traces.jsonl. Skill reports count observed Skill tool calls. Installation does
not prove invocation, and invocation does not prove correct instruction
following. Tokens include cache input; costs use CLI estimates when available.
Missing measurements stay unavailable.

## Bring your extension

For Skills, point candidate.path at a folder containing SKILL.md with frontmatter
name matching candidate.name. The source is frozen and copied only into candidate
`.claude/skills/<name>`; supporting files are included. Baseline receives the same
task without Skill content or installation.

For MCP, keep type mcp / transport stdio and replace command, cwd and
envAllowlist. A launcher sets the server cwd and passes only basic isolated
environment plus explicitly allowed variables, not Claude authentication.
Paths resolve relative to the YAML file.

Replace suite.file with your clean fixtures and deterministic validators.
Final text is written to result.txt before validation; existing result files
are never overwritten. Available tools are Read, Glob, Grep, Skill and candidate
MCP tools. This runtime evaluates reading/review/text tasks, not repository
editing. allowedTools controls automatic permissions within that set.

Fixtures must not include .claude, .mcp.json, .claude.json, CLAUDE.md,
CLAUDE.local.md or symlinks. Fixture and Skill source hashes are checked after
each experiment. User/project setting sources, hooks, bundled skills and auto
memory are disabled; MCP configuration is explicit and strict. Managed policy,
CLI system prompts and versions may still influence results. This is not a
filesystem or network sandbox.

## Validation scope and feedback

Offline CLI contracts and actual stdio MCP connections are verified. Live paid
Claude Code calls have not been executed. Synthetic examples do not establish
business impact; small samples remain INCONCLUSIVE. Dedicated activation rates,
false triggering, conflicts and context overhead statistics are deferred.

Report CLI version, config, exit code, redacted evidence and affected case.
API/auth/process/protocol failures exclude the whole pair. Turn exhaustion or
validator rejection is task failure. Ctrl+C terminates the process group and
cleans temporary workspaces; completed evidence remains in .agentlift.
