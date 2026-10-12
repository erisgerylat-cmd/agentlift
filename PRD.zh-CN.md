# AgentLift 产品需求文档

[English](./PRD.md) | 简体中文

> 状态：待评审草案
> 版本：0.3
> 更新日期：2026-10-10
> 产品名称：AgentLift（GitHub 仓库已创建，npm 包名可用性尚未确认）

实现检查点：`0.0.1-prototype` 已覆盖 `doctor`、`impact`、离线 `report`、
`compare`、`ci` 核心链路。启动与验收步骤见 [原型说明](./PROTOTYPE.md)。
本文后续章节仍包含 Beta 目标；更多验证器、LLM Judge、容器隔离、Skill 和 Web UI
不在当前原型中。当前区间采用固定种子的 Case 聚类 Bootstrap 和 Case 级符号检验，
不会自动对任务子组给出条件启用建议。

## 1. 执行摘要

AgentLift 是一个本地优先的实验工具，用于衡量 Agent 扩展是否创造了真实的净价值。

第一阶段只支持 MCP Server。只有当 MCP 工作流经过真实用户验证后，才扩展到 Skill
评估。

产品只回答一个核心问题：

> 启用这个 MCP 或 Skill 后，任务质量提升了多少？这种提升是否值得新增的成本、
> 延迟、复杂度和风险？

AgentLift 运行受控的 Baseline/Candidate 成对实验：

```text
Baseline:  Agent + Model + Tasks，不启用待测扩展
Candidate: 相同 Agent + Model + Tasks，仅启用待测扩展
```

实验最终应输出：

- 成对任务结果；
- 效果量与置信区间；
- 失败和退化样本；
- Baseline/Candidate Trace 差异；
- 扩展带来的额外成本；
- 有明确适用边界的启用建议；
- 可复现、可移植的证据包；
- 可选的 CI 回归门禁。

AgentLift 不是通用模型排行榜，也不是覆盖所有 Agent 的综合 Benchmark 平台。模型和
Agent 只是实验变量，不是并列产品线。

## 2. 产品定位

### 2.1 一句话定位

> AgentLift 验证 Agent 扩展是否真正改善任务结果。

### 2.2 英文标语

> Measure the real impact of agent extensions.

### 2.3 产品类别

Agent 扩展影响评估与回归测试工具。

### 2.4 产品承诺

AgentLift 提供公平、可复现、可解释的实验，并支持以下真实决策：

- 建议启用；
- 只在特定任务类型或约束下启用；
- 不建议启用；
- 证据不足，暂时无法判断。

### 2.5 核心差异

现有评测工具通常只报告分数。AgentLift 关注净影响和决策支持：

```text
任务质量收益
- 成本增量
- 延迟增量
- 失败和安全风险
= 特定任务范围内的扩展价值
```

AgentLift 的价值不取决于接入了多少评测引擎，而取决于实验是否可信，以及结论能否
帮助用户做出启用、限制或停用扩展的决定。

## 3. 问题定义

Agent 用户和扩展开发者目前缺少可靠的方法回答：

- 这个 MCP 是否提高了真实任务的完成率？
- 哪些任务类型得到改善？
- 哪些任务类型出现退化？
- 扩展是否在应该触发时触发？
- 扩展是否在不该触发时误触发？
- 它增加了多少上下文、Token、延迟和工具调用？
- 观察到的提升能否在重复运行中保持稳定？
- 扩展升级是否引入了回归？
- 其他开发者或 CI 是否可以复现结果？

常见做法存在以下不足：

- 把一次成功演示当成普遍有效的证据；
- Baseline 与 Candidate 使用不同的初始环境；
- Agent、模型或扩展版本在实验期间漂移；
- 只展示平均分，不展示失败和异常样本；
- 手工查看 Trace，难以稳定解释差异；
- 在证明价值前就修改全局配置或安装扩展；
- 实验结果无法复用为发布或回归证据。

## 4. 目标用户

### 4.1 主要用户：MCP 开发者

在发布 MCP 前，需要证明它能改善目标工作流的开发者。

核心任务：

- 比较新 MCP 版本与“不启用 MCP”条件；
- 发现质量、成本或兼容性退化；
- 发布可复现的影响报告；
- 在关键任务退化时阻止发布。

