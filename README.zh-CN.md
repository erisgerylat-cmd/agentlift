# AgentLift

[English](./README.md) | 简体中文

**衡量 Agent 扩展带来的真实影响。**

AgentLift 是一个本地优先的实验工具，用于比较同一个 Agent 在“未启用扩展”和
“启用扩展”两种条件下的任务表现，从而判断一个 MCP Server 或 Skill 是否真正
提高了任务成功率，以及这种提升是否值得新增的成本、耗时和风险。

当前版本支持 stdio MCP，并以 Claude Code 为首个原生宿主支持基础 Skill 影响实验。
多 Agent、在线平台和复杂评测能力留待实际使用反馈后迭代。

## 为什么需要 AgentLift

仅凭一次成功演示，无法证明一个 MCP 在真实任务中值得启用。常见问题包括：

- Baseline 与 Candidate 使用了不同的初始工作区；
- Agent、模型、扩展或任务版本在实验期间发生变化；
- 只展示平均分，没有展示失败样本和不确定性；
- MCP 提高了成功率，但同时显著增加 Token、延迟或工具错误；
- 扩展在不该触发的简单任务中误触发；
- 结果无法复现，也不能作为发布或 CI 的证据。

AgentLift 将这些问题转换为受控的成对实验：

```text
Baseline:  Agent + Model + Tasks，不启用待测扩展
Candidate: 相同 Agent + Model + Tasks，仅启用待测扩展
```

原则上，两组之间只能存在一个处理变量：待测扩展是否启用。

## 当前状态

当前为 `0.0.1-prototype` 本地 CLI 人工验收版，完整操作说明见
[PROTOTYPE.md](./PROTOTYPE.md)。主链路为 `doctor → impact → report → compare → ci`：

Claude Code 可分别运行“无扩展 vs Skill”和“无扩展 vs MCP”。先执行
`npm run demo:claude` 验证离线链路，再配置认证并运行 `npm run impact:claude:skill`
或 `npm run impact:claude:mcp`。详细步骤与验证边界见
[Claude Code 测试指南](./CLAUDE-CODE.zh-CN.md)。

执行 `npm run prototype:claude` 可验收包含扩展退化与 CI 拦截的完整闭环；
`agentlift workflow --config <file>` 串联预检、A/B、证据校验、报告、
可选历史比较与 CI。工作区模式支持编辑代码并用确定性测试验收。

- Generic Command Agent；
- Claude Code 原生 Runtime，支持文本和显式配置工具的代码修改任务；
- OpenAI-compatible 文本任务参考 Runner（本地 HTTP/stdio 联调已通过）；
- stdio MCP Extension；
- YAML/JSONL 任务集；
- 确定性命令验证器；
- Baseline/Candidate 成对运行；
- AB/BA 平衡执行顺序；
- 最小规范化 Trace；
- Terminal 与 JSON 结果；
- Case 聚类 Bootstrap、描述性 Wilson 区间、保守启用建议；
- 证据包、Markdown 离线报告、工具序列差异、历史比较和 CI 门禁；
- 临时工作区、临时 HOME 和环境变量白名单；
- stdout/stderr 大小限制、Secret 脱敏和进程树清理。

内置演示使用小样本合成任务，虽然展示区间，决策仍为 `INCONCLUSIVE`。
只有样本数、统计证据和成本预算均满足要求，才会产生启用建议。

## 快速开始

### 环境要求

- Node.js 22 或更高版本；
- npm。

### 安装并运行示例

```bash
npm ci
npm run prototype:claude
```

该命令使用离线 Claude CLI 替身与真实 stdio MCP 连接，完成正常及退化 Skill/MCP
四组实验，校验报告重建、历史比较与 CI 门禁，无需安装 Claude 或配置 API Key。
运行后打开 `.agentlift/claude-workflow/ACCEPTANCE.json` 查看报告位置。
每组正常 Candidate `4/4`、退化 Candidate `2/4`，历史变化 `-50pp`，
CI 为 PASS 和预期 FAIL。这些合成任务仅验证链路，不证明真实模型或扩展收益。

