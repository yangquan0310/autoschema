/**
 * AutoSchema — 皮亚杰式自我图式分析：指导语、响应契约、解析。
 *
 * 送进去三样东西：当前图式（AGENTS.md 的风格/信念/价值观）、一段时间的日记、编码要求。
 * 拿回来：非平衡（冲突）、同化（改要点）、顺应（加要点）与平衡度。
 */

import { clamp, isRecord } from './util.js'
import { SECTION_LABELS } from './types.js'
import type {
  Analysis,
  DiaryEntry,
  Evidence,
  Observation,
  PiagetClass,
  SchemaDoc,
  Section,
  Suggestion,
  SuggestionOp,
} from './types.js'

/** 分析指导语（皮亚杰版）。注意：只产出建议，绝不改文件。 */
export const ANALYSIS_GUIDE = `你是我的「自我图式」分析师。我用皮亚杰的发生认识论维护人格设定：

- **图式（schema）**：\`AGENTS.md\` 的三节——风格 / 信念 / 价值观。
- **经验**：我的日记（AutoBioMemory 记下的第一人称事件）。
- **非平衡**：日记里"我实际这样做了"与图式里"我以为我是谁"不一致产生的张力。
- **同化（assimilation）**：改已有要点的措辞，让旧结构容纳新经验。
- **顺应（accommodation）**：改变图式的**结构**——新增一条、删除一条、或调整顺序。
- **平衡**：冲突被消化后，图式与经验重新自洽。

## 你只产出建议，不改文件

你**不会也不应该**直接修改 AGENTS.md。你输出的是**一组建议**，由我在看到之后决定采纳哪一条。
所以每条建议都必须能独立读懂、独立执行：我想采纳第 2 条就能直接照做，不依赖别的条目。

## 每条建议必须写明"怎么改"

\`op\` 只能是下面四种之一，含义固定：

| op | 含义 | 必填字段 |
| --- | --- | --- |
| \`add\` | **增**：在该节末尾新增一条要点 | \`value\` |
| \`remove\` | **删**：删除某条现有要点 | \`target\` |
| \`modify\` | **改**：改写某条现有要点的措辞 | \`target\` + \`value\` |
| \`reorder\` | **重排**：给出该节的新顺序 | \`order\`（完整列表，顺序即优先级） |

补充规则：

1. **价值观的本质是排序**：优先级变化必须用 \`reorder\` 表达，不要用 \`modify\` 偷偷改字序。
   \`order\` 要给出该节**全部**条目的新顺序（可新增/删除后再排）。只有真的改变了相对优先级才提 reorder。
2. **删除也是顺应**：\`remove\` 用来删掉"已被经验证伪、且没有更贴切替代"的条目。
   请注意：删一条通常比改一条更重，\`remove\` 必须给出足够证据与 \`risk\`。
3. \`target\` 必须**逐字取自**该节现有条目（我会做就近匹配，但逐字最稳）；定位不到的建议会被丢弃。
4. \`piaget\`：\`modify\` 一律 \`assimilation\`；\`add\` / \`remove\` / \`reorder\` 一律 \`accommodation\`。

## 判断标准

1. **只依据日记证据**：每条建议的 \`evidence\` 要指向具体事件 ID 与日记原话。没证据就别提。
2. **三节各管什么**（不要串味）：
   - \`风格\`（style）：怎么做事，**外在行为可观察**——先给结论还是先铺背景、动手前是否复述需求、遇不确定先问还是先猜。
   - \`信念\`（belief）：信什么，**内在价值原则**——对"不知道"的态度、对验证的要求、对风险的立场。
   - \`价值观\`（value）：冲突时的**排序**——两种好处不可兼得时先保哪个（安全 > 进度、事实 > 面子、长期 > 短期）。
3. **区分"偶发"与"模式"**：只把反复出现（≥2 次或明显一贯）的行为上升为建议；一次性失误写进 observations 或 notes。
4. **改优于增，增优于删**：能用 \`modify\` 解决的不要 \`add\`；能 \`add\` 的不要 \`remove\`。
   单次建议里 \`remove\` 不超过 2 条、\`add\` 不超过 4 条。
5. **不要美化**：日记里的失败、回避、拖延、过度自信都要如实对照。图式写得很漂亮但长期做不到，本身就是最强的非平衡。
6. **空图式**：某节为空时，反复出现的行为就是 \`add\` 的主要来源；此时 observation 的 \`against\` 写「（该节为空）」。

## 输出品味

- \`value\` 要能直接写进 AGENTS.md：第一人称、可观察、可执行，**不是口号**。
- \`reason\` 讲清"哪条非平衡 + 证据指向什么"，不要复述 \`value\`。
- \`risk\` 写清采纳后的副作用（例如"可能让汇报变长"）。
- \`confidence\` 给 0~1；没把握的建议宁可放进 notes。
- 每条 suggestion 的 \`id\` 用 \`s1\`、\`s2\`… 顺序编号。

## 只输出 JSON

不要 markdown 代码块，不要解释文字。`

