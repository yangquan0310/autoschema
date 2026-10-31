# Changelog

## [0.3.5] — 2026-10-31

### Fixed（Windows 上的打包与发布链路）

- **从 Windows 打的包，在 Unix 上执行 `autoschema` 报 `bad interpreter`。**
  根因：仓库此前没有 `.gitattributes`，而本机 `core.autocrlf=true`，git 按 Windows 约定把
  工作区检出成 CRLF。`dist/` 提交进仓库、`dist/cli.js` 又是 `bin` 入口，于是 shebang 变成
  `#!/usr/bin/env node\r`，内核去找名为 `node\r` 的解释器。git blob 本身一直是干净的
  （74217 字节、LF），坏的只是检出。修法：新增 `.gitattributes`（`* text=auto eol=lf`，
  `*.zstd` / `*.tgz` / `*.sqlite` / 图片显式标 `binary`），并按新属性强制重检出；
  工作区 `dist/cli.js` 恢复为 74217 字节、shebang 为 LF。
- **`pnpm run pack:dist` 在 Windows 上只生成 `dist/package/`，产不出 tgz。**
  根因：`scripts/pack-dist.mjs` 用 `execFileSync('pnpm', …)` 直接调 pnpm，而 Windows 上
  pnpm 是 `.cmd` shim，Node 不能直接执行它，报 `spawnSync pnpm ENOENT`。
  修法：抽出 `packWithPnpm()`——win32 下交给 `cmd.exe /d /s /c` 解析命令，其余平台仍直接
  exec。Windows 上已实测能产出 `dist/autoschema-0.3.5.tgz`。
- **打包前不拦 CRLF，LF 修好后仍可能被重新检出或手改破坏。**
  修法：`pack:dist` 在 `dist/index.js` 存在性检查之后增加守卫，`dist/index.js` /
  `dist/cli.js` 里出现 `\r\n` 直接失败，并提示先用 LF 重新检出再打包。
- **pnpm 11 下 `pnpm run check` 跑不起来。**
  根因一：pnpm 11 把构建脚本审批移进 workspace 配置（`onlyBuiltDependencies` 等已移除），
  默认 `strictDepBuilds`，`esbuild`（tsup/vitest 依赖）的 postinstall 被拦，
  报 `ERR_PNPM_IGNORED_BUILDS`。修法：新增 `pnpm-workspace.yaml`，`allowBuilds: esbuild: true`。
  根因二：pnpm 11 默认 `minimumReleaseAge: 1440`（24 小时），且每次 `install` 与 `pnpm run`
  前的依赖校验都会重新检查 lockfile 里每个条目的发布时间；本仓库 lockfile 锁定的
  `rollup@4.67.2` 发布不足 24 小时，直接报 `ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`。
  修法：`minimumReleaseAge: 0`（lockfile 由唯一维护者提交、随发布一起审查，用它换发布当天
  可安装；想恢复默认隔离删掉这一行即可）。
- **Windows 上 `tests/reconcile.test.ts` 有一条用例必红。**
  根因：断言里硬编码了 POSIX 路径 `/abs/events-b`，而 `path.resolve` 在 Windows 上会补当前
  盘符（`C:\abs\events-b`）。修法：期望值改用 `path.resolve('/abs/events-b')`，两个平台都成立。

### Docs

- README 安装示例的 `VER` 同步到 `0.3.5`，源码安装段的测试数量更新为 67。

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