OpenAI-compatible 离线原型仍可通过 `npm run prototype` 运行。

### 使用真实 Claude Code

安装官方 Claude Code，在终端配置 `ANTHROPIC_API_KEY`，或自行通过
`claude setup-token` 生成 `CLAUDE_CODE_OAUTH_TOKEN`。运行使用临时 HOME 和 Claude
配置，不自动继承个人交互登录；真实模型调用会产生费用。

```bash
npm run build
node dist/cli.js workflow --config examples/claude/skill.yaml
node dist/cli.js workflow --config examples/claude/mcp.yaml
node dist/cli.js compare .agentlift/claude-skill .agentlift/claude-mcp
```

替换 Skill 路径或 MCP 命令，提供自己的 Fixture 和确定性验证器即可测试实际扩展。
工作区模式可启用编辑工具并用项目测试验收。报告保留工具参数/结果差异、Token/成本、
最终回答、文件变更哈希和标注任务触发/误触发率。`workflow` 支持历史 `--before`
及与 `ci` 相同的显式阈值。具体配置见 [Claude Code 指南](./CLAUDE-CODE.zh-CN.md)。

也可运行较小的 `npm run demo`，预期输出包括：

```text
Decision: INCONCLUSIVE
Pairs: 4; valid: 4; excluded: 0
Baseline: 2/4 successful
Candidate: 4/4 successful
Infrastructure failures: 0
Observed delta: 50pp
95% lift interval: 0 to 100pp
```

较小 Demo 的最近一次结构化结果写入：

```text
.agentlift/results.json
```

每次实验另有 `.agentlift/<experimentId>/` 独立目录，包含 JSON、Markdown、Trace、
环境锁与校验清单。历史数据不会因运行下一个实验而覆盖。

### 如何理解示例结果

- `Pairs: 4; valid: 4; excluded: 0`：四个配对的两侧均无基础设施故障；
- `Baseline: 2/4 successful`：未启用 MCP 的四次运行中，两次通过确定性验证；
- `Candidate: 4/4 successful`：启用 MCP 后四次运行全部通过；
- `Infrastructure failures: 0`：没有超时、进程异常或输出溢出等基础设施失败；
- `Observed delta: 50pp`：候选组成功率比基线组高 50 个百分点；
- `INCONCLUSIVE`：当前只有两个 Case，区间不能作为稳定增益的证明。

## 当前执行流程

```text
tasks.yaml
    |
    v
AgentLift workflow / impact
    |-- GenericCommandRuntime 或 ClaudeCodeRuntime
    |-- StdioMcpExtension 或 ClaudeSkillExtension
    |     Baseline: 禁用；Candidate: 启用
    v
确定性验证器
    v
可校验证据包 + 离线报告
    v
历史比较 + CI 门禁
```

示例 Candidate 会执行真实的 MCP JSON-RPC 生命周期：

```text
initialize -> tools/list -> tools/call
```

这不是通过伪造工具调用结果实现的演示。Fake Agent 会真正启动 Fake MCP
子进程、完成初始化、发现工具并调用工具。

## 运行顺序

AgentLift 对同一个 Case 使用 AB/BA 平衡顺序，降低缓存、限流和时间漂移造成的顺序
偏差：

```text
奇数轮：Baseline -> Candidate
偶数轮：Candidate -> Baseline
```

当前示例每个 Case 重复两轮，因此实际顺序为：

```text
Baseline -> Candidate -> Candidate -> Baseline
```

## 最小 Trace

当前垂直闭环只定义五类必要事件：

```text
run.start
tool.call
tool.result
validation
run.end
```

AgentLift 会过滤 Runtime 重复产生的 `run.start`、`validation` 和 `run.end`，
再生成顺序稳定的规范化事件。OpenAI-compatible 参考 Runner 额外输出 `model.usage`
事件，记录 Provider 返回的 Token 数与模型身份；缺失指标为 `null`。复杂的语义
Trace 对齐尚未实现；Claude Code 已输出 `file.change`、`agent.result` 和
`skill.activation` 证据。简单工具序列与首个可观察差异已保存在
`analysis.json`；Token 成本可根据显式单价估算。

