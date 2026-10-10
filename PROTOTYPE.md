# AgentLift 原型验收说明

本地 CLI 原型面向 MCP 增益实验，使用现有 Generic Command 和 OpenAI-compatible
参考 Runner。所有外部命令都以当前用户权限运行；进程隔离不是容器沙箱。

## 实验输入与证据

- YAML 或逐行 JSON 的 `.jsonl` 任务集；每个 Case ID 必须唯一。
- `execution.maxRuns` 默认 1000，超过计划次数时在启动命令前拒绝。
- `execution.seed` 默认 42，供可重建的统计使用。
- 每个 Fixture 在实验开始时冻结一次；A/B 都从该快照复制。
- 每次实验输出到 `<storage.output>/<experimentId>/`，包含 `experiment.json`、
  `tasks.json`、`environment.lock`、`results.json`、`traces.jsonl`、
  `checksums.json`。输出根目录 `results.json` 指向最近一次结果副本。
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