### 4.2 主要用户：Agent 高级用户

正在考虑是否安装某个 MCP 或 Skill 的开发者。

核心任务：

- 在不改变全局配置的情况下试用扩展；
- 了解扩展在哪些任务中有效或有害；
- 根据证据决定是否启用。

### 4.3 次要用户：Agent 平台团队

维护组织内部扩展白名单或标准扩展集合的团队。

核心任务：

- 用内部任务集验证扩展升级；
- 定义 CI 回归策略；
- 保存长期、可审计的历史证据。

## 5. 目标

### 5.1 用户目标

- 十分钟内完成第一次有效影响实验；
- 不修改正常工作区和全局 Agent 配置；
- 获得有边界的决策，而不是只有原始指标；
- 能够检查失败和退化 Case；
- 能在本地或 CI 中复现实验；
- 能长期比较不同扩展版本。

### 5.2 产品目标

- 默认保证 Baseline/Candidate 比较公平；
- 每项结论都能追溯到原始证据；
- 明确处理 Agent 输出的随机性；
- 解释行为从哪里开始分歧以及为什么分歧；
- MVP 保持本地优先、CLI 优先；
- 通过 CI 支持持续使用，而不是一次性跑分。

### 5.3 项目目标

- 在扩展大量集成前，先完成一个可信的垂直闭环；
- 保持核心实现易于理解和扩展；
- 建立能支持后续生态工具的证据包格式。

## 6. 非目标

MVP 不做以下事项：

- 通用模型排行榜；
- 广泛的 Agent Benchmark；
- 多 Agent 框架自动路由；
- 托管式 Web Dashboard；
- 扩展市场；
- 多 Agent 角色贡献归因；
- Shapley Value 等复杂贡献分析；
- 复杂安全评分；
- 将 Candidate 扩展安装到用户全局环境；
- 自动把 Agent 修改应用到原始仓库；
- 使用 LLM Judge 作为唯一决策依据；
- 用一个任务或一次运行宣称扩展具有普遍价值。

## 7. 产品原则

1. **只回答一个核心问题。**
   每个功能都必须服务于“这个扩展是否值得启用”。

2. **一次实验只改变一个处理变量。**
   Baseline 与 Candidate 只能在待测扩展是否启用这一点上不同。

3. **优先使用成对证据。**
   对同一个 Case、同一个初始快照比较 Baseline 和 Candidate。

4. **结果优先于完全相同的轨迹。**
   只要满足任务约束，不同工具路径可以同样有效。

5. **硬失败不能被平均值掩盖。**
   安全违规、数据破坏和必选验证器失败必须单独报告。

6. **不使用模糊置信度标签。**
   直接展示样本量、效果量、区间、失败和排除项。

7. **`INCONCLUSIVE` 是合法结论。**
   证据不足时不得强行给出启用建议。

8. **必须解释差异。**
   报告应指出首个可观察分歧点，以及哪些 Case 改善或退化。

9. **本地优先且操作可逆。**
   实验不能永久改变用户环境。

10. **证据可移植。**
    每个完整实验都应生成独立证据包。

## 8. 主要用户流程

### 8.1 最小命令

```bash
agentlift impact ./mcp-server --suite ./evals/tasks.yaml
```

### 8.2 执行流程

1. 检测并验证实验配置；
2. 解析 Agent、模型、扩展和任务版本；
3. 展示计划运行次数、预估成本和时间预算；
4. 创建成对的 Baseline/Candidate 工作区；
5. 按 AB/BA 平衡顺序运行两种条件；
6. 收集规范化 Trace 和资源指标；
7. 执行确定性验证器；
8. 可选执行经过校准的 LLM Judge；
9. 计算成对效果量与置信区间；
10. 标记改善、退化和不稳定 Case；
11. 生成启用决策和证据包；
12. 清理临时资源。

### 8.3 Terminal 输出示例

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

## 9. 实验契约

### 9.1 配置示例

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

### 9.2 锁定变量

实验清单必须锁定：

- 仓库快照；
- 任务集与 Case 哈希；
- Agent 命令和版本；
- 模型 Provider 和解析后的模型 ID；
- 模型参数；
- 扩展内容哈希；
- 扩展配置；
- 验证器版本；
- 环境变量白名单；
- 运行预算；
- 执行顺序策略。

