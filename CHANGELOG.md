# Changelog

## [0.2.1] — 2026-10-31

### Fixed

- `due` / `checkDue` 在未启用 `schedule` 时把未消化篇数报成 `0`（实际值没算），现在始终如实统计。
- `cron` 对"每日"间隔（≥1440 分钟）生成了非法的 `0 */24 * * *`，改为 `0 3 * * *`（每 N 天则 `0 3 */N * *`）。

## [0.2.0] — 2026-10-31

### Added — 触发方式（原来只有手动）

- `trigger.modes`：可同时开启 `manual` / `schedule` / `hook`。
- **定时**：`trigger.schedule.intervalMinutes`（最小间隔）或 `atTime: "HH:MM"`（每天固定时刻），
  配 `skipIfOverdueMinutes` 决定"错过的窗口要不要补跑"。
  - `autoschema tick`：幂等，交给 cron / systemd timer（`autoschema cron` 直接打印 crontab 行）
  - `autoschema daemon --interval 300`：内置循环常驻
  - `autoschema due`：只问"现在该不该跑"
- **hook**：`trigger.hook.events` 显式选择**特定**生命周期点，默认只挂 `compaction/start`：
  `compaction/start` / `agent/pre-step`（prepend）/ `agent/idle` / `session/start`。
  以 dsh 插件（`src/plugin.ts` + `cordis.patch.yml`）形式挂载，`trigger.hook.cooldownMs` 单独冷却。
  闸门与定时分开：hook 的时机由生命周期决定，不被"每日一次"拦住。

### Added — 消化游标（只喂未消化的日记）

- `state/cursor.json`：`digested`（已吸收进图式）+ `proposed`（已出建议未落盘）分开记账。
- `digest.onlyUndigested`（默认 true）：只把**未消化**的日记喂给模型，重复运行不再烧 token。
- `analyze` 产出的建议存进 `state/pending.json`；`apply` 直接消费它，**不再二次调用模型**。
- `autoschema pending` 看摘要、`--discard` 丢弃、`reset-cursor` 清空游标。

### Changed

- `trigger.applyMode`：`propose`（默认，只出建议）| `apply`（自动写回）。自动模式下默认 propose。
- 闸门顺序改为「未消化数量 → 冷却 → 固定时刻」，理由信息量更大。
- 53 个测试（+19）。

## [0.1.0] — 2026-10-31

首个版本：读 AGENTS.md 三节 + AutoBioMemory 日记，皮亚杰式产出非平衡 / 同化 / 顺应，
`analyze` 只出建议、`apply` 快照后写回；34 个测试。
