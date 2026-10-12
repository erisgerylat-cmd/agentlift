# Claude Code Skill / MCP 测试

[English](./CLAUDE-CODE.md)

## 完整基础闭环

```bash
npm run prototype:claude
```

此命令离线执行 Skill/MCP 正常与退化四组实验，覆盖
`doctor → impact → 校验并重建 report → compare → ci`，正常组 PASS，
退化组 FAIL，历史 Candidate 成功率下降 50pp。证据入口为
`.agentlift/claude-workflow/ACCEPTANCE.json`。不调用真实模型。

真实运行可直接使用一个命令：

```bash
node dist/cli.js workflow --config examples/claude/skill.yaml \
  --min-success-delta-pp=0 --min-activation-rate=1 --max-false-activation-rate=0
node dist/cli.js workflow --config examples/claude/mcp.yaml \
  --before .agentlift/claude-skill --min-success-delta-pp=0
```

`workflow` 预检失败退出 2，不开始实验；验证完成后保留独立证据和 `workflow.json`，
CI PASS/FAIL/数据不可用分别退出 0/1/2。`--before` 可选，比较历史实验。
任务的 `extensionExpected: true/false` 分别标注预期调用与控制任务，未标注时触发率为
unavailable。指标只使用有效配对中的观察调用，不能当作指令遵从证明。

## 代码修改任务

在 Claude 配置的 `subject.runner` 中增加：

```yaml
resultMode: workspace
tools: [Read, Glob, Grep, Skill, Edit, Write, Bash]
allowedTools: [Read, Glob, Grep, Skill, Edit, Write, "Bash(node --test *)"]
```

指定 `suite.file: ./code-tasks.yaml` 可试用代码修复示例，验证器运行
`node --test sum.test.mjs`。正式任务应换为自己的 Fixture 和项目测试。
`tools` 限定可用工具，`allowedTools` 控制免交互授权，其余调用由 `dontAsk` 拒绝；
没有自动跳过权限。工作区模式不生成或覆盖 result.txt，用文件修改完成任务。
`artifacts.json` 保存最终回答与添加/修改/删除文件的哈希清单，并纳入校验清单；
不打包修改文件全文。`.claude`、`.git`、node_modules 不计入文件变更指标。
验证器与 Agent 均在每次运行的临时 Fixture 副本中运行，结束后清理。

在同一 Claude Code、模型、任务集上分别运行“无扩展 vs Skill”和“无扩展 vs stdio MCP”。
每个 Case 重复两轮，使用 AB/BA 顺序，共八次 Claude Code 调用。两份配置使用相同任务，
因此也可通过 `compare` 比较 Skill 和 MCP 的 Candidate 表现。

## 先检查离线链路

需要 Node.js 22+，在仓库根目录执行：

```bash
npm ci
npm run check
npm run demo
npm run demo:claude
```

最后一条使用离线 CLI 替身并实际启动 stdio MCP，无模型费用。两组预期均为
Baseline 2/4、Candidate 4/4、提升 50pp、零基础设施故障、`INCONCLUSIVE`。
这验证接入契约，不代表 Claude Code 的真实能力。报告分别保存在
`.agentlift/claude-offline-skill` 和 `.agentlift/claude-offline-mcp`。

## 用本机 Claude Code 验收

先安装官方 Claude Code，并检查 CLI 支持 `--output-format stream-json`、
`--setting-sources`、`--strict-mcp-config`、`--no-session-persistence`、
`--permission-mode dontAsk`。建议使用最新稳定版本：

```bash
claude --version
claude --help
npm run build
```

AgentLift 使用临时 HOME 与 `CLAUDE_CONFIG_DIR`，不读取或写入你的个人 Claude 配置。
已有交互登录不会自动传入。认证任选一种：

- API Key：在运行终端设置 `ANTHROPIC_API_KEY`。
- 订阅 OAuth：自行执行 `claude setup-token`，将返回值设置为 `CLAUDE_CODE_OAUTH_TOKEN`。
  示例已经将此变量加入白名单。