### 9.3 处理变量

MCP MVP 的处理变量定义为：

```text
Baseline:  Candidate MCP 不可用
Candidate: 通过临时 stdio 配置提供 Candidate MCP
```

其他重要变量不得发生变化。

## 10. 任务集

### 10.1 YAML 示例

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

### 10.2 JSONL 示例

```json
{"id":"find-race-condition","task":"Find and fix the race condition.","fixture":{"path":"./fixtures/order-service","commit":"abc123"},"validators":[{"type":"command","run":"go test -race ./...","required":true}]}
{"id":"formatting-control","task":"Normalize formatting only.","fixture":{"path":"./fixtures/order-service","commit":"def456"},"tags":["negative-control"]}
```

### 10.3 Case 类型

- 扩展应该产生帮助的正向目标 Case；
- 扩展不应触发的负向对照 Case；
- 边界 Case；
- 历史真实失败；
- 对成本敏感的简单任务；
- 权限与副作用 Case。

### 10.4 任务来源优先级

1. 历史真实失败及修复前快照；
2. 真实仓库加受控变异；
3. 手工编写的 Fixture；
4. 自动生成任务，只作为补充覆盖。

## 11. 验证器

### 11.1 确定性验证器

MVP 规划的验证器类型：

- 命令退出状态；
- 测试结果；
- 文件是否存在；
- JSON Schema；
- Diff 范围；
- 禁止路径修改；
- 结构化外部状态探针；
- 规范化 Trace 断言。

只要存在可用的必选确定性验证器，它们就定义主要任务成功标准。

### 11.2 可选 LLM Judge

LLM Judge 是可选的次要证据。

规则：

- 确定性失败仍然是失败；
- Judge 不能覆盖硬门槛；
- 被评估输出需要匿名化；
- Baseline/Candidate 的 Judge 展示顺序需要随机化；
- Rubric 必须在实验前冻结；
- Judge 模型和 Prompt 版本必须锁定；
- Judge 证据必须单独标记；
- 未校准的 Judge 结果不能独立产生 `ENABLE`。

MVP 可以只提供 Judge 接口和一个参考实现，但完整实验必须能够在没有 LLM Judge 的
情况下运行。

## 12. 决策模型

### 12.1 决策状态

| 决策 | 含义 |
|---|---|
| `ENABLE` | 在声明的任务范围内，有证据支持净收益 |
| `ENABLE_CONDITIONALLY` | 只在特定标签或约束下存在收益 |
| `DO_NOT_ENABLE` | 损害、成本或不稳定性超过已证明收益 |
| `INCONCLUSIVE` | 证据不足或实验不可比较 |

### 12.2 决策输入

- 主要任务成功率效果；
- 置信区间；
- 硬门槛违规；
- 按任务标签划分的子组效果；
- Token 和成本增量；
- 延迟增量；
- 工具和传输失败率；
- 不必要触发率；
- 缺失或被排除的证据。

### 12.3 实际阈值

决策阈值必须显式声明并保存在实验清单中：

```yaml
decision:
  minimumQualityLiftPp: 5
  nonInferiorityMarginPp: 3
  maximumTokenOverheadPct: 20
  maximumLatencyOverheadPct: 25
  maximumUnnecessaryActivationRate: 0.05
```

### 12.4 有任务边界的建议

建议必须说明：

- 适用的任务类别；
- 测试使用的 Agent 和模型；
- 扩展版本；
- 质量效果；
- 额外成本；
- 已知退化；
- 停用或回滚条件。

AgentLift 不得将结论泛化到未测试范围。

## 13. 统计设计

### 13.1 成对设计

Baseline 与 Candidate 按以下维度配对：

- Case；
- Fixture 快照；
- 运行 Block；
- Agent 和模型配置；
- 验证器版本。

执行顺序在成对 Block 中保持平衡：

```text
奇数轮：Baseline -> Candidate
偶数轮：Candidate -> Baseline
```

实验还应记录缓存状态、Provider 限流信号、解析后的模型身份，以及可检测到的模型版本
漂移。未来可以在平衡 Block 内增加随机化，但不能破坏顺序平衡。

