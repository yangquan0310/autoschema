# AutoSchema 架构

## 数据流

```
~/.dsh/AGENTS.md ──parse──► SchemaDoc {style[], belief[], value[], preamble, extra}
                                    │
~/.autobiomemory/events/<id>.md ──► DiaryEntry[]（按时间倒序，受 limit/预算约束）
                                    │
                          buildAnalysisRequest（指导语 + 契约）
                                    ▼
                              DeepSeek（JSON 模式）
                                    ▼
                   Analysis {equilibriumScore, disequilibrium,
                             assimilation, accommodation, notes}
                                    ▼
                         applyChanges（同化定位替换 / 顺应当增去重）
                                    ▼
              ┌─────────────┴──────────────┐
       dry-run：只出报告            apply：快照 → 写回 AGENTS.md
```

## 模块

| 模块 | 职责 |
| --- | --- |
| `agents-md.ts` | 解析/渲染三节框架；`findClosestIndex` 做就近匹配；`applyChanges` 执行同化与顺应 |
| `diaries.ts` | 读 AutoBioMemory 的 `events/`（正文取 `.md`），排序、过滤、预算、渲染 |
| `prompt.ts` | 皮亚杰指导语、响应契约、严格解析（坏条目丢弃而非整次失败） |
| `deepseek.ts` | Chat 客户端：JSON 模式、429/5xx 重试、超时 |
| `reconcile.ts` | 编排：读→分析→应用→快照→写回；`renderReport` 出人读报告 |
| `cli.ts` | `analyze/apply/show/history/init/doctor` |

## 为什么用"就近平匹配"而不是精确匹配

模型给出的 `target` 常常不是逐字引用（会改一个标点、加个"的"）。`findClosestIndex` 先做
normalise（去空白与标点、小写），再依次尝试：完全相等 → 互为子串 → 字符集合重合度 ≥ 0.5。
定位不到就记入 `skipped`，**绝不新增**——这是防止图式被"改写"悄悄变成"堆叠"的关键。

## 快照与历史

每次 `apply` 把旧 `AGENTS.md` 写到 `~/.autoschema/history/AGENTS-<时间戳>.md`，
并在 `changelog.jsonl` 追加一行。不依赖 git，随时可回滚。

## 边界

- v0.1 只做"分析 + 建议 + 写回三节要点"，不做条目排序优化、不做自动删条、不做多人格（agent preset）。
- 不做增量切片：每次分析取最近 N 篇；要用"未消化过的日记"做输入需要外部维护游标（roadmap）。
