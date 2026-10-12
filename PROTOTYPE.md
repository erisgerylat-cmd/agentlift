# AgentLift 原型验收说明

本地 CLI 原型面向 MCP 增益实验，使用现有 Generic Command 和 OpenAI-compatible
参考 Runner。所有外部命令都以当前用户权限运行；进程隔离不是容器沙箱。

Claude Code 基础 Skill/MCP 接入及离线演示已补齐，具体运行步骤见
[Claude Code 测试指南](./CLAUDE-CODE.zh-CN.md)；真实模型调用由人工验收验证。

## 一键人工验收

版本：`0.0.1-prototype`。需要 Node.js 22+、npm；实际验收环境为 macOS。
在仓库或解压后的原型根目录执行：

```bash
npm ci
npm run prototype
```

程序会自动启动仅监听本机的模拟模型服务，运行正常 MCP 与故意退化的 MCP，
然后关闭服务。无需模型凭证，也不会请求付费模型。
全部断言成功后，在 `.agentlift/prototype/ACCEPTANCE.md` 查看交付报告入口。

| 验收项 | 预期结果 |
|---|---|
| 环境与配置检查 | 可以启动，Fixture 和可执行文件检查通过 |
| 正常场景 | Baseline 2/4，Candidate 4/4，4 个有效配对 |
| 退化场景 | Baseline 2/4，Candidate 2/4，工具返回错误内容 |
| 历史比较 | Candidate 成功率下降 50pp |
| CI 正常场景 | PASS |
| CI 退化场景 | FAIL，属于预期验收结果 |
| 统计建议 | 两组均为 INCONCLUSIVE：小样本不足以推荐启用 |
| 退出清理 | 本地模型服务关闭，无实验 MCP 子进程残留 |

主要产物：

```text
.agentlift/prototype/
├── ACCEPTANCE.md
├── comparison.json
├── ci-results.json
├── working/<experimentId>/
└── regression/<experimentId>/
```

每个实验目录包含 `report.md` 和 `analysis.json`。后者有配对分类、工具调用序列、
首个可观察分歧点，以及对应参数/结果。`npm start` 显示所有可用命令帮助。

## 实验输入与证据

- YAML 或逐行 JSON 的 `.jsonl` 任务集；每个 Case ID 必须唯一。
- `execution.maxRuns` 默认 1000，超过计划次数时在启动命令前拒绝。
- `execution.seed` 默认 42，供可重建的统计使用。
- 每个 Fixture 在实验开始时冻结一次；A/B 都从该快照复制。
- 每次实验输出到 `<storage.output>/<experimentId>/`，包含 `experiment.json`、
  `tasks.json`、`environment.lock`、`results.json`、`traces.jsonl`、
  `analysis.json`、`report.md`、`checksums.json`。
  输出根目录 `results.json` 指向最近一次结果副本。
- 环境锁记录 Node/OS、Git 状态、任务/配置/快照/命令文件哈希、Adapter 版本、
  模型标识、重复次数、随机种子和环境变量名称。无法自动取得的 Agent/MCP 版本为
  `null`；缓存和限流状态为 `unknown`，不宣称完全锁定外部 Provider。
- `storage.capture: metadata` 移除事件正文和日志；`redacted` 保留脱敏内容。
- 不允许通过环境白名单覆盖 HOME、PATH、TMP、XDG 或动态加载配置。
- 原始 Fixture 发生变化时终止实验；输出目录不得放入 Fixture。
- 校验清单用于发现文件损坏，不构成来源签名。分享证据前仍应检查业务敏感信息。

## 命令链路

在仓库根目录运行 `npm install`、`npm run build`，随后：

```bash
node dist/cli.js doctor --config examples/agentlift.yaml
node dist/cli.js impact --config examples/agentlift.yaml
node dist/cli.js report .agentlift
node dist/cli.js compare .agentlift .agentlift
node dist/cli.js ci --evidence .agentlift --min-success-delta-pp=0
```

`impact` 终端会显示独立证据目录。比较两个实验时使用各自目录，根目录仅表示最近一次。
`report <目录> --output report.md` 可离线生成 Markdown，`--json` 输出详细分析。
`analysis.json` 包含每个配对的工具序列及首个可观察差异的参数和结果。