### 13.2 报告统计量

每项主要比较都应展示：

- 有效样本量；
- Baseline 与 Candidate 事件数；
- 绝对效果量和相对效果量；
- 95% 置信区间；
- 被排除的运行及原因；
- 每个 Case 的结果；
- 可检查的失败样本。

主要成功次数和观察到的提升只使用两侧均无基础设施故障的配对。任意一侧无效时，
排除整个 Case/轮次配对，保留两侧原始运行并报告全部排除原因。有效配对为零时，
提升显示为不可用（`null`），不能显示为零。

### 13.3 默认统计方法

| 指标 | 方法 |
|---|---|
| 成对二元成功结果 | 成对 Bootstrap 效果区间；Exact McNemar 作为辅助证据 |
| 通过率 | Wilson 区间 |
| Token、延迟、工具调用数 | 成对中位数差和 Bootstrap 区间 |
| 子组结果 | 相同方法，并明确较小样本量 |
| 多个子组检验 | 正式声明时使用 Holm 校正 |

少量样本下的 Bootstrap 区间只用于描述，不代表稳定效果已经得到证明。确定性通过率和
LLM Judge 分数必须分开报告，不能合成一个总分。

### 13.4 不使用模糊置信等级

MVP 不展示 `HIGH`、`MEDIUM` 或 `LOW`。

直接展示证据：

```text
n = 120 paired runs
effect = +14.2pp
95% CI = [+5.1pp, +23.0pp]
excluded = 3 infrastructure failures
```

### 13.5 保守决策规则

初始规则保持严格：

- `ENABLE`：成功率区间下界高于零，并且测得的成本在用户预算内；
- `DO_NOT_ENABLE`：成功率显著下降，或出现安全、权限硬门槛违规；
- `INCONCLUSIVE`：样本不足、区间跨越零，或成对证据不可比较。

`ENABLE_CONDITIONALLY` 只能用于有足够证据的明确任务子组。Smoke 运行始终返回
`INCONCLUSIVE`。

### 13.6 运行模式

| 模式 | 默认用途 |
|---|---|
| `smoke` | 验证配置和链路，不产生正式决策 |
| `standard` | 日常本地比较 |
| `release` | 发布和 CI 证据 |

报告必须明确标注非决策级实验。

## 14. 失败解释

### 14.1 Trace Diff

垂直闭环首先只定义五类规范化事件：

- `run.start`；
- `tool.call`；
- `tool.result`；
- `validation`；
- `run.end`。

后续可以增加 `model.usage`、`tool.discovery` 和 `file.change`。

初始 Trace 分析只做：

- 事件类型统计；
- 工具调用序列 Diff；
- 工具参数变化；
- 工具结果变化；
- 首个可观察分歧点；
- 最长公共子序列或简单阶段对齐。

通用语义 Trace 对齐明确延后。不同 Agent 轨迹可能都有效，过早解决通用轨迹对齐会
把项目变成独立研究课题。

### 14.2 MCP 专项解释

报告应衡量：

- MCP 启动是否成功及启动时间；
- 初始化和能力协商；
- Tool Schema 大小；
- Schema 占用的模型上下文；
- 工具调用成功率；
- 无效参数率；
- 传输失败；
- 重复调用；
- 已暴露但从未使用的工具；
- 权限和副作用违规；
- 关闭和清理失败。

### 14.3 Case 分类

每个 Case 分类为：

- 改善；
- 成功保持不变；
- 失败保持不变；
- 退化；
- 不稳定；
- 基础设施无效。

### 14.4 解释语言

推荐：

> Candidate 在第 3 步调用 `web_search` 后首次发生分歧。10 次 Candidate 运行中有
> 8 次出现该调用，这些运行的输入 Token 增加 21%，并违反了只使用仓库内证据的
> 任务约束。

避免：

> MCP 可能让 Agent 产生了困惑。

解释应引用可观察证据，不对模型内部原因做无根据推测。

## 15. 证据包

### 15.1 目录结构

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

至少记录：

- 操作系统和架构；
- Node 版本；
- Agent 和 MCP 命令及版本；
- Git Commit 和工作区状态；
- 解析后的模型 ID 及可获得的版本信息；
- ExperimentSpec 哈希；
- Task Suite 哈希；
- Adapter 版本；
- 验证器版本；
- 重复次数和随机种子；
- 隔离模式和网络策略；
- 环境变量名称，不记录值；
- AgentLift 版本。