## 配置文件

示例配置位于 [`examples/agentlift.yaml`](./examples/agentlift.yaml)。

```yaml
version: 1
kind: extension-impact

subject:
  runner:
    protocol: jsonl
    command:
      - node
      - ./fake-agent.mjs
  model:
    provider: openai-compatible
    baseUrlEnv: FAKE_MODEL_BASE_URL
    apiKeyEnv: FAKE_MODEL_API_KEY
    name: deterministic-fake-model

candidate:
  type: mcp
  name: fake-review
  transport: stdio
  command:
    - node
    - ./fake-mcp.mjs
  envAllowlist: []

suite:
  file: ./tasks.yaml

execution:
  repeats: 2
  order: ab-ba-balanced
  timeoutMs: 5000

security:
  envAllowlist: []
  maxOutputBytes: 1048576
  network: inherit

storage:
  capture: redacted
  output: ../.agentlift
```

### 主要字段

| 字段 | 说明 |
|---|---|
| `subject.runner.command` | 启动 Generic Command Agent 的 argv 数组 |
| `subject.runner.protocol` | `jsonl` 或 `claude-code` |
| `subject.runner.resultMode` | Claude 使用 `text` 保存回答，`workspace` 验证文件修改 |
| `subject.runner.tools` / `allowedTools` | Claude 可用工具与免交互授权规则 |
| `subject.model` | 模型接口和模型身份；当前示例使用确定性 Fake Model |
| `candidate.command` | 启动 stdio MCP Server 的 argv 数组 |
| `candidate.path` | Skill 目录，包含 name 与配置匹配的 SKILL.md |
| `candidate.envAllowlist` | 只传递给 Candidate MCP 的环境变量名称 |
| `suite.file` | YAML 任务集路径，相对于配置文件解析 |
| `execution.repeats` | 每个 Case、每个条件的重复次数 |
| `execution.order` | 当前固定为 `ab-ba-balanced` |
| `execution.timeoutMs` | 每个外部命令的超时时间 |
| `security.envAllowlist` | 允许 Runtime 继承的额外环境变量名称 |
| `security.maxOutputBytes` | stdout 和 stderr 各自允许捕获的最大字节数 |
| `security.network` | 当前仅支持 `inherit`，表示没有网络隔离 |
| `storage.output` | 结果输出目录 |

命令必须使用 argv 数组，不通过 Shell 字符串拼接执行，从而避免不必要的转义和注入
问题。

## 任务集

示例任务集位于 [`examples/tasks.yaml`](./examples/tasks.yaml)。

```yaml
version: 1

cases:
  - id: review-race-condition
    task: Review the repository and report the race condition.
    fixture:
      path: ./fixture
    validators:
      - type: command
        command:
          - node
          - check-result.mjs
          - RACE_FOUND
```

每个 Case 包含：

- `id`：稳定且可用于路径的 Case 标识；
- `task`：发送给 Agent 的任务描述；
- `fixture.path`：初始工作区模板；
- `validators`：用于判断任务是否成功的确定性验证器。

AgentLift 不直接在 fixture 中运行 Agent。每次运行都会创建独立临时副本，Baseline
和 Candidate 不共享可写工作区。

## 运行结果分类

每次运行会得到以下三种结果之一：

| 结果 | 含义 |
|---|---|
| `task_success` | Runtime 退出码为零，终态为 `completed`，所有确定性验证器通过 |
| `task_failure` | Runtime 正常退出且终态为 `failed`，或命令验证器以非零退出码拒绝结果 |
| `infrastructure_failure` | 启动/输入失败、Runner 非零退出、超时、输出溢出、验证器被信号终止，或 JSONL 协议错误 |

