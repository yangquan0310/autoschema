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

## 完整流程（它就是四步）

```
① 配置闸门：trigger.modes / cooldown / minNewDiaries 判断"现在要不要跑"
        ↓
② 组装输入：要处理的日记（可配多个目录）+ 指导语 + 当前 AGENTS.md
        ↓
③ 交给 LLM（DeepSeek）→ 返回建议 JSON
        ↓
④ agent 自己决定：采纳哪几条（tool 只给建议，不替 agent 改文件）
```

**插件不改 `AGENTS.md`**。`propose` 只产出建议；是否落地由 agent/人决定，
需要时用 `apply --ids s1,s3` 精确采纳（写前自动快照）。

## 建议 JSON 长什么样

每条建议都必须写明**怎么改**：

| op | 含义 | 必填字段 |
| --- | --- | --- |
| `add` | 增：新增一条要点 | `value` |
| `remove` | 删：删除一条要点（**顺应**的一种） | `target` |
| `modify` | 改：改写措辞（**同化**） | `target` + `value` |
| `reorder` | 重排：**价值观的优先级**（`order` 即顺序） | `order`（≥2 条） |

```jsonc
{
  "equilibriumScore": 0.42,
  "summary": "我在『先给结论』上不稳定",
  "observations": [
    { "area": "style", "observed": "…", "against": "说话简洁，先给结论",
      "conflict": "…", "severity": "medium",
      "evidence": [{ "eventId": "ev_…", "title": "…", "quote": "…" }] }
  ],
  "suggestions": [
    { "id": "s1", "area": "style", "op": "modify",
      "target": "说话简洁，先给结论", "value": "开口先给结论；需要背景时放在结论之后",
      "piaget": "assimilation", "reason": "…", "evidence": [], "confidence": 0.8,
      "severity": "medium", "risk": "汇报可能变长" },
    { "id": "s2", "area": "value", "op": "reorder",
      "order": ["长期 > 短期", "安全 > 进度", "事实 > 面子"],
      "piaget": "accommodation", "reason": "…", "evidence": [], "confidence": 0.7, "severity": "medium" }
  ],
  "notes": "…"
}
```

## 安装

三种方式，按需要选一种。**AutoSchema 不改 `AGENTS.md`**，所以装完不会动你的文件。

### A. 用 Release 资产（最省事，无需 clone / 编译）

每个版本都发布预构建产物：

```bash
VER=0.3.1
curl -L -o autoschema.tgz \
  "https://github.com/yangquan0310/autoschema/releases/download/v$VER/autoschema-$VER.tgz"
mkdir -p ~/opt/autoschema && tar -xzf autoschema.tgz -C ~/opt/autoschema --strip-components=1

node ~/opt/autoschema/cli.js doctor      # 自检
node ~/opt/autoschema/cli.js propose     # 出建议（只读）
```

想直接敲 `autoschema` 而不是 `node …/cli.js`：

```bash
cd ~/opt/autoschema && npm i -g .        # 或 pnpm add -g .
autoschema doctor
```

### B. 从 git 安装（hook 触发必须这样装）

只有装进 dsh profile，`trigger.modes` 里的 `hook` 才会挂上生命周期点：

```bash
dsh plugin --profile web add "git+https://github.com/yangquan0310/autoschema.git#main"
```

仓库已跟踪 `dist/`，**装的时候不需要编译**。装完重启 profile 进程，然后：

```bash
# 用 profile 里的那份跑（或全局装一份，两者共享 ~/.autoschema 状态）
node ~/.dsh/profiles/web/node_modules/autoschema/dist/cli.js doctor
```

hook 挂点与冷却在 `~/.autoschema/config.json` 里配：

```jsonc
"trigger": {
  "modes": ["manual", "hook"],
  "hook": { "events": ["compaction/start"], "cooldownMs": 1800000 }
}
```

### C. 从源码（开发用）

```bash
git clone https://github.com/yangquan0310/autoschema.git && cd autoschema
pnpm install && pnpm run check      # typecheck + 64 个测试 + build
node dist/cli.js doctor
```

## 日常使用

```bash
autoschema doctor                  # 自检：日记目录 / 密钥 / 篇数 / DeepSeek 连通性
autoschema propose                 # 出建议（默认只读，不改任何文件）
autoschema pending                 # 看待审建议摘要（增/删/改/重排 各几条）
autoschema apply --ids s1,s3       # 只采纳这两条（写前自动快照到 ~/.autoschema/history/）
autoschema apply                   # 全部采纳
autoschema show                    # 打印当前解析出的图式
autoschema history                 # 历次快照，可回滚
```

> `propose` 与所有自动触发（`tick` / `daemon` / hook）**只产出建议**；
> 是否采纳、采纳哪几条，由 agent 或人决定。

## 日记位置（可配置）

```jsonc
// ~/.autoschema/config.json
"diaries": {
  "dirs": ["~/.autobiomemory/events", "/data/another-memory/events"],  // 多目录、支持 ~、去重
  "includeGlobs": ["*.json"],
  "strict": false        // true = 只读上面这些目录，不回落到 memoryRoot/events
}
```

CLI 也可临时覆盖：`autoschema propose --diaries /a/events,/b/events`。

## 什么时候跑（触发方式）

三种可同时开启，配置在 `~/.autoschema/config.json` 的 `trigger`：

```jsonc
"trigger": {
  "modes": ["manual", "schedule", "hook"],
  "cooldownMs": 3600000,        // 共用冷却
  "minNewDiaries": 5,           // 未消化日记不足 5 篇就不跑
  "applyMode": "propose",       // propose=只出建议；apply=自动写回
  "schedule": { "intervalMinutes": 1440, "atTime": "03:30", "skipIfOverdueMinutes": 720 },
  "hook":     { "events": ["compaction/start"], "cooldownMs": 1800000 }
}
```

| 方式 | 用法 | 说明 |
| --- | --- | --- |
| `manual` | `autoschema analyze` / `apply` | 永远可用，忽略闸门 |
| `schedule` | `autoschema tick`（cron/timer）· `autoschema daemon --interval 300` · `autoschema cron` | `tick` 幂等：冷却 + 未消化数量都满足才真正跑 |
| `hook` | 装成 dsh 插件（`cordis.patch.yml`） | 只挂**特定**生命周期点：`compaction/start`（默认）、`agent/pre-step`、`agent/idle`、`session/start` |

**只跑未消化的日记**：`state/cursor.json` 记 `digested`（已吸收）与 `proposed`（已建议未落盘），
定时/hook 都只喂"两者都没有"的日记；`analyze` 的产出存 `state/pending.json`，
`apply` 直接消费它、**不再二次调用模型**。

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