### 15.3 可移植性

证据包必须：

- 在不重新运行实验的情况下生成报告；
- 标识缺失的私有输入；
- 校验 Artifact 哈希；
- 提供复现命令；
- 不存储 Secret。

## 16. CLI

### 16.1 核心命令

```bash
agentlift impact <extension> --suite <suite>
```

### 16.2 辅助命令

```bash
agentlift compare <experiment-a> <experiment-b>
agentlift doctor
agentlift ci
```

### 16.3 示例

```bash
agentlift impact ./mcp-server --suite ./evals/review.yaml

agentlift compare ./results/v1 ./results/v2

agentlift doctor

agentlift ci \
  --min-success-delta-pp=-5 \
  --max-cost-increase-pct=20 \
  --max-tool-error-rate=0.05
```

首版 CI 使用类型明确的参数。表达式 DSL 延后，只有在出现足够用户需求后才引入解析器
和对应错误处理。

### 16.4 延后命令

```bash
agentlift benchmark
agentlift marketplace
agentlift dashboard
```

这些命令不属于 MVP，不应在初始公开文档中表现为可用功能。

## 17. 运行时架构

### 17.1 组件

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

`RuntimeAdapter` 负责启动 Agent、发送任务和采集规范化输出。

`ExtensionAdapter` 负责验证、安装、启用、禁用和卸载待测扩展。

两类职责不能重新合并成一个承担进程、配置和扩展注入的 Generic Runner。

### 17.2 Generic Command Runner 协议

AgentLift 通过用户提供的命令启动 Agent。

输入为 JSONL：

```json
{"type":"run.start","runId":"run_123","workspace":"/tmp/...","task":{"id":"case_1","prompt":"Fix the race condition"},"model":{"name":"example-model"},"mcpConfig":null}
```

Candidate 条件包含临时 MCP 配置：

```json
{"type":"run.start","runId":"run_124","workspace":"/tmp/...","task":{"id":"case_1","prompt":"Fix the race condition"},"model":{"name":"example-model"},"mcpConfig":{"servers":[{"name":"candidate","transport":"stdio","command":["node","./dist/server.js"]}]}}
```

Runner 输出可规范化的 JSONL 事件：

```json
{"type":"run.start","runId":"run_124","condition":"candidate"}
{"type":"tool.call","name":"candidate.search","arguments":{"query":"..."}}
{"type":"tool.result","name":"candidate.search","status":"ok"}
{"type":"validation","validator":"command","success":true}
{"type":"run.end","status":"completed"}
```

当前 Runner 契约要求退出码为零，且只有一个最终 `run.end`，状态为 `completed`
或 `failed`。Agent 明确声明失败，以及普通命令验证器非零退出，属于任务失败。
Runner 非零退出、命令启动/输入失败、超时、输出溢出、验证器被信号终止及非法或缺失
终态，属于基础设施失败。规范化 `validation` 事件由 AgentLift 生成。

基础设施故障保留结构化原因及此前的有效事件，后续运行继续；Runtime 故障时跳过
该次验证器。存在无效运行时，CLI 先写入报告，再以非零退出码结束。配置、Fixture
安全、准备阶段和结果存储错误仍属于终止实验的错误。

### 17.3 源码布局

首版使用一个 TypeScript 包，通过内部模块组织：

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

只有 Runtime Adapter 或 Evaluator 出现独立发布和版本管理需求时，才拆分为 Workspace
Package。

### 17.4 OpenAI-Compatible 模型接口

MVP 只支持一种 Provider 契约：

- OpenAI-Compatible Base URL；
- 通过环境变量名称引用 API Key；
- 显式模型名称；
- Temperature 和 Token Budget；
- Provider 能提供时记录解析后的模型身份。

AgentLift 不代理或存储 API Key。

首个参考 Runner 使用非流式 Chat Completions 函数工具接口
（`POST <base-url>/chat/completions`），通过官方 SDK 连接一个 stdio MCP，
复用现有 Generic Command JSONL 契约。模型输入为任务 Prompt 与工具结果，
最终文本写入工作区新建的 `result.txt`，不隐式读取或编辑仓库文件。