Generic Command Runner 必须输出唯一的最终 `run.end` 事件，`status` 只能是 `completed` 或 `failed`。
终态缺失、重复、状态非法，或终态后继续输出事件，都属于协议故障。Runner 声明任务
失败时应以退出码零完成协议；进程非零退出被解释为运行基础设施故障。

Claude Runtime 会转换原生 stream-json 终态；有效的轮次/预算耗尽为任务失败，
即使进程以数值非零退出。认证/API 故障仍排除整对实验。

进程或协议故障不会中断后续 Case。故障发生前已解析的事件仍保留；Runtime 故障时，
跳过该次运行的验证器，并写入 `validation` 事件说明跳过原因。

成功次数与提升值只使用**有效配对**：同一 Case、同一重复轮次的 Baseline/Candidate
必须都没有基础设施故障。任意一侧故障时，两侧都从成功率分母排除，原始结果仍保留在
`runs`。`summary.validPairs` 记录有效配对数，`summary.excludedPairs` 记录被排除的
Case、轮次、运行 ID、条件、阶段和失败原因。

没有有效配对时，`successRateDeltaPp` 为 `null`，终端显示 `unavailable`，避免把
“没有可比较证据”误报成“提升为零”。当前所有 Smoke 决策仍为 `INCONCLUSIVE`。

存在基础设施故障时，CLI 会先写入报告再以退出码 `1` 结束；只有确定性任务失败时，
Smoke 命令仍以零退出。实验配置错误、重复 Case ID、不安全 Fixture、准备阶段或结果
存储错误仍会终止命令，不会被静默转换为任务失败。

失败原因在 `runtime.failure` 或 `validators[].failure` 中以 `{code, message}`
记录，无基础设施错误时为 `null`：

| `code` | 含义 |
|---|---|
| `spawn_error` | 无法启动命令 |
| `stdin_error` | 任务输入无法完整发送给进程 |
| `timeout` | 超过命令时间限制 |
| `output_limit` | stdout 或 stderr 超过捕获上限 |
| `process_exit` | Runner 非零退出，或验证器被信号终止 |
| `protocol_error` | Runner 输出不符合 JSONL/终态约定 |

`runtime.agentStatus` 保留可解析的 Agent 终态，和 AgentLift 最终 `outcome` 分开。

## OpenAI-compatible 参考 Runner

参考 Runner 通过现有 `GenericCommandRuntime` 接入。它支持文本问答任务：将任务
Prompt 发送给模型，按需调用 Candidate MCP，再把最终文本写入临时工作区的
`result.txt`，供命令验证器检查。它不会自动读取仓库文件，也不提供 Shell 或文件编辑
工具，适用于先验证模型、MCP 与确定性验证器的连接是否正确。

### 运行方式

1. 在 Shell 中配置 `MODEL_BASE_URL` 和 `MODEL_API_KEY`。Base URL 是 Provider
   的 API 前缀，例如其 `/v1` 地址；不要把凭证值写进 YAML。
2. 打开 [examples/openai-agentlift.yaml](./examples/openai-agentlift.yaml)，
   将 `subject.model.name` 改为支持函数工具调用的模型名称。
3. 执行 `npm run impact:openai`，自动构建后运行模型实验。

该命令会把 Prompt 和工具结果发送给所配置的 Provider，可能产生模型费用。
示例使用 Fake MCP 和 [合成任务集](./examples/openai-tasks.yaml)，用于检查链路；
其提升值不能证明真实 MCP 的产品收益。结果写入 `.agentlift/openai/results.json`。
原有 `npm run demo` 仍完全离线，不需要模型凭证。

### 接口与限制

- 入口为 `dist/runners/openai.js`；请求采用非流式
  `POST <MODEL_BASE_URL>/chat/completions`。
- Baseline 不发送 `tools`；Candidate 通过官方 MCP SDK 连接一个 stdio Server，
  完成初始化及工具发现，支持 `tools/list` 分页。
