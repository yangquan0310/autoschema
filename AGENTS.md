# AutoSchema — 开发约定

本文件面向在这个仓库里动手的人/agent。**发布流程是硬性的**，其余是索引与约束。

一句话定位：让 agent 的自我图式（风格 / 信念 / 价值观）随日记演化——皮亚杰式的非平衡 → 同化 / 顺应 → 平衡。

## 仓库速览

- `src/` — TypeScript 源码。`config`（默认值 / 合并 / 校验）、`agents-md`（三节骨架的解析、渲染、合并）、`reconcile`（非平衡判定 → 同化 / 顺应 → 平衡）、`tick` + `schedule`（闸门与触发）、`diaries` + `deepseek`（经验来源与模型调用）、`cli`、`plugin`（dsh 插件面）。
- `dist/` — 构建产物，**提交进 git**；`pnpm run build` 之后工作区必须是干净的。
- `tests/` — vitest 用例；`scripts/pack-dist.mjs` 负责打 Release 资产。
- `cordis.patch.yml` — 本包作为 profile patch 层被 dsh 加载的入口。
- `docs/` — 架构、开发、皮亚杰分析导则。

## 常用命令

```bash
pnpm run typecheck    # tsc --noEmit
pnpm run test         # vitest run
pnpm run build        # tsup → dist/
pnpm run pack:dist    # dist/package + dist/*.tgz（Release 资产）
pnpm run check        # typecheck + test + build，提交前必须全绿
```

## 发布流程

顺序固定，一步都不许跳、不许并。下文用 `<fix-branch>`、`<pkg>`、`<version>`、`<profile>` 代指当次的修复分支、包名、版本号与 profile 名。

1. **从 `main` 切 `<fix-branch>`。** 修复与特性各开各的分支；改动只落在该分支上，不直接提交 `main`。
2. **在 `<fix-branch>` 上实现并测试。** 先让目标场景可复现（失败的测试或最小复现脚本），再改代码，再让 `pnpm run check` 全绿；拿不出复现件就不算修好。
3. **合并 `<fix-branch>` → `alpha`（`--no-ff`），在 `alpha` 上跑全量 `pnpm run check`。** 冲突与回归都在这一步暴露，不带着问题往后传；同时确认重建产物与提交内容一致（`git status` 干净）。
4. **合并 `alpha` → `beta`，在 `beta` 上发版。** 升版本号（`package.json` 与 `src/constants.ts` 的 `VERSION` 同步）、写 `CHANGELOG`（必须写清**根因**与**修法**，不写"修了个 bug"这类话），再 `pnpm run build && pnpm run pack:dist`。
5. **打 annotated tag，推送所有分支与 tag，创建 GitHub Release 并把 `dist/*.tgz` 挂成资产。** 资产必须包含 `cordis.patch.yml`、包内 `package.json` 必须带 `dsh.bundle.patch`——缺任一项，dsh 会报 `invalid plugin`，或只当普通依赖安装、永远注册不成 profile 层。
6. **发布后用 Release 资产回装验证。** 下载资产 → `dsh plugin --profile <profile> add "file:<tgz>"` → 确认包名进了 `dsh.profile.bundles`、`dsh --profile <profile> --dump-config` 的组合树正常、插件配置过得了校验。验证用临时 profile，验完删掉；本地构建产物装得上不算验证。

## 硬约束：dsh 侧的三道门

这三处任何一处写错，都会让 `dsh` 起不来或让插件静默不生效，而 `pnpm run check` 不一定能拦住：

1. **包入口必须暴露插件面。** `cordis.patch.yml` 的 `name` 指向包主入口，主入口必须导出 `apply` / `inject` / `Config`（以及 `default.apply`），否则 cordis 判定"不是插件"，报 `invalid plugin, expect function or object with an "apply" method`。
2. **资产必须自带注册信息。** `cordis.patch.yml` 要被打进 tgz，`dsh.bundle.patch` 要写进包内 `package.json`；否则 `dsh plugin add` 只当普通依赖装，hook 永远挂不上。
3. **`!!js` 表达式一律加双引号。** dsh 用 js-yaml（`JSON_SCHEMA` + `tag:yaml.org,2002:js` 标量类型）解析 patch 层；裸标量里出现 `? … : …` 或 `: ` 会被当成**映射的键**，配置对象被切成 `{ '[object Object]': … }`，插件随后在 schemastery 校验时报 `$.events expected array but got [object Object]`，整个 dsh 启动中止。`tests/patch.test.ts` 用与 dsh 同构的方言解析**随包发布的**那份 `cordis.patch.yml` 并跑 `Config` 校验，改这一层配置后先看它。

## 交付纪律

- **先复现再修。** 每个修复都要留下能变红的用例或最小复现脚本，放进 `tests/`。
- **产物与源码同提交。** `dist/` 在 git 里；构建后不允许有未提交差异。
- **文档、配置、流程类改动同样走分支**，不直接提交 `main`。
- **对外行为（默认值、触发点、写回策略）改动必须写进 `CHANGELOG`**，并说明对既有用户的迁移影响。