模型可选参数为 `temperature`、`maxTokens`（每次请求默认 2048）、
`maxTurns`（默认 8）和 `requestTimeoutMs`（默认 30000）。
外层执行超时仍限制整次运行。Provider 返回的模型身份和 Token 数记录为
`model.usage`，缺失计数为 `null`；不估算价格，不自动重试 HTTP 请求或跟随重定向。
模型凭证不会自动传递给 MCP。

可运行示例为 `examples/openai-agentlift.yaml`，使用合成任务 Fixture。
当前验收采用本地模拟 Provider 和真实 stdio 进程，真实 Provider 兼容性仍需外部验证。

## 18. MCP 生命周期

每次 Candidate 运行：

1. `StdioMcpExtension` 验证命令和允许的环境变量；
2. Extension Adapter 安装实验局部配置；
3. Baseline 调用 `disable`，Candidate 调用 `enable`；
4. `GenericCommandRuntime` 使用临时配置运行 Agent；
5. AgentLift 收集 MCP 工具事件和传输错误；
6. Runtime Adapter 在正常完成或超时时终止整个进程组；
7. Extension Adapter 删除临时配置；
8. AgentLift 删除临时工作区。

Baseline 运行不得接触 Candidate MCP Server。

## 19. 工作区隔离

### 19.1 默认行为

- 永不在原始仓库中执行 Agent；
- 每次运行创建独立临时仓库副本；
- Baseline 与 Candidate 使用不同的可写副本；
- 默认排除被忽略文件和 Secret；
- 除非显式选择，否则不包含未提交修改；
- 使用临时 HOME 和 Agent 配置根目录；
- 拒绝 Fixture 与工作区符号链接；
- 继承的环境变量必须经过显式白名单；
- 限制 stdout/stderr，溢出标记为基础设施失败；
- 所有外部命令都有超时并清理进程树；
- 不修改全局 Git 或 Agent 配置；
- 不自动把 Candidate 修改应用到原仓库。

### 19.2 完整性检查

实验前后记录：

- 原始仓库 Commit；
- 工作区状态；
- 配置范围内的文件摘要；
- 在安全情况下记录全局配置摘要。

任何未预期的原始工作区修改都会使实验无效。

### 19.3 外部副作用

工作区隔离不等于外部系统隔离。

MVP 要求：

- 使用测试凭证；
- 使用 Mock 或一次性服务；
- 使用明确的环境变量白名单；
- 禁止生产 Token；
- 文档化扩展特有的副作用。

只有在所选隔离后端可以真正执行网络限制时，才显示“禁用网络”选项。默认进程模式下
不得宣称已经实现网络隔离。执行不可信项目之前必须显示明确警告。

## 20. 隐私与脱敏

### 20.1 捕获模式

| 模式 | 数据 |
|---|---|
| `metadata` | 指标、哈希、状态和验证器结果 |
| `redacted` | Metadata 加脱敏事件摘要 |
| `full` | Prompt、工具输入输出、日志和 Patch |

默认模式为 `redacted`。

### 20.2 Secret 处理

- Secret 值不得序列化；
- 环境变量只记录名称；
- 日志中的已知凭证模式需要脱敏；
- 报告列出脱敏次数；
- `full` 捕获需要用户显式同意。

## 21. CI 策略

### 21.1 目的

CI 将 AgentLift 从一次性实验转变为发布回归门禁。

### 21.2 示例

```bash
agentlift ci \
  --evidence ./agentlift-results/latest \
  --min-success-delta-pp=-5 \
  --max-cost-increase-pct=20 \
  --max-tool-error-rate=0.02
```

### 21.3 策略规则

- 类型明确的阈值作用于规范化结果字段；
- 未知或缺失指标不能静默转换为零；
- 基础设施无效运行按显式策略决定失败或跳过；
- CI 输出必须包含触发失败的确切证据。

## 22. MVP 范围

### 22.1 W3 Alpha

- 本地 CLI；
- `agentlift impact`；
- Generic Command Agent 协议；
- 一个 OpenAI-Compatible 模型接口；
- stdio MCP Candidate；
- YAML 任务集；
- 确定性命令验证器；
- AB/BA 平衡成对执行；
- 重复运行；
- 最小规范化 Trace；
- 临时仓库和配置隔离；
- JSON 与 Terminal 报告。

