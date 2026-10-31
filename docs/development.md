# 开发

## 命令

```bash
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm run test        # vitest run（全离线，网络用注入的 ChatClient 假实现）
pnpm run build       # tsup → dist/
pnpm run pack:dist   # dist/package + dist/*.tgz（Release 资产）
pnpm run check       # typecheck + test + build
node dist/cli.js propose --verbose
```

> Windows 上 `pack:dist` 会经 `cmd.exe` 调 pnpm（pnpm 是 `.cmd` shim），
> 并在打包前拒绝 CRLF 的 `dist/cli.js`——后者会让 Unix 安装报 `bad interpreter`。

## 分支模型

| 分支 | 角色 |
| --- | --- |
| `main` | 稳定线：只接收 `beta` 的合并；发布 tag 打在 `main` 上 |
| `alpha` | 集成分支：合并 `fix/*` / `feat/*`，跑全量 `pnpm run check` |
| `beta` | 发布分支：升版本 + 写 CHANGELOG + build/pack，验证后合入 `main` |
| `fix/<name>` | 修复与文档分支，从 `main` 切出，合并到 `alpha` |
| `feat/<name>` | 特性分支，同上 |

```bash
git checkout -b fix/<name> main
# …开发并提交…
git checkout alpha && git merge --no-ff fix/<name> && pnpm run check
git checkout beta  && git merge --no-ff alpha && pnpm run check && pnpm run pack:dist
# 验证 beta 后：beta → main，打 annotated tag，推送分支与 tag
```

## 测试策略

- 纯函数：解析/渲染/合并/就近匹配逐条断言
- 编排：注入 `ChatClient` 假实现，覆盖 `propose` 不落盘、`apply` 落盘 + 快照、无变更不写、无日记报错
- 真实链路：`node dist/cli.js propose` 对真实 `~/.autobiomemory` 跑一次（手动验证）

## 改指导语时同步

`ANALYSIS_GUIDE` / `RESPONSE_CONTRACT` 改动要同时更新 `docs/piaget-guide.md`
（用 `pnpm run build && node scripts/gen-guide.mjs` 从构建产物生成，避免两份漂移）。