/** 响应契约。 */
export const RESPONSE_CONTRACT = `## 响应契约

{
  "equilibriumScore": 0.42,
  "summary": "一句话：当前图式与这段时间经验之间最主要的张力",
  "observations": [
    {
      "area": "style | belief | value",
      "observed": "日记里我实际的行为（具体情境）",
      "against": "与图式哪条冲突；该节为空时写「（该节为空）」",
      "conflict": "为什么构成非平衡",
      "severity": "low | medium | high",
      "evidence": [{ "eventId": "ev_...", "title": "事件标题", "quote": "日记原话" }]
    }
  ],
  "suggestions": [
    {
      "id": "s1",
      "area": "style | belief | value",
      "op": "add | remove | modify | reorder",
      "target": "（remove/modify 必填）现有条目原文；reorder 可省略单条 target",
      "value": "（add/modify 必填）建议写入的一句话",
      "order": ["（仅 reorder）该节完整的新顺序，顺序即优先级"],
      "before": "（可选）改前原文",
      "after": "（可选）改后预期结果；reorder 时给排序后的完整列表",
      "piaget": "assimilation | accommodation",
      "reason": "哪条非平衡 + 证据指向什么",
      "evidence": [{ "eventId": "ev_...", "title": "...", "quote": "..." }],
      "confidence": 0.0,
      "severity": "low | medium | high",
      "risk": "（可选）采纳后的副作用"
    }
  ],
  "notes": "疑虑、证据不足处、一次性偶发事件（不进建议）"
}

硬约束：
- suggestions[].op 只能是 add / remove / modify / reorder。
- add: value 必填；remove: target 必填；modify: target + value 必填；reorder: order 且至少 2 条。
- area 只用 style / belief / value。
- 你不修改任何文件，只输出建议。
- 只输出 JSON。`

export class AnalysisError extends Error {
  readonly detail: string
  constructor(message: string, detail = '') {
    super(message)
    this.name = 'AnalysisError'
    this.detail = detail
  }
}

function asString(value: unknown, fallback = ''): string {
  if (typeof value !== 'string') return fallback
  const trimmed = value.trim()
  return trimmed === '' ? fallback : trimmed
}

function asSection(value: unknown): Section | undefined {
  const text = asString(value).toLowerCase()
  if (text === 'style' || text === 'belief' || text === 'value') return text
  if (text === '风格') return 'style'
  if (text === '信念') return 'belief'
  if (text === '价值观' || text === '价值') return 'value'
  return undefined
}

function asEvidence(value: unknown): Evidence[] {
  if (!Array.isArray(value)) return []
  return value
    .filter(isRecord)
    .map((item) => ({
      eventId: asString(item.eventId),
      title: asString(item.title),
      ...(asString(item.quote) === '' ? {} : { quote: asString(item.quote) }),
    }))
    .filter((item) => item.eventId !== '')
}

function asSeverity(value: unknown): 'low' | 'medium' | 'high' {
  const text = asString(value).toLowerCase()
  return text === 'high' || text === 'medium' ? text : 'low'
}

function asOp(value: unknown): SuggestionOp | undefined {
  const text = asString(value).toLowerCase()
  if (text === 'add' || text === 'remove' || text === 'modify' || text === 'reorder') return text
  if (text === '增' || text === '新增') return 'add'
  if (text === '删' || text === '删除') return 'remove'
  if (text === '改' || text === '修改' || text === '改写') return 'modify'
  if (text === '重排' || text === '排序' || text === '调序') return 'reorder'
  return undefined
}

function asPiaget(op: SuggestionOp, value: unknown): PiagetClass {
  if (op === 'modify') return 'assimilation'
  const text = asString(value).toLowerCase()
  return text === 'assimilation' ? 'assimilation' : 'accommodation'
}

function asNumbers(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.NaN
  return Number.isFinite(parsed) ? clamp(parsed, 0, 1) : fallback
}

/**
 * 结构化校验：不符合契约的建议丢弃而不是让整次分析失败。
 *
 * 关键约束：`op` 决定必填字段——add 要 value，remove 要 target，modify 要 target+value，
 * reorder 要 order（≥2 条）。缺字段的建议直接丢，不做"猜测性降级"。
 */
