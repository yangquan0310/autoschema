# AutoSchema

> 让 agent 的**自我图式**随日记演化：用皮亚杰的发生认识论维护 `AGENTS.md` 里的「风格 / 信念 / 价值观」。

```text
日记（我实际怎么想、怎么做）
        ↓  与当前图式对照
   非平衡（我做的 ≠ 我以为我是谁）
        ↓
   ┌────┴────────┐
 同化             顺应
改现有要点    改结构（增 / 删 / 重排）
   └────┬────────┘
     平衡（图式与经验重新自洽）
```

它是 [AutoBioMemory](https://github.com/yangquan0310/autobiomemory) 的姊妹项目：
AutoBioMemory 负责"记住我做过什么"，AutoSchema 负责"据此更新我是谁"。

## 它怎么工作（四步）

```
① 闸门：自动触发（schedule / hook）按 trigger 里的冷却、未消化日记数、
        可选固定时刻判断"现在要不要跑"；CLI 的 propose / apply 不受闸门限制
        ↓
② 组装输入：要处理的日记（可配多个目录）+ 指导语 + 当前 AGENTS.md
        ↓
③ 交给 LLM（DeepSeek）→ 返回建议 JSON（非平衡观察 + 增/删/改/重排建议 + 平衡度）
        ↓
④ 决定：propose 只把建议存进 <stateRoot>/state/pending.json；
        只有显式 apply 才写 AGENTS.md（写前自动快照）
```

**插件（hook）与定时触发永远只出建议，不改 `AGENTS.md`。**

## 建议 JSON 长什么样

每条建议都必须写明**怎么改**：

| op | 含义 | 必填字段 |
| --- | --- | --- |
| `add` | 增：在该节末尾新增一条要点（顺应） | `value` |
| `remove` | 删：删除一条现有要点（顺应） | `target` |
| `modify` | 改：改写一条现有要点的措辞（同化） | `target` + `value` |
| `reorder` | 重排：给出该节**完整**的新顺序，顺序即优先级（顺应） | `order`（≥2 条） |

`target` 应逐字取自该节现有条目（落盘时会做就近匹配，定位不到的建议会被丢弃）。
`piaget` 由 op 决定：`modify` 恒为 `assimilation`，`add` / `remove` / `reorder` 恒为 `accommodation`。

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

三种方式，按需要选一种。**AutoSchema 不会自动改 `AGENTS.md`**，装完不会动你的文件。

### A. 只用 CLI：Release 资产（最省事，无需 clone / 编译）

```bash
VER=0.3.5
curl -L -o autoschema.tgz \
  "https://github.com/yangquan0310/autoschema/releases/download/v$VER/autoschema-$VER.tgz"
mkdir -p ~/opt/autoschema && tar -xzf autoschema.tgz -C ~/opt/autoschema --strip-components=1

node ~/opt/autoschema/cli.js doctor      # 自检
node ~/opt/autoschema/cli.js propose     # 出建议（只读）
```

解包后包根目录就是可运行目录（`cli.js`、`index.js`、`cordis.patch.yml` 都在根上）。
想直接敲 `autoschema` 而不是 `node …/cli.js`：

```bash
cd ~/opt/autoschema && npm i -g .        # 或 pnpm add -g .
autoschema doctor
```

### B. 装进 dsh profile（要 hook 触发就选这个）

hook 触发需要把本包装进 dsh profile（`dsh.profile.bundles` 里出现 `autoschema`）。
从 git 或从 Release 资产安装都可以：

```bash
# 1) 从 git 安装（跟随 main；仓库已跟踪 dist/，装的时候不需要构建）
dsh plugin --profile web add "git+https://github.com/yangquan0310/autoschema.git#main"

# 2) 或者从 Release 资产安装（免 clone / 编译）
dsh plugin --profile web add "file:/path/to/autoschema-0.3.5.tgz"
```

装完重启 profile 进程。之后插件按 `trigger.hook.events` 挂生命周期点（默认只挂 `compaction/start`）。

profile 里的 CLI 路径随安装方式不同：

- git 安装：`~/.dsh/profiles/web/node_modules/autoschema/dist/cli.js`
- tgz 安装：`~/.dsh/profiles/web/node_modules/autoschema/cli.js`

```bash
# 用 profile 里的那份跑（或全局装一份，两者共享 ~/.autoschema 状态）
node ~/.dsh/profiles/web/node_modules/autoschema/dist/cli.js doctor
```

**插件层配置**：`cordis.patch.yml` 用环境变量给插件传参（改完重启 dsh 生效）：

| 环境变量 | 作用 | 默认 |
| --- | --- | --- |
| `DSH_AUTOSCHEMA_ROOT` | 状态根（config / 游标 / 快照） | `~/.autoschema` |
| `DSH_AUTOSCHEMA_AGENTS` | 被维护的 `AGENTS.md` | `~/.dsh/AGENTS.md` |
| `DSH_AUTOBIO_ROOT` | AutoBioMemory 数据根 | `~/.autobiomemory` |
| `DSH_AUTOSCHEMA_HOOKS` | 挂点 JSON 数组 | `["compaction/start"]` |
| `DSH_AUTOSCHEMA_COOLDOWN` | hook 冷却（毫秒） | `1800000`（30 分钟） |

插件加载时会自行以 hook 模式运行；挂点与冷却以插件层为准（上表），`trigger.minNewDiaries` 仍从 `config.json` 读取。
想临时关掉插件，按 `cordis.patch.yml` 顶部注释给 `autoschema` 这一层配 `config.disabled: true`。

### C. 从源码（开发用）

需要 Node ≥ 22.19（`pnpm` 建议 11）：

```bash
git clone https://github.com/yangquan0310/autoschema.git && cd autoschema
pnpm install && pnpm run check      # typecheck + 测试 + build
node dist/cli.js doctor
```

## 日常使用

```bash
autoschema init                    # 建状态目录与默认 config.json
autoschema doctor                  # 自检：密钥 / 日记目录与篇数 / AGENTS.md / 配置校验 / DeepSeek 连通性
autoschema propose                 # 分析未消化日记，产出建议（不改任何文件）
autoschema propose --all           # 忽略游标，重新分析全部日记
autoschema propose --limit 10 --since 2026-10-01T00:00:00+08:00 --json
autoschema pending                 # 看待审建议摘要；加 --discard 丢弃
autoschema apply --ids s1,s3       # 只采纳这两条，写回 AGENTS.md（写前快照）
autoschema apply --clear           # 全部采纳；有变更时清掉待审文件
autoschema show                    # 打印当前解析出的图式
autoschema history                 # 列出历次快照（回滚 = 手动把快照拷回 AGENTS.md）
autoschema due                     # 只检查"现在该不该跑"（schedule 闸门）
autoschema tick                    # 交给 cron / systemd timer 调用；幂等
autoschema daemon --interval 300   # 内置循环，默认每 60 秒检查一次闸门
autoschema cron                    # 打印建议的 crontab 行
autoschema reset-cursor            # 清空消化游标与待审建议
```

通用参数：`--agents <file>`、`--memory <dir>`、`--diaries <dirs>`（逗号分隔）、`--state <dir>`、`--verbose`；
完整命令见 `autoschema help`。

## 状态文件

默认状态根是 `~/.autoschema/`（可用 `--state` 或插件层的 `DSH_AUTOSCHEMA_ROOT` 改）：

| 路径 | 内容 |
| --- | --- |
| `config.json` | 配置（不含密钥；`init` 时不写入 `deepseek` 段） |
| `state/cursor.json` | 消化游标：`proposed`（已出建议）/ `digested`（已吸收） |
| `state/pending.json` | 待审建议（`apply` 消费） |
| `state/last-run.json` | 最近一次分析的摘要（平衡度 / 条数 / 日记篇数） |
| `history/` | `apply` 前的 `AGENTS.md` 快照与 `changelog.jsonl` |

DeepSeek 密钥：进程环境变量 `DEEPSEEK_API_KEY`（也接受 `AUTOBIO_DEEPSEEK_API_KEY` 兜底），
或写在 `.env` 里放到状态根 / `~/.dsh/` / AutoBioMemory 数据根，按此顺序查找。

## 日记位置（可配置）

```jsonc
// ~/.autoschema/config.json
"diaries": {
  "dirs": ["~/.autobiomemory/events", "/data/another-memory/events"],  // 多目录、支持 ~、去重
  "includeGlobs": ["*.json"],
  "strict": false        // true = 不回落到 <memoryRoot>/events
}
```

CLI 也可临时覆盖：`autoschema propose --diaries /a/events,/b/events`（覆盖 `diaries.dirs`）。

## 什么时候跑（触发方式）

三种入口可同时用：

- **CLI（manual）**：`propose` / `apply` 随时可用，不看闸门。
- **schedule**：`tick` / `daemon` / `cron`。要求 `config.json` 的 `trigger.modes` 含 `"schedule"`，
  并通过冷却与未消化数量（以及可选的每日固定时刻）闸门。
- **hook**：装进 dsh profile 的插件。挂点与冷却由插件层配置（默认 `compaction/start`、30 分钟），
  闸门还要求未消化日记数 ≥ `trigger.minNewDiaries`。

`config.json` 里的 trigger 配置（CLI 侧）：

```jsonc
"trigger": {
  "modes": ["manual", "schedule"],   // 只影响自动触发；CLI 不受影响，插件会自行启用 hook
  "cooldownMs": 3600000,             // 自动触发共用冷却（毫秒）
  "minNewDiaries": 5,                // 未消化日记不足 5 篇就不跑
  "maxAdditions": 4,                 // 单次 apply 最多新增几条（跨三节合计）
  "maxRemovals": 2,                  // 单次 apply 最多删除几条（跨三节合计）
  "schedule": {
    "intervalMinutes": 1440,         // 最小间隔（分钟），与 cooldownMs 取较大者
    "atTime": "03:30",               // 可选：每天本地时间固定时刻跑
    "skipIfOverdueMinutes": 720      // 错过窗口超过 12 小时就跳过这次
  }
}
```

hook 的挂点与冷却在插件层（见安装 B 的环境变量表），不在 `config.json` 的 `trigger.hook` 里配——
插件层会覆盖它。可挂的生命周期点：`compaction/start`（默认）、`agent/pre-step`、`agent/idle`、`session/start`。

**只喂未消化的日记**：`state/cursor.json` 记 `proposed`（已出建议）与 `digested`（已吸收），
两者命中其一就不再喂；`propose --all` 或 `digest.onlyUndigested=false` 可关掉这个过滤。
`propose` / 定时 / hook 的产出写进 `state/pending.json`，`apply` 直接消费它，**不再二次调用模型**；
没有产出建议时游标不会标记，下一轮还会再试同一批。

## 它怎么判断（皮亚杰）

| 概念 | 在本项目里的含义 |
| --- | --- |
| **图式 schema** | `AGENTS.md` 三节：风格（外在可观察行为）/ 信念（内在价值原则）/ 价值观（冲突时的排序） |
| **经验** | AutoBioMemory 的第一人称事件日记（`events/<id>.json` + 同名 `.md`） |
| **非平衡 disequilibrium** | 日记里的实际行为与图式冲突，且反复出现（≥2 次或明显一贯） |
| **同化 assimilation** | 修订已有要点的措辞（`modify`），让旧结构容纳新经验 |
| **顺应 accommodation** | 改变图式的**结构**：新增 / 删除 / 重排（`add` / `remove` / `reorder`） |
| **平衡 equilibration** | 冲突被消化、图式与经验重新自洽；`equilibriumScore` 为 0~1（0=完全冲突，1=完全自洽） |

力度顺序是**改优于增、增优于删**：单次分析里 `add` ≤ 4 条、`remove` ≤ 2 条；
落盘时 `trigger.maxAdditions` / `trigger.maxRemovals` 会再拦一次（同样按跨三节合计计数），
且不会把某一节删空。

指导语全文见 [`docs/piaget-guide.md`](docs/piaget-guide.md)，响应契约在 [`src/prompt.ts`](src/prompt.ts)。

## 安全边界

- `propose` 只读：不写 `AGENTS.md`，只更新 `state/cursor.json`、`state/pending.json`、`state/last-run.json`。
- 只有显式 `apply` 才写 `AGENTS.md`，且写前快照到 `<stateRoot>/history/`；没有实际变更就不写、不快照。
- 改 / 删必须能就近匹配到现有条目，定位不到就丢弃并报告，**绝不把"改"降级成"追加"**。
- 新增按规范化文本去重（忽略空白、常见标点与大小写），完全相同的条目不重复加。
- 只改三节里的要点条目：各节 `> 说明` 等非条目行会保留（渲染时放在该节条目之前），
  三节之外的原文原样保留；整节为空（没有条目也没有说明行）的标题会被略去。
- `schedule` / `hook` / 插件的自动触发只产出建议，不写文件。

## 文档

- [`docs/architecture.md`](docs/architecture.md) — 架构与数据流
- [`docs/piaget-guide.md`](docs/piaget-guide.md) — 皮亚杰式分析指导语（人读版）
- [`docs/development.md`](docs/development.md) — 分支模型、测试、发布

## License

MIT
