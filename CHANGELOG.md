# Changelog

## [0.3.2] — 2026-10-31

### Fixed（打包）

- **Release 资产丢了 `dsh.bundle`**：`scripts/pack-dist.mjs` 生成的 package.json 没有
  `dsh.bundle.patch`，也没把 `cordis.patch.yml` 打进包里，导致 `dsh plugin add <tgz>` 只当普通依赖安装、
  提示 `declares no dsh.bundle`、**注册不成 profile 层**（hook 因此永远挂不上）。
  现在两者都补上，并已用临时 profile 实测 `dsh.profile.bundles` 里出现 `autoschema`。

> 说明：`trigger.modes` 默认仍是 `["manual"]`，自动触发需你显式打开。

## [0.3.1] — 2026-10-31

### Docs

- README 补齐三条安装路径：**Release 资产**（免 clone/编译）· **`dsh plugin add git+…`**（hook 触发必须这样装，
  仓库已跟踪 `dist/`，装时无需构建）· **源码**（`pnpm run check`）。
- 补充 `npm i -g .` 得到全局 `autoschema` 命令的用法。
- 讲清 `propose`/自动触发“只出建议、不写文件”，采纳要走 `apply --ids`。
- `diaries.dirs` 多目录配置与 `--diaries` 覆盖写进安装段。

## [0.3.0] — 2026-10-31

### Breaking — 插件只产出建议，绝不改 AGENTS.md

- **移除自动写回**：`propose`（原 `analyze`/`run`）只返回建议，**不碰 AGENTS.md**；
  `tick` / `daemon` / hook 一律只产建议。删除了 `trigger.applyMode`。
- **建议 JSON 重写**：不再是"同化数组 + 顺应数组"，而是统一的 `suggestions[]`，
  每条必须写明操作类型：
  | op | 含义 | 必填 |
  | --- | --- | --- |
  | `add` | 增：新增一条 | `value` |
  | `remove` | 删：删除一条（顺应的一种） | `target` |
  | `modify` | 改：改写措辞（同化） | `target` + `value` |
  | `reorder` | 重排：价值观优先级（`order` 即优先级） | `order`（≥2 条） |
  另含 `id` / `area` / `piaget` / `reason` / `evidence` / `confidence` / `severity` / `risk`。
- **`observations[]`**：非平衡（冲突本身）与建议分开，便于 agent 先判断"要不要动"。
- **采纳权交给 agent**：`apply --ids s1,s3` 精确采纳、`apply` 全采纳（先快照）；
  缺字段或定位不到的建议**直接拒绝并说明原因**，绝不把"改"降级成"增"。

### Added — 日记位置可配置

- `config.json` 新增 `diaries.dirs`（多个目录、支持 `~`、会去重）、`diaries.includeGlobs`、
  `diaries.strict`（true=不回落到 `memoryRoot/events`）。
- CLI `--diaries a,b` 覆盖；`doctor` 显示实际使用的目录与篇数。
- 日记助手统一语义：`resolveDiaryDirs(config)` → 传给 `collectDiaries` / `listEventIds` / `readDiary`。

### Fixed

- `listEventIds` 对"事件目录"会重复拼 `events/`，导致返回空列表（游标因此失效）。

64 个测试（+9）。

## [0.2.1] — 2026-10-31

### Fixed
- `due` 在未启用 `schedule` 时把未消化篇数报成 `0`。
- `cron` 对每日间隔生成非法表达式 `0 */24 * * *`，改为 `0 3 * * *`。

## [0.2.0] — 2026-10-31

触发方式（`manual` / `schedule` / `hook`）+ 未消化游标（`digested` / `proposed` 分账，pending 复用）。

## [0.1.0] — 2026-10-31

首版：三节图式解析 + 日记读取 + 皮亚杰分析 + 建议落盘（当时会自动写回，0.3.0 已改为只出建议）。
