# Changelog

## [0.3.4] — 2026-10-31

### Fixed（会挡住 dsh 启动的严重问题）

- **`dsh --profile web` 启动失败：`$.events expected array but got [object Object]`。**
  原因：`cordis.patch.yml` 里 `!!js` 表达式写成了**裸标量**，而 `events` / `cooldownMs` 的内容是三元
  `cond ? a : b`。dsh 用 js-yaml（`JSON_SCHEMA` + `tag:yaml.org,2002:js` 标量类型）解析这一层，
  裸标量中出现 `? … : …` 会被当成**映射的键值对**：
  `events` 于是被解析成 `{ '[object Object]': ['compaction/start'] }`（键是那个 `!!js` 节点被
  `String()` 的结果），插件在 schemastery 校验时报 `$.events expected array but got [object Object]`，
  dsh 直接启动失败。`cooldownMs` 同理被切断成对象。
  修法：`!!js` 表达式一律加双引号（`events: !!js "… ? … : ['compaction/start']"`），并在文件头写明这条约束。
- 新增回归测试 `tests/patch.test.ts`：用与 dsh 同构的 YAML 方言解析随包发布的 `cordis.patch.yml`、
  递归求值 `!!js` 节点（`with (ctx)` 作用域），再跑插件的 `Config` 校验；缺省与全开两套环境变量都覆盖。
  对 0.3.3 的坏文件跑该测试会红，对 0.3.4 会绿。
- CLI 的版本号不再硬编码，统一取 `VERSION`（`src/constants.ts`）。

## [0.3.3] — 2026-10-31

### Fixed（会挡住 dsh 启动的严重问题）

- **`dsh --profile web` 启动失败：`invalid plugin, expect function or object with an "apply" method, received object`。**
  原因：`cordis.patch.yml` 用 `name: autoschema` 指向**包主入口** `dist/index.js`，而插件实体（`name`/`inject`/`Config`/`apply`）
  只在 `dist/plugin.js` 里，主入口没有 `apply`，cordis 于是判定"不是插件"。
  修法：主入口重新导出插件面（`apply` / `inject` / `Config` / `name` / default），并补 `./plugin` 子路径导出；
  `scripts/pack-dist.mjs` 也会把 `plugin.js` / `plugin.d.ts` 打进包，并把 `@deepseek-ai/schemastery`
  声明为运行时依赖（插件加载它时需要）。
- 打包产物校验：解包后 `import('package/index.js')` → `apply: function`、`inject: ['tools','systemPrompt']`、
  `default.apply: function`；临时 profile 实测 `dsh.profile.bundles` 含 `autoschema`。

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