- MCP 工具名转换为模型函数别名，调用时映射回原名；参数在调用 MCP 前经过 JSON
  Schema 校验，不合法的调用会作为工具错误返回模型。
- `isError` 工具结果允许模型重试或调整答案；MCP 传输/JSON-RPC 故障使运行无效。
- 最终答案只写入新的 `result.txt`，已有文件不覆盖，符号链接会被拒绝。
- 默认最多 8 轮模型请求；耗尽轮数为任务失败，不伪造答案。
- 禁止自动重试付费请求和 HTTP 重定向；Provider HTTP 错误正文不会写入日志。
- HTTP 响应、Runner 输入、MCP 单条消息/工具结果和累计 stderr 上限为 1 MiB；
  累计模型请求体上限为 4 MiB。最多发现 128 个工具、16 页，每次模型响应最多 32 次调用。

`subject.model` 可选字段：

| 字段 | 默认值 | 说明 |
|---|---|---|
| `temperature` | 不发送 | 两组共用的采样参数 |
| `maxTokens` | `2048` | 每次请求的 `max_tokens`，不是整个实验的总预算 |
| `maxTurns` | `8` | 每次运行最多请求模型的轮数 |
| `requestTimeoutMs` | `30000` | 每个 HTTP/MCP 请求超时；外层 `execution.timeoutMs` 仍限制整次运行 |
| `inputPricePerMillion` | 不可用 | 每百万输入 Token 的美元单价 |
| `outputPricePerMillion` | 不可用 | 每百万输出 Token 的美元单价 |

模型凭证只在 Agent 中读取，不自动传给 MCP。MCP 继承运行目录变量和命令搜索路径，
以及 `candidate.envAllowlist` 显式列出的变量。采集事件会脱敏已知凭证值；模型请求
正文仍包含完成任务所需的数据，因此应选择允许处理这些数据的 Provider。

当前验证使用本地模拟 Provider 和真实 stdio 子进程，尚未完成付费模型实测。
Responses API、流式输出、多模态、多个 MCP Server 和通用仓库编辑均不在首版范围。

## 隔离与安全边界

当前已实现：

- 每次运行使用独立临时工作区；
- 原始 fixture 不作为 Agent 工作目录；
- 使用临时 `HOME`、`TMPDIR` 和 XDG 目录；
- 只继承固定运行环境和显式白名单中的环境变量；
- 拒绝 fixture 与工作区中的符号链接；
- 限制 stdout/stderr 捕获大小，溢出时终止进程树；
- 对每个外部命令设置超时；
- 在进程正常结束、失败和超时时清理进程组；
- 对已知环境变量值进行递归脱敏；
- 不修改用户全局 Agent、Git 或 MCP 配置。

当前尚未提供：

- 操作系统级文件系统沙箱；
- 网络禁用；
- Docker/Podman 严格隔离；
- 对外部 API、数据库或云资源副作用的自动回滚。

因此，`network: inherit` 表示子进程继承主机网络能力，**不代表网络隔离**。不要使用
生产凭证运行不可信项目；严格隔离模式将在后续阶段实现。

## 项目结构

```text
src/
├── cli.ts
├── config.ts
├── impact.ts
├── workflow.ts
├── process.ts
├── security.ts
├── types.ts
├── models/
│   ├── config.ts
│   └── openai-compatible.ts
├── runners/
│   ├── openai.ts
│   ├── mcp-launch.ts
│   └── mcp-tools.ts
├── analysis/
│   ├── summary.ts
│   ├── report.ts
│   ├── extensions.ts
│   └── commands.ts
├── evidence/
│   ├── environment.ts
│   ├── bundle.ts
│   └── workspace.ts
├── runtimes/
│   ├── runtime-adapter.ts
│   ├── generic-command.ts
│   └── claude-code.ts
└── extensions/
    ├── extension-adapter.ts
    ├── stdio-mcp.ts
    └── claude-skill.ts

examples/
├── agentlift.yaml
├── openai-agentlift.yaml
├── openai-tasks.yaml
├── tasks.yaml
├── fake-agent.mjs
├── fake-mcp.mjs
├── claude/
└── fixture/

test/
├── claude-code.test.ts
├── failure-evidence.test.ts
├── openai-runner.test.ts
└── impact.test.ts
```