### 22.2 Beta 目标

- `agentlift compare`、`agentlift doctor` 和参数式 `agentlift ci`；
- JSONL 任务集；
- 文件、Diff、JSON Schema 和 Trace 验证器；
- 可选的次要 LLM Judge 接口；
- 样本量、绝对/相对效果量和区间；
- 简单工具序列、参数、结果 Diff 和首个可观察分歧点；
- MCP 生命周期和成本指标；
- Markdown 报告；
- 可移植证据包。

### 22.3 排除项

- Skill 评估；
- 多个原生 Agent Adapter；
- 多 Agent 系统；
- 模型和 Agent 综合 Benchmark 模式；
- Web UI；
- 托管存储；
- 自动选择评测引擎；
- Promptfoo、Inspect AI 和 AutoGenBench Adapter；
- Marketplace；
- Leaderboard；
- 复杂安全分数；
- 自动任务生成；
- Checkpoint 反事实回放；
- 角色贡献归因；
- 分布式执行。

## 23. 路线图

| 时间 | 目标 | 验收门槛 |
|---|---|---|
| W1 | 技术 Spike | Fake Agent 与 Fake MCP 完成一次隔离 A/B 运行 |
| W2-W3 | 最小垂直闭环 | `agentlift impact` 生成 Terminal 和 JSON 结果 |
| W3 | Alpha 发布 | 至少两位外部用户完成一次运行 |
| W4-W5 | 可信实验 | 重复运行、AB/BA 平衡、效果量和区间 |
| W5-W6 | 失败解释 | 工具序列 Diff 和首个可观察分歧点 |
| W7 | 证据包 | 可离线重建报告且不泄漏 Secret |
| W8 | CI 与加固 | Linux/macOS 通过进程和工作区安全测试 |
| W9-W10 | Beta 与生态证明 | 两个真实 MCP 案例和五分钟 Quick Start |

W1 技术 Spike 必须回答：

1. 能否临时注入一个 stdio MCP？
2. 能否在无 MCP 和有 MCP 条件下运行同一任务？
3. 能否恢复完全相同的初始工作区？
4. 能否终止整个 MCP 进程树？
5. 能否获得结构化任务结果？

如果 W1 不能闭环，应重新评估产品假设，而不是继续搭建工程框架。如果外部证据到达
更早，Beta 可以在 W8 发布；不能为了填满十周而增加范围。

Skill、原生 Agent Adapter 和广泛生态集成，只有在真实 MCP 使用验证需求后才开始。

## 24. 成功指标

### 24.1 激活

- 第一次有效 Smoke 报告的中位时间不超过十分钟；
- 通过 `doctor` 的用户中，至少 80% 完成示例实验；
- 至少两位外部用户无需维护者修改即可完成 W3 Alpha。

### 24.2 可信度

- 原始工作区意外修改次数为零；
- 每个决策包含样本量、效果量、区间和排除项；
- 每份报告标明被测试的准确版本；
- 从规范化 JSON 重新生成的报告与原决策一致。

### 24.3 产品价值

- 用户能在 15 分钟内完成第一个自有任务集实验；
- 用户拥有愿意重复使用的任务集；
- 报告能够改变部分启用或停用决策；
- 访谈明确成功率、成本、兼容性和失败解释中哪个需求最重要；
- 用户明确表示是否愿意把实验加入 CI；
- 能产生有边界启用/停用决策的实验比例；
- MCP 更新后主动重新运行的用户比例；
- 在 CI 中使用 AgentLift 的 MCP 项目数量；
- 发布前发现的回归数量。

### 24.4 社区

- 可复用公开任务集数量；
- 第三方 Generic Command Runner 数量；
- 复现公开证据包所需时间；
- GitHub Star 只作为传播指标，不作为质量指标。

## 25. 风险与缓解