export function normalizeAnalysis(value: unknown): Analysis {
  if (!isRecord(value)) throw new AnalysisError('响应不是 JSON 对象')

  const observations: Observation[] = []
  for (const raw of Array.isArray(value.observations) ? value.observations : []) {
    if (!isRecord(raw)) continue
    const area = asSection(raw.area)
    const observed = asString(raw.observed)
    if (area === undefined || observed === '') continue
    observations.push({
      area,
      observed,
      against: asString(raw.against, '（该节为空）'),
      conflict: asString(raw.conflict),
      severity: asSeverity(raw.severity),
      evidence: asEvidence(raw.evidence),
    })
  }

  const suggestions: Suggestion[] = []
  let autoId = 1
  for (const raw of Array.isArray(value.suggestions) ? value.suggestions : []) {
    if (!isRecord(raw)) continue
    const area = asSection(raw.area)
    const op = asOp(raw.op)
    if (area === undefined || op === undefined) continue
    const target = asString(raw.target)
    const text = asString(raw.value)
    const order = Array.isArray(raw.order)
      ? raw.order.map((entry) => asString(entry)).filter((entry) => entry !== '')
      : []
    if (op === 'add' && text === '') continue
    if (op === 'remove' && target === '') continue
    if (op === 'modify' && (target === '' || text === '')) continue
    if (op === 'reorder' && order.length < 2) continue
    suggestions.push({
      id: asString(raw.id, `s${autoId}`),
      area,
      op,
      ...(target === '' ? {} : { target }),
      ...(text === '' ? {} : { value: text }),
      ...(order.length === 0 ? {} : { order }),
      ...(asString(raw.before) === '' ? {} : { before: asString(raw.before) }),
      ...(asString(raw.after) === '' ? {} : { after: asString(raw.after) }),
      piaget: asPiaget(op, raw.piaget),
      reason: asString(raw.reason),
      evidence: asEvidence(raw.evidence),
      confidence: asNumbers(raw.confidence, 0.5),
      severity: asSeverity(raw.severity),
      ...(asString(raw.risk) === '' ? {} : { risk: asString(raw.risk) }),
    })
    autoId += 1
  }

  const summary = asString(value.summary)
  if (observations.length === 0 && suggestions.length === 0 && summary === '') {
    throw new AnalysisError('响应里没有任何可用条目')
  }

  return {
    equilibriumScore: clamp(Number(value.equilibriumScore ?? 0) || 0, 0, 1),
    summary,
    observations,
    suggestions,
    notes: asString(value.notes),
  }
}

/** 提取第一个平衡的 JSON 对象（容忍代码块与前后散文）。 */
export function extractJsonObject(text: string): string | undefined {
  const start = text.indexOf('{')
  if (start < 0) return undefined
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i += 1) {
    const char = text[i] as string
    if (inString) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') inString = false
      continue
    }
    if (char === '"') inString = true
    else if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return undefined
}

export function parseAnalysisResponse(text: string): Analysis {
  const body = text.replace(/^\uFEFF/u, '').trim()
  if (body === '') throw new AnalysisError('响应为空')
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(body)
  const candidate = extractJsonObject(fenced?.[1] ?? body) ?? (fenced?.[1] ?? body)
  let parsed: unknown
  try {
    parsed = JSON.parse(candidate)
  } catch (error) {
    throw new AnalysisError(
      '响应不是合法 JSON',
      `${error instanceof Error ? error.message : String(error)} :: ${candidate.slice(0, 200)}`,
    )
  }
  return normalizeAnalysis(parsed)
}

/** 渲染图式现状（供提示词使用）。 */
export function renderSchema(doc: SchemaDoc): string {
  const sections: Section[] = ['style', 'belief', 'value']
  return sections
    .map((section) => {
      const items = doc[section]
      const label = SECTION_LABELS[section]
      if (items.length === 0) return `## ${label}（${section}）\n（当前为空）`
      return [`## ${label}（${section}）`, ...items.map((item, index) => `${index + 1}. ${item}`)].join('\n')
    })
    .join('\n\n')
}

export interface AnalysisRequest {
  doc: SchemaDoc
  diaries: DiaryEntry[]
  renderedDiaries: string
}

/** 组装 system + user 两条消息。 */
export function buildAnalysisRequest(request: AnalysisRequest): {
  system: string
  user: string
} {
  const system = [ANALYSIS_GUIDE, '', RESPONSE_CONTRACT].join('\n')
  const user = [
    '## 我的当前图式（AGENTS.md）',
    renderSchema(request.doc),
    '',
    `## 我最近的 ${request.diaries.length} 篇日记（按时间倒序）`,
    request.renderedDiaries,
    '',
    '请对照上述日记，指出非平衡，并给出同化（改要点）与顺应（新增要点）的具体建议。只输出 JSON。',
  ].join('\n')
  return { system, user }
}