职责边界：

- `RuntimeAdapter`：启动 Agent、输入任务、采集输出；
- `ExtensionAdapter`：验证、安装、启用、禁用和卸载扩展；
- `impact.ts`：实验编排，不承载具体 Agent 或 MCP 注入逻辑；
- `process.ts`：命令执行、超时、输出限制和进程树清理；
- `security.ts`：路径检查、临时环境和 Secret 脱敏。
- `analysis/summary.ts`：按 Case/轮次配对，记录排除原因并计算有效配对的观察值。
- `models/`：模型配置与有边界的 Chat Completions 请求；
- `runners/`：参考 Agent 的模型调用循环与 MCP 工具管理。

## 开发命令

```bash
# 编译 TypeScript
npm run build

# 运行测试
npm test

# 编译并运行全部测试
npm run check

# 运行离线示例
npm run demo

# Claude 正常/退化 Skill/MCP 完整闭环验收
npm run prototype:claude
```

当前测试覆盖：

- 完整 Baseline/Candidate MCP 垂直闭环；
- AB/BA 执行顺序；
- 最小 Trace 顺序；
- stdout 输出上限；
- Secret 值及对象键脱敏；
- fixture 符号链接拒绝；
- JSONL 协议故障、进程启动失败与后续任务继续执行；
- Agent 失败终态、命令验证器拒绝与基础设施故障的区分；
- 有效配对分母、零有效样本、结果落盘和 CLI 退出码；
- 验证器超时/信号/输出溢出与输入管道提前关闭；
- 重复 Case ID 拒绝及临时工作区清理；
- 参考 Runner 的真实 HTTP/stdio 成对实验、工具参数校验和凭证隔离；
- Provider 失败、请求超时、响应大小限制、重定向拒绝和工具循环终止。
- Claude Skill 注入、MCP 凭证隔离、代码修改验收、文件证据和扩展触发门禁。

完整构建及 32 项自动化测试、原有 Demo 和 Claude 闭环验收已通过。

## 当前限制

- 支持 Generic Command 和 Claude Code Runtime；
- 只支持 stdio MCP；
- 支持 YAML/JSONL 任务集，确定性验证器目前为命令验证器；
- 已实现 Wilson 与 Case 聚类 Bootstrap，正式建议另用 Case 级符号检验；
- 已有显式定价成本估算和模型标识变化检测，无法证明 Provider 内部版本完全锁定；
- Trace Diff 只比较工具事件顺序及首个参数/结果差异，不做通用语义对齐；
- 已在 macOS 验证，当前环境未执行 Linux 验收；
- 进程隔离适用于可信命令，不等同于操作系统文件/网络沙箱；
- LLM Judge、更多验证器、容器后端、Web UI 属于后续扩展；
- Claude Code 支持文本/工作区编辑模式；Codex、Qoder 和 Trae 尚未接入；
- Skill 影响评估目前仅支持 Claude Code，真实模型调用待人工验收。

## 路线图摘要

1. W1：完成 Fake Agent + Fake MCP 隔离 A/B 技术 Spike；
2. W2-W3：完成最小 `agentlift impact` 垂直闭环；
3. W3：发布 Alpha，并让至少两位外部用户完成实验；
4. W4-W5：加入重复运行、效果量和置信区间；
5. W5-W6：加入工具序列 Diff 和首个可观察分歧点；
6. W7：生成可离线重建的证据包；
7. W8：加入 CI 与 Linux/macOS 安全加固；
8. W9-W10：通过两个真实 MCP 案例验证 Beta。

完整产品范围、统计规则、安全门槛和验收条件请阅读：

- [产品需求文档（简体中文）](./PRD.zh-CN.md)
- [Product Requirements Document (English)](./PRD.md)
