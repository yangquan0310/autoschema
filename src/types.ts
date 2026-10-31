/**
 * AutoSchema — 共享类型契约。
 *
 * 皮亚杰式的自我图式演化：
 *   非平衡（disequilibrium）：日记里"我实际怎么做的"与 AGENTS.md 里"我以为我是谁"冲突
 *   同化（assimilation）    ：改现有要点，让旧图式容纳新经验
 *   顺应（accommodation）   ：加新要点，让图式本身被改写
 *   平衡（equilibration）   ：冲突被消化，图式与经验重新自洽
 */

/** AGENTS.md 的三个人格分区。 */
export type Section = 'style' | 'belief' | 'value'

/** 分区中文名，用于提示词与报告。 */
export const SECTION_LABELS: Record<Section, string> = {
  style: '风格',
  belief: '信念',
  value: '价值观',
}

/** 解析后的 AGENTS.md。`preamble[section]` 保留 `> 说明：…` 这类非条目行。 */
export interface SchemaDoc {
  style: string[]
  belief: string[]
  value: string[]
  preamble: Record<Section, string[]>
  /** 未识别的原文行（保序），渲染时原样带回。 */
  extra: string[]
  raw: string
}

/** 一篇日记（AutoBioMemory 的 events/<id>.md 正文 + 元信息）。 */
export interface DiaryEntry {
  eventId: string
  occurredAt: string
  endedAt: string
  title: string
  status: string
  tags: string[]
  people: string[]
  diary: string
}

/** 指向一条日记证据。 */
export interface Evidence {
  eventId: string
  title: string
  /** 日记里的原话片段。 */
  quote?: string
}

/** 一条非平衡：图式与经验的具体冲突。 */
export interface Disequilibrium {
  area: Section
  /** 日记中观察到的行为/倾向。 */
  observed: string
  /** 与哪条现有要点（或"缺失"）冲突。 */
  against: string
  /** 冲突的性质：说明为什么这构成非平衡。 */
  conflict: string
  severity: 'low' | 'medium' | 'high'
  evidence: Evidence[]
}

/**
 * 一条建议的操作类型。
 *
 * - `add`    增：在该节末尾新增一条要点（`value` 为新增文本）
 * - `remove` 删：删除某条现有要点（`target` 定位，`value` 省略）
 * - `modify` 改：改写某条现有要点（`target` + `value`）
 * - `reorder` 重排：给出该节的新顺序（`order`），**价值观的优先级只能靠它表达**
 */
export type SuggestionOp = 'add' | 'remove' | 'modify' | 'reorder'

/** 这条建议在图式理论上属于哪一类变化（便于 agent 判断力度）。 */
export type PiagetClass = 'assimilation' | 'accommodation'

/**
 * 一条建议 —— 只描述"如果要改，应该怎么改"，不执行。
 *
 * 是否采纳、采纳哪几条，由调用方（agent / 人）决定。
 */
export interface Suggestion {
  /** 稳定短 id，便于 `apply --ids s1,s3` 精确采纳。 */
  id: string
  area: Section
  op: SuggestionOp
  /** remove / modify / reorder 必填：现有条目原文（应用时会做就近匹配定位）。 */
  target?: string
  /** add / modify 必填：建议写入的文本。 */
  value?: string
  /** reorder 必填：该节重新排序后的条目原文列表，顺序即优先级。 */
  order?: string[]
  /** reorder/add 之外的"改前"原文，便于 diff 展示。 */
  before?: string
  /** 应用后的预期结果（reorder 时是排序后的完整列表）。 */
  after?: string
  /** 皮亚杰分类：同化（改措辞）还是顺应（结构变化：增/删/重排）。 */
  piaget: PiagetClass
  /** 为什么这么改：非平衡在哪儿、证据指向什么。 */
  reason: string
  evidence: Evidence[]
  /** 0~1，模型对这条建议的把握。 */
  confidence: number
  severity: 'low' | 'medium' | 'high'
  /** 写回后可能的副作用（让人/agent 有心理准备）。 */
  risk?: string
}

/** 一条观察到的非平衡（冲突本身，不是改法）。 */
export interface Observation {
  area: Section
  /** 日记里我实际的行为（具体情境）。 */
  observed: string
  /** 与哪条现有要点冲突；该节为空时写「（该节为空）」。 */
  against: string
  /** 为什么这构成张力。 */
  conflict: string
  severity: 'low' | 'medium' | 'high'
  evidence: Evidence[]
}

/** DeepSeek 返回的分析结果：观察 + 建议（建议不落地）。 */
export interface Analysis {
  /** 0~1，越高表示图式与经验越自洽。 */
  equilibriumScore: number
  summary: string
  observations: Observation[]
  suggestions: Suggestion[]
  notes: string
}

