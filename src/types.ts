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

/** 一条同化：修订已有要点。 */
export interface AssimilationItem {
  area: Section
  /** 现有要点原文（用于定位）。 */
  target: string
  /** 修订后的要点。 */
  revised: string
  why: string
  evidence: Evidence[]
}

/** 一条顺应：新增要点。 */
export interface AccommodationItem {
  area: Section
  text: string
  why: string
  evidence: Evidence[]
}

/** DeepSeek 返回的分析结果。 */
export interface Analysis {
  /** 0~1，越高表示图式与经验越自洽。 */
  equilibriumScore: number
  summary: string
  disequilibrium: Disequilibrium[]
  assimilation: AssimilationItem[]
  accommodation: AccommodationItem[]
  notes: string
}

/** 应用变更后的结果。 */
export interface ApplyResult {
  changed: boolean
  doc: SchemaDoc
  rendered: string
  applied: { assimilation: number; accommodation: number }
  skipped: string[]
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
  /** 自动模式下的写回策略：propose=只出建议（默认），apply=直接写回。 */
  applyMode: 'propose' | 'apply'
  schedule: ScheduleTriggerConfig
  hook: HookTriggerConfig
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
  /** eventId → 消化时间与所属运行批次。 */
  digested: Record<string, { at: string; runId: string }>
  lastRunAt?: string
  lastRunId?: string
  /** 连续跳过次数（用于 daemon 日志）。 */
  skippedRuns?: number
}

export interface AutoSchemaConfig {
  version: number
  /** AGENTS.md 路径（默认 ~/.dsh/AGENTS.md）。 */
  agentsFile: string
  /** AutoBioMemory 数据根（默认 ~/.autobiomemory）。 */
  memoryRoot: string
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
