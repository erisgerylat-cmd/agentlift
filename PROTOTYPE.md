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
