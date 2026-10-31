# AutoSchema 架构

## 数据流

```
~/.dsh/AGENTS.md ──parse──► SchemaDoc {style[], belief[], value[], preamble, extra}
                                    │
~/.autobiomemory/events/<id>.json + <id>.md ──► DiaryEntry[]（按时间倒序，受 limit / 预算约束）
                                    │
                   buildAnalysisRequest（ANALYSIS_GUIDE + RESPONSE_CONTRACT）
                                    ▼
                             DeepSeek（JSON 模式）
                                    ▼
    Analysis {equilibriumScore, summary, observations[], suggestions[], notes}
                                    ▼
  propose ──► state/pending.json（+ cursor.proposed / last-run.json）；不写 AGENTS.md
                                    ▼
  apply（显式）──► applySuggestions（定位 / 去重 / 上限）──► history 快照 ──► 写回 AGENTS.md
```

## 模块

| 模块 | 职责 |
| --- | --- |
| `agents-md.ts` | 解析/渲染三节框架；`findClosestIndex` 做就近匹配；`applySuggestions` 执行增/删/改/重排（含去重与上限） |
| `diaries.ts` | 读 AutoBioMemory 的 `events/`（正文取 `.md`，缺失回落 JSON），排序、过滤、预算、渲染 |
| `prompt.ts` | 皮亚杰指导语、响应契约、宽容解析（坏条目丢弃而非整次失败） |
| `deepseek.ts` | Chat 客户端：JSON 模式、429/5xx 重试、超时 |
| `reconcile.ts` | 编排：`propose`（读→分析→存 pending）、`applySelected` / `applyPending`（快照→写回）、`renderReport`、`listHistory` |
| `cursor.ts` | 消化游标：`digested` / `proposed`，默认只喂未处理过的日记 |
| `schedule.ts` + `tick.ts` | 闸门（冷却 / 未消化数量 / 固定时刻）与三条触发路径共用的执行器 |
| `plugin.ts` | dsh 插件：按 `trigger.hook.events` 挂生命周期点，触发 `tick`（只出建议） |
| `cli.ts` | `propose / apply / tick / daemon / cron / due / pending / reset-cursor / show / history / init / doctor` |

## 为什么用"就近匹配"而不是精确匹配

模型给出的 `target` 常常不是逐字引用（会改一个标点、加个"的"）。`findClosestIndex` 先做
normalise（去空白与标点、转小写），再依次比较：完全相等 → 互为子串 → 字符集合重合度 ≥ 0.5。
定位不到的建议进入 `rejected`，**绝不新增**——这是防止图式被"改写"悄悄变成"堆叠"的关键。

## 快照与历史

`apply` 有实际变更时，把旧 `AGENTS.md` 写到 `<stateRoot>/history/AGENTS-<时间戳>.md`，
并在 `changelog.jsonl` 追加一行；`autoschema history` 列出快照，回滚靠手动拷回。
快照独立于 git，不依赖仓库版本历史。

## 边界

- 自动触发（schedule / hook）和插件只产出建议；写 `AGENTS.md` 必须显式 `apply`。
- 一次分析取最近 N 篇日记（默认 30），默认跳过已出建议 / 已吸收的日记；`--all` 可关掉过滤。
- 单次 `apply` 新增 ≤ 4 条、删除 ≤ 2 条（可配），不会删空某一节；定位不到的建议丢弃。
- 不做多人格：一个状态根对应一份 `AGENTS.md` 与一个游标；不做远程同步。
