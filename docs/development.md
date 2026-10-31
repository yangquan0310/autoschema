# 开发

## 命令

```bash
pnpm install
pnpm run typecheck   # tsc --noEmit
pnpm run test        # vitest run（全离线，网络用注入的 ChatClient 假实现）
pnpm run build       # tsup → dist/
pnpm run check       # typecheck + test + build
node dist/cli.js analyze --verbose
```

## 分支模型

| 分支 | 角色 |
| --- | --- |
| `main` | 共享契约：`types.ts` / `constants.ts` / `util.ts` / `config.ts` |
| `feat/agents-md` | 三节解析、渲染、同化/顺应合并 |
| `feat/analysis` | 日记读取、皮亚杰指导语、响应解析、DeepSeek 客户端 |
| `feat/reconcile` | 编排、快照、报告、CLI |
| `alpha` | 集成分支：合并 feat，跑全量测试 |
| `beta` | 打包分支：`pnpm run check && pnpm run pack:dist` |

```bash
git checkout -b feat/<name> main
# …开发并提交…
git checkout alpha && git merge --no-ff feat/<name>
git checkout beta && pnpm run check && pnpm run pack:dist
```

## 测试策略

- 纯函数：解析/渲染/合并/就近匹配逐条断言
- 编排：注入 `ChatClient` 假实现，覆盖 dry-run 不落盘、apply 落盘+快照、无变更不写、无日记报错
- 真实链路：`node dist/cli.js analyze` 对真实 `~/.autobiomemory` 跑一次（手动验证）

## 改指导语时同步

`ANALYSIS_GUIDE` / `RESPONSE_CONTRACT` 改动要同时更新 `docs/piaget-guide.md`
（可用 `node scripts/gen-guide.mjs` 从构建产物生成，避免两份漂移）。