不要把凭证写进 YAML、提交记录或反馈截图。可在终端隐藏输入：

```bash
read -s ANTHROPIC_API_KEY
export ANTHROPIC_API_KEY
```

默认模型为 `sonnet`，可在两份 YAML 中改为相同的完整模型 ID。CLI 不支持的
`temperature`、`maxTokens`、`requestTimeoutMs` 配置会被拒绝。

```bash
node dist/cli.js doctor --config examples/claude/skill.yaml
node dist/cli.js doctor --config examples/claude/mcp.yaml
npm run impact:claude:skill
npm run impact:claude:mcp
```

`doctor` 只检查配置、命令、Fixture 和凭证变量存在性，不验证网络、凭证有效性或 CLI
版本兼容性。真实运行会产生模型费用。两组共十六次调用，`timeoutMs` 默认为单次三分钟。

```bash
node dist/cli.js report .agentlift/claude-skill
node dist/cli.js report .agentlift/claude-mcp
node dist/cli.js compare .agentlift/claude-skill .agentlift/claude-mcp
node dist/cli.js ci --evidence .agentlift/claude-skill --min-success-delta-pp=0
```

真实模型结果可能偏离离线预期。检查报告中的有效配对、Case 结果、工具序列和
`traces.jsonl`。Skill 实验额外显示观察到的 `Skill` 工具调用次数；注入成功不等于实际调用，
调用事件也不证明 Skill 指令被正确遵守。Token 包含输入、输出及缓存输入，
成本优先使用 Claude CLI 返回的估算值；缺失数据保持 unavailable。

## 替换为自己的扩展和任务

Skill 配置的 `candidate.path` 指向包含 `SKILL.md` 的目录，`candidate.name`
必须匹配 frontmatter `name`。目录会先冻结，再仅注入 Candidate 的
`.claude/skills/<name>`，支持同目录参考文件。Baseline 不注入，也不会获得 Skill 正文提示。

MCP 配置保留 `type: mcp` / `transport: stdio`，替换 `command`、`cwd` 和
`envAllowlist`。MCP 由独立启动器设置工作目录，只接收基础隔离环境及显式白名单变量，
不会自动继承 Claude 的认证凭证。

相对路径以 YAML 所在目录解析。替换 `suite.file`，为每个任务提供干净 Fixture 和确定性
验证命令。Claude 最终回答保存为 `result.txt` 后执行验证器，已有 `result.txt` 不会被覆盖。
默认 Runtime 面向读取、审查与文本结果；工作区模式可显式启用编辑与 Bash 工具。
`allowedTools` 仅调整可用工具的免交互授权，不扩大 `tools` 集合。

Fixture 不得包含 `.claude`、`.mcp.json`、`.claude.json`、`CLAUDE.md`、`CLAUDE.local.md`
或符号链接，以免污染对照。Skill 源与 Fixture 在实验后核对哈希；不修改全局配置。
禁用用户/项目设置来源、Hooks、内置 Skills、自动记忆，并对 MCP 使用严格显式配置。
主机管理策略、CLI 系统提示与版本仍可能影响实验；这不是文件系统或网络沙箱。

## 反馈与边界

当前已验证离线 CLI 契约和真实 stdio MCP 联调，未执行真实付费 Claude Code 模型调用。
示例是合成任务，不能用于证明业务收益；小样本结论保持 `INCONCLUSIVE`。
已支持标注任务的观察触发率与误触发率；Skill 冲突和上下文开销的专门统计留待后续。
`authentication: none` 仅用于离线 CLI 替身，跳过凭证预检，不给真实 Claude 提供认证。

遇到异常时提供 Claude 版本、使用的配置、退出码、脱敏后的报告与具体 Case。
认证/API/进程/协议故障会排除整个配对；轮次耗尽或验证不通过记为任务失败。
Ctrl+C 会终止进程组并清理临时工作区。已完成实验的证据保留在 `.agentlift`。