CI 参数支持 `--min-success-delta-pp`、`--max-cost-increase-pct`、
`--max-tool-error-rate`、`--max-regressions`；默认最小提升为 0pp。
退出码 `0` 表示通过、`1` 表示退化/基础设施故障、`2` 表示指标缺失或参数无效。
不配置成本阈值时不强制要求价格；配置了成本阈值而缺失价格时返回不可评估。

## 指标与结论

- 成功率只按有效配对计算，同时展示 Wilson 区间、相对变化与绝对百分点。
- 提升区间采用固定种子的 2000 次 Case 聚类 Bootstrap；重复运行不会被当成独立 Case。
- 成本估算来自 `subject.model.inputPricePerMillion`、
  `outputPricePerMillion` 与 Provider 的 Token 使用量；缺失值为不可用。
- 至少 10 个独立 Case、20 个有效配对，且 Case 级符号检验通过、区间完全高于声明的
  最小提升、成本在预算内，才可能返回 `ENABLE`。显著负向效果为 `DO_NOT_ENABLE`。
- 小样本、成本未知、基础设施故障或检测到模型标识变化，保持 `INCONCLUSIVE`。
- 不同任务类别可通过 Case 标签记录，本原型不会自动对小子组给出条件启用建议。
- CI 对观察值执行阈值检查，不等于统计上建议启用。离线合成 Demo 的结果只能验证链路。

## 使用你自己的任务

1. 复制 `examples/openai-agentlift.yaml` 和 `examples/openai-tasks.yaml`。
2. 将配置中的 `suite.file` 指向自己的任务集；所有相对路径相对于所在配置文件解析。
3. Fixture 应是完成任务所需的最小目录，不能含符号链接。验证器在临时工作区执行，
   必须通过退出码判断结果，不依赖原始工作区。
4. 配置自己的 MCP 命令与 `candidate.cwd`，通过 `candidate.envAllowlist` 传递测试
   环境变量名称。不要把 Secret 值写入配置或命令参数。
5. 设置 `MODEL_BASE_URL`、`MODEL_API_KEY` 与模型名，运行 `doctor` 后执行 `impact`。
   真实模型可能产生费用；目前仅用模拟 Provider 验证兼容性。
6. 使用 Generic Command 接入已有代码 Agent 时，遵循 JSONL 输入与终态契约。
   内置参考 Runner 只输出 `result.txt`，不自动读取或编辑任意仓库文件。

```bash
node dist/cli.js doctor --config examples/openai-agentlift.yaml
node dist/cli.js impact --config examples/openai-agentlift.yaml
```

## 手工负向测试

```bash
# 演示正常结果要求至少 1pp 提升：预期退出 0
node dist/cli.js ci --evidence .agentlift/prototype/working --min-success-delta-pp=1

# 退化结果不能满足同一门槛：预期退出 1
node dist/cli.js ci --evidence .agentlift/prototype/regression --min-success-delta-pp=1

# 缺少成本信息的小 Demo：预期退出 2
npm run demo
node dist/cli.js ci --evidence .agentlift --max-cost-increase-pct=20
```

可以复制一份独立证据目录后修改其 `results.json`，再次运行 `report` 应拒绝校验失败的
证据。不同任务/模型/初始 Fixture 的 `compare` 会报不可比较，不静默给出变化值。

`impact` 运行中 Ctrl+C 会终止当前进程组并清理临时目录，中断实验不生成完成报告。
`doctor` 不运行 Agent/MCP，也不验证真实模型服务是否可达。

## 原型边界与反馈

本次覆盖核心 CLI 流程与 Claude Code 基础 Skill/MCP 接入。LLM Judge、其他验证器、其他 Agent Adapter、
严格容器隔离、Web UI 和远程发布未纳入本原型。Agent/MCP 的未知版本标注为 `null`，
缓存/限流标注为 `unknown`。证据包能离线重建报告，但不会打包完整私有仓库或凭证；
重跑原实验仍需恢复输入文件及环境。`metadata` 模式不保留参数/结果正文，因此无法
还原这些细节。`redacted` 和 `full` 均对已知凭证脱敏；未知业务敏感信息需人工检查。

反馈建议附上：执行命令、操作系统与 Node 版本、预期与实际表现、退出码、
脱敏后的 `results.json` 或独立证据目录。不要提交模型密钥或私有业务数据。