/** 采纳建议后的结果（只由显式的 apply 产生）。 */
export interface ApplyResult {
  changed: boolean
  doc: SchemaDoc
  rendered: string
  applied: { add: number; remove: number; modify: number; reorder: number }
  /** 未被采纳或无法定位的建议及原因。 */
  rejected: string[]
  snapshot?: string
}

/* ------------------------------------------------------------------ */

export interface DeepseekConfig {
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  timeoutMs: number
  jsonMode: boolean
  retries: number
}

/** 触发方式：manual=只手动；schedule=定时（外部 cron/timer 或内置 daemon）；hook=挂 dsh 生命周期。 */
export type TriggerMode = 'manual' | 'schedule' | 'hook'

/** hook 允许挂在哪些 dsh 生命周期点（"特定的"挂点，不是任意事件）。 */
export type HookEvent = 'compaction/start' | 'agent/pre-step' | 'agent/idle' | 'session/start'

export interface ScheduleTriggerConfig {
  /** 最小间隔（分钟）；到点且满足 minNewDiaries 才跑。 */
  intervalMinutes: number
  /** 可选：每天固定时刻跑（HH:MM，本地时区），设置后优先于 intervalMinutes。 */
  atTime?: string
  /** 错过时间窗太久的任务是否跳过（避免开机时补跑一堆）。 */
  skipIfOverdueMinutes: number
}

export interface HookTriggerConfig {
  /** 挂点集合；默认只有 compaction/start——特定、可控。 */
  events: HookEvent[]
  /** hook 触发的冷却（毫秒），避免每步都跑。 */
  cooldownMs: number
}

export interface TriggerConfig {
  /** 可同时开多种；manual 始终可用（CLI）。 */
  modes: TriggerMode[]
  /** 任何触发方式共用的最小间隔（毫秒）。 */
  cooldownMs: number
  /** 至少有多少篇"未消化"日记才值得跑。 */
  minNewDiaries: number
  /**
   * 自动触发（schedule / hook）永远只产出建议，不写 AGENTS.md——
   * 决定权在 agent。这里只控制建议里允许出现多少条删除/新增（防止一次提一堆）。
   */
  maxRemovals: number
  maxAdditions: number
  schedule: ScheduleTriggerConfig
  hook: HookTriggerConfig
}

/** 日记来源：可直接指向一个或多个"事件目录"（不必是 AutoBioMemory 的数据根）。 */
export interface DiariesConfig {
  /** 事件目录列表；支持 `~` 与相对路径（相对 cwd）。为空时回落到 `<memoryRoot>/events`。 */
  dirs: string[]
  /** 认为哪些文件是一个事件（默认 *.json + 同名 .md）。 */
  includeGlobs: string[]
  /** 只读这些目录，不在别处找（默认 false：还会回落 memoryRoot/events）。 */
  strict: boolean
}

export interface DigestConfig {
  /** 单次最多喂多少篇。 */
  limit: number
  /** 只喂未消化过的日记（默认 true）。 */
  onlyUndigested: boolean
  /** 单篇截断长度。 */
  diaryChars: number
  /** 总输入预算（字符）。 */
  maxInputChars: number
}

/** 消化游标：哪些日记已经被"吸收"进图式。 */
export interface DigestCursor {
  version: number
  /** eventId → 已吸收进图式的时间与批次。 */
  digested: Record<string, { at: string; runId: string }>
  /** eventId → 已分析出建议、但还没落盘的时间与批次（避免定时反复烧 token）。 */
  proposed: Record<string, { at: string; runId: string }>
  lastRunAt?: string
  lastRunId?: string
  /** 连续跳过次数（用于 daemon 日志）。 */
  skippedRuns?: number
}

/** 待落盘的建议（`analyze` 产出、`apply` 消费，避免二次调用模型）。 */
export interface PendingProposal {
  at: string
  runId: string
  analysis: Analysis
  eventIds: string[]
}

export interface AutoSchemaConfig {
  version: number
  /** AGENTS.md 路径（默认 ~/.dsh/AGENTS.md）。 */
  agentsFile: string
  /** AutoBioMemory 数据根（默认 ~/.autobiomemory）；`diaries.dirs` 为空时用它下面的 events/。 */
  memoryRoot: string
  /** 日记位置（可多个目录，显式配置）。 */
  diaries: DiariesConfig
  /** 总结时取多少篇最近日记。 */
  diaryLimit: number
  /** 只取该时间点之后的日记（ISO，可空）。 */
  since?: string
  /** 单篇日记进提示词的最大字符数。 */
  diaryChars: number
  /** 总输入预算（字符）。 */
  maxInputChars: number
  /** 自身状态根（快照与变更历史）。 */
  stateRoot: string
  trigger: TriggerConfig
  digest: DigestConfig
  deepseek: DeepseekConfig
}

export interface Logger {
  debug(message: string, ...args: unknown[]): void
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
  error(message: string, ...args: unknown[]): void
}

/** 可注入的 DeepSeek 传输层，测试用假实现。 */
export interface ChatClient {
  chat(messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<string>
}
