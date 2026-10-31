# AutoSchema

> 让 agent 的**自我图式**随日记演化：用皮亚杰的发生认识论维护 `AGENTS.md` 里的「风格 / 信念 / 价值观」。

```
日记（我实际怎么想怎么做）
        ↓  与当前图式对照
   非平衡（我做的 ≠ 我以为我是谁）
        ↓
   ┌────┴─────┐
 同化          顺应
改现有要点    加新要点
   └────┬─────┘
     平衡（图式与经验重新自洽）
```

它是 [AutoBioMemory](https://github.com/yangquan0310/autobiomemory) 的姊妹项目：
AutoBioMemory 负责"记住我做过什么"，AutoSchema 负责"据此更新我是谁"。

## 安装与使用

```bash
git clone https://github.com/yangquan0310/autoschema.git && cd autoschema
pnpm install && pnpm run build
node dist/cli.js doctor            # 自检（密钥 / 日记 / 图式 / DeepSeek）
node dist/cli.js analyze           # 出建议，不写回
node dist/cli.js apply             # 写回 AGENTS.md（先快照）
node dist/cli.js show              # 打印当前解析出的图式
node dist/cli.js history           # 历次快照
```

只依赖 `~/.dsh/AGENTS.md` 与 `~/.autobiomemory/events/`，不引入任何运行时依赖
（Node 内置 `fetch` 直连 DeepSeek）。

## 它怎么判断

| 概念 | 在本项目里的含义 |
| --- | --- |
| **图式 schema** | `AGENTS.md` 三节：风格（可观察行为）/ 信念（价值原则）/ 价值观（冲突排序） |
| **经验** | AutoBioMemory 的第一人称事件日记 |
| **非平衡 disequilibrium** | 日记里的实际行为与图式条目冲突，且**反复出现** |
| **同化 assimilation** | 修订已有要点，让旧结构容纳新经验（优先） |
| **顺应 accommodation** | 新增要点，改写图式本身（克制，建议 ≤3 条） |
| **平衡 equilibration** | 冲突被消化，图式与经验重新自洽（输出 0~1 的平衡度） |

指导语全文见 [`docs/piaget-guide.md`](docs/piaget-guide.md)，响应契约见 `src/prompt.ts`。

## 安全边界

- `analyze` 默认**不落盘**；只有 `apply` 才写 `AGENTS.md`，且写前**先快照**到 `~/.autoschema/history/`。
- 同化必须能定位到**现有条目原文**，定位不到就丢弃（不会把"改写"退化成"追加"污染图式）。
- 顺应自动去重，同义条目不会重复添加。
- 三节的 `> 说明` 行与其他自定义内容原样保留，**只动要点**。

## 文档

- `docs/architecture.md` — 架构与数据流
- `docs/piaget-guide.md` — 皮亚杰式分析指导语（人读版）
- `docs/development.md` — 分支模型、测试、发布

## License

MIT