| 风险 | 影响 | 缓解措施 |
|---|---|---|
| 产品范围仍过宽 | 执行分散 | MVP 只做 MCP |
| Generic Runner 配置复杂 | 上手阻力 | 提供参考 Runner 和离线 Demo |
| 模型随机性 | 产生错误结论 | 配对、重复、区间和失败样本 |
| LLM Judge 偏差 | 误导决策 | 仅作可选证据，确定性门槛优先 |
| MCP 改变 Agent 上下文 | 实验混杂 | 显式记录 Schema/上下文成本 |
| 外部工具副作用 | 实验不安全 | 测试凭证、白名单和 Mock |
| Trace 格式不一致 | 解释能力弱 | MVP 只支持一个规范化协议 |
| 成本快速增长 | 用户失去信任 | 运行预览和硬预算 |
| 报告过度泛化 | 错误使用结果 | 强制声明任务和版本范围 |
| 证据泄漏数据 | 隐私事故 | 默认脱敏，不序列化 Secret |

## 26. 待决问题

1. 开源许可证；
2. 最终发布的 npm 包名；
3. OpenAI-Compatible API 的准确子集；
4. Standard 和 Release 模式的默认重复次数；
5. 默认质量和成本阈值；
6. Bootstrap 实现与随机种子记录方式；
7. 五事件最小集合之后的扩展 Trace Schema；
8. 证据包归档格式；
9. 默认本地保留时间；
10. MVP 是否包含参考 LLM Judge，还是只提供接口；
11. 最低 MCP 协议版本。

## 27. MVP 验收标准

达到以下条件后，MVP 才能公开发布 Beta：

1. 新用户十分钟内完成参考实验；
2. Baseline 与 Candidate 使用相同仓库快照；
3. 对抗测试下原始工作区保持不变；
4. Baseline 配置中不存在 Candidate MCP；
5. Candidate MCP 启停后没有残留子进程；
6. Agent、模型、MCP、任务和验证器版本均被锁定；
7. AB/BA 执行顺序被平衡并记录；
8. 重复成对结果能生成样本量、效果量和区间；
9. LLM Judge 不能覆盖确定性硬门槛失败；
10. 报告包含改善、退化和无效 Case；
11. Trace Diff 能识别新增、删除和变化的工具调用；
12. 证据包无需重新运行 Agent 即可生成报告；
13. JSON、Markdown 和 Terminal 输出决策一致；
14. CI 能根据声明的回归策略失败；
15. 缺失指标显示为不可用，不能显示为零；
16. 证据包中不出现 Secret 值；
17. 证据不足时输出 `INCONCLUSIVE`；
18. 环境继承经过白名单并使用临时 HOME/XDG；
19. Fixture 符号链接和路径逃逸被拒绝；
20. stdout/stderr 溢出受到限制并报告为基础设施失败；
21. 除非真正执行，否则网络隔离显示为不可用；
22. 执行不可信项目之前显示明确警告。

## 28. 未来 Skill 评估

Skill 评估复用同一个实验模型：

```text
Baseline:  不注入 Skill
Candidate: 临时注入 Skill
```

新增指标：

- 指令上下文成本；
- 正确激活；
- 错误激活；
- 指令冲突；
- 按任务类别划分的提升；
- 对模型和 Agent 的敏感性。

只有 MCP 垂直工作流满足 MVP 验收条件后，才开始 Skill 支持。

## 29. 术语表

- **Agent 扩展**：改变 Agent 行为或可用能力的 MCP Server，未来也包括 Skill。
- **Baseline**：不启用 Candidate 扩展的 Agent 条件。
- **Candidate**：启用待测扩展的 Agent 条件。
- **Case**：一个任务、Fixture、验证器集合和任务标签。
- **Suite**：一组有版本的 Case。
- **Task Contract**：冻结后的任务、目标、约束、验证器和预算。
- **Paired Run**：按 Case 和运行 Block 匹配的 Baseline/Candidate 执行。
- **Effect Size**：Baseline 与 Candidate 的测量差异。
- **Evidence Bundle**：包含 Manifest、Lock、结果、Trace、失败和报告的可移植实验包。
- **Hard Gate**：不能被其他指标抵消的失败条件。
- **Regression**：Candidate 行为比 Baseline 明显更差的 Case。
- **Trace Diff**：规范化 Baseline 与 Candidate 执行事件之间的比较。
- **Net Value**：同时考虑质量收益、成本、延迟、可靠性和风险后的价值。
