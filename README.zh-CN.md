# AgentLift

[English](./README.md) | 简体中文

**衡量 Agent 扩展带来的真实影响。**

AgentLift 是一个本地优先的实验工具，用于比较同一个 Agent 在“未启用扩展”和
“启用扩展”（即对配置变化前后效果的对比实现对配置改动价值的评估）两种条件下的任务表现，从而判断一个 MCP Server 或 Skill 是否真正
提高了任务成功率，以及这种提升是否值得新增的成本、耗时和风险。

当前版本优先支持 stdio MCP。Skill、多 Agent、在线平台和复杂评测能力将在 MCP
垂直闭环被真实用户验证后再考虑。

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

项目处于早期开发阶段，已经完成 W1 技术 Spike 和一个可离线运行的最小垂直闭环：

- Generic Command Agent；
- stdio MCP Extension；
- YAML 任务集；
- 确定性命令验证器；
- Baseline/Candidate 成对运行；
- AB/BA 平衡执行顺序；
- 最小规范化 Trace；
- Terminal 与 JSON 结果；
- 临时工作区、临时 HOME 和环境变量白名单；
- stdout/stderr 大小限制、Secret 脱敏和进程树清理。

当前输出属于 **Smoke 结果**。它用于验证技术链路，不提供统计置信区间，因此决策
固定为 `INCONCLUSIVE`，不能直接作为正式启用建议。

## 快速开始

### 环境要求

- Node.js 22 或更高版本；
- npm。

### 安装并运行示例

```bash
npm install
npm run demo
```

预期输出：

```text
Valid pairs: 4; excluded pairs: 0
Baseline: 2/4 successful
Candidate: 4/4 successful
Infrastructure failures: 0
Observed delta: 50pp
Decision: INCONCLUSIVE (smoke run; no confidence interval yet)
```

结构化结果会写入：

```text
.agentlift/results.json
```

### 如何理解示例结果

- `Valid pairs: 4; excluded pairs: 0`：四个配对的两侧均无基础设施故障；
- `Baseline: 2/4 successful`：未启用 MCP 的四次运行中，两次通过确定性验证；
- `Candidate: 4/4 successful`：启用 MCP 后四次运行全部通过；
- `Infrastructure failures: 0`：没有超时、进程异常或输出溢出等基础设施失败；
- `Observed delta: 50pp`：候选组成功率比基线组高 50 个百分点；
- `INCONCLUSIVE`：当前只是小样本 Smoke 实验，没有置信区间，不能过度解读。

## 当前执行流程

```text
tasks.yaml
    |
    v
AgentLift impact
    |-- GenericCommandRuntime
    |     启动 Agent、输入任务、收集 JSONL
    |
    `-- StdioMcpExtension
          |-- Baseline: 禁用 MCP
          `-- Candidate: 启用 MCP
                    |
                    v
              确定性验证器
                    |
                    v
              results.json
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
再生成顺序稳定的规范化事件。复杂的语义 Trace 对齐、模型 Token 事件和文件变更
事件尚未实现。

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
| `subject.runner.protocol` | 当前仅支持 `jsonl` |
| `subject.model` | 模型接口和模型身份；当前示例使用确定性 Fake Model |
| `candidate.command` | 启动 stdio MCP Server 的 argv 数组 |
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

Runner 必须输出唯一的最终 `run.end` 事件，`status` 只能是 `completed` 或 `failed`。
终态缺失、重复、状态非法，或终态后继续输出事件，都属于协议故障。Runner 声明任务
失败时应以退出码零完成协议；进程非零退出被解释为运行基础设施故障。

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
├── process.ts
├── security.ts
├── types.ts
├── analysis/
│   └── summary.ts
├── runtimes/
│   ├── runtime-adapter.ts
│   └── generic-command.ts
└── extensions/
    ├── extension-adapter.ts
    └── stdio-mcp.ts

examples/
├── agentlift.yaml
├── tasks.yaml
├── fake-agent.mjs
├── fake-mcp.mjs
└── fixture/

test/
├── failure-evidence.test.ts
└── impact.test.ts
```

职责边界：

- `RuntimeAdapter`：启动 Agent、输入任务、采集输出；
- `ExtensionAdapter`：验证、安装、启用、禁用和卸载扩展；
- `impact.ts`：实验编排，不承载具体 Agent 或 MCP 注入逻辑；
- `process.ts`：命令执行、超时、输出限制和进程树清理；
- `security.ts`：路径检查、临时环境和 Secret 脱敏。
- `analysis/summary.ts`：按 Case/轮次配对，记录排除原因并计算有效配对的观察值。

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
- 重复 Case ID 拒绝及临时工作区清理。

## 当前限制

- 只支持 Generic Command Runtime；
- 只支持 stdio MCP；
- 只支持 YAML 任务集和命令验证器；
- 尚未计算 Wilson 区间、Bootstrap 区间或 McNemar 检验；
- 尚未采集真实模型 Token、成本和版本漂移；
- 尚未实现 Trace Diff、证据包、历史比较和 CI 门禁；
- 尚未提供原生 Claude Code、Codex、Qoder 或 Trae Adapter；
- 尚未支持 Skill 影响评估。

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
