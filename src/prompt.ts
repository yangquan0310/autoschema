/**
 * AutoSchema — 皮亚杰式自我图式分析：指导语、响应契约、解析。
 *
 * 送进去三样东西：当前图式（AGENTS.md 的风格/信念/价值观）、一段时间的日记、编码要求。
 * 拿回来：非平衡（冲突）、同化（改要点）、顺应（加要点）与平衡度。
 */

import { clamp, isRecord } from './util.js'
import { SECTION_LABELS } from './types.js'
import type {
  AccommodationItem,
  Analysis,
  AssimilationItem,
  DiaryEntry,
  Disequilibrium,
  Evidence,
  SchemaDoc,
  Section,
} from './types.js'

/** 事件编码指导语（皮亚杰版）。 */
export const ANALYSIS_GUIDE = `你是我的「自我图式」分析师。我用皮亚杰的发生认识论来维护自己的人格设定：

- **图式（schema）**：我的 \`AGENTS.md\` 里的「风格 / 信念 / 价值观」三节，就是我的自我图式。
- **经验**：我的日记（AutoBioMemory 记下的、我实际怎么想怎么做的第一人称记录）。
- **非平衡（disequilibrium）**：日记里"我实际这样做了"与图式里"我以为我是谁"不一致所引发的张力。
- **同化（assimilation）**：改动已有要点，让旧图式容纳新经验——图式结构不变，措辞/边界被修订。
- **顺应（accommodation）**：新增要点（必要时调整原有条目的边界），让图式本身被改写以适应经验。
- **平衡（equilibration）**：冲突被消化后，图式与经验重新自洽。

## 你要做的判断

1. **只依据日记证据**：每条结论都必须能指向具体事件 ID 与日记原话。没有证据就不要提。
2. **三节各管什么**（不要串味）：
   - \`${SECTION_LABELS.style}\`（style）：怎么做事，**外在行为可观察**——先给结论还是先铺背景、动手前是否复述需求、遇到不确定先问还是先猜、报告密度与格式等。
   - \`${SECTION_LABELS.belief}\`（belief）：信什么，**内在价值原则**——对"不知道"的态度、对验证的要求、对风险与诚实的主张等。
   - \`${SECTION_LABELS.value}\`（value）：冲突时的**排序**——当两种好处不可兼得时我先保哪个（如 安全 > 进度、事实 > 面子、长期 > 短期）。
3. **区分"偶发"与"模式"**：只把**反复出现**（≥2 次或构成明显一贯性）的行为上升为图式改动；一次性的偶然失误最多写进 notes。
4. **同化优先，顺应克制**：能用现有要点的修订解释过去的，就不要新增；新增只在"现有图式确实没有这一维"时发生。新增总量建议 ≤ 3 条。
5. **不要美化**：日记里的失败、回避、拖延、过度自信都要如实对照图式。如果图式写得很漂亮但日记里长期做不到，这本身就是最强的非平衡。
6. **空图式的情形**：如果某一节现在没有任何条目，那么日记里反复出现的行为就是**顺应**的主要来源，此时非平衡的 \`against\` 记为「（该节为空）」。

## 输出的品味

- \`observed\` 要具体到"我在什么情境下做了什么"，不是形容词。
- \`against\` 要引用图式原文（或标出该节为空）。
- \`conflict\` 要讲清为什么这构成张力，而不是重复 observed。
- 同化的 \`revised\` 要是可以直接替换进 AGENTS.md 的一句话，第一人称、可观察、可执行；不要写成口号。
- 顺应的 \`text\` 同理，一句话，且不要和已有条目语义重复。

## 只在 JSON 里回答

- \`equilibriumScore\`：0~1，越高表示图式与经验越自洽（三节都为空时应偏低，因为尚未确立自我描述）。
- 只输出 JSON，不要 markdown 代码块，不要解释文字。`

/** 响应契约（字段与语义）。 */
export const RESPONSE_CONTRACT = `## 响应契约

{
  "equilibriumScore": 0.42,
  "summary": "一句话：当前图式与这段时间的经验之间，最主要的张力是什么",
  "disequilibrium": [
    {
      "area": "style | belief | value",
      "observed": "日记里我实际的行为（具体情境）",
      "against": "与图式里的哪条要点冲突；该节为空时写「（该节为空）」",
      "conflict": "为什么这构成非平衡",
      "severity": "low | medium | high",
      "evidence": [{ "eventId": "ev_...", "title": "事件标题", "quote": "日记里的原话片段" }]
    }
  ],
  "assimilation": [
    {
      "area": "style | belief | value",
      "target": "要修订的现有要点原文（必须能在该节里找到，否则此条会被丢弃）",
      "revised": "修订后的一句话，第一人称、可观察、可执行",
      "why": "为什么这样改而不是新增",
      "evidence": [{ "eventId": "ev_...", "title": "...", "quote": "..." }]
    }
  ],
  "accommodation": [
    {
      "area": "style | belief | value",
      "text": "新增的一句话要点",
      "why": "现有图式缺了哪一维",
      "evidence": [{ "eventId": "ev_...", "title": "...", "quote": "..." }]
    }
  ],
  "notes": "疑虑、证据不足处、一次性偶发事件（不进图式）"
}

约束：
- area 只用 style / belief / value 三个值。
- assimilation.target 必须逐字取自该节现有条目，否则这条会被系统丢弃。
- 没有把握的条目宁可放在 notes 里，也不要编造。
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

/** 结构化校验：不符合契约的条目丢弃而不是让整次分析失败。 */
export function normalizeAnalysis(value: unknown): Analysis {
  if (!isRecord(value)) throw new AnalysisError('响应不是 JSON 对象')
  const disequilibrium: Disequilibrium[] = []
  for (const raw of Array.isArray(value.disequilibrium) ? value.disequilibrium : []) {
    if (!isRecord(raw)) continue
    const area = asSection(raw.area)
    const observed = asString(raw.observed)
    if (area === undefined || observed === '') continue
    disequilibrium.push({
      area,
      observed,
      against: asString(raw.against, '（该节为空）'),
      conflict: asString(raw.conflict),
      severity: asSeverity(raw.severity),
      evidence: asEvidence(raw.evidence),
    })
  }

  const assimilation: AssimilationItem[] = []
  for (const raw of Array.isArray(value.assimilation) ? value.assimilation : []) {
    if (!isRecord(raw)) continue
    const area = asSection(raw.area)
    const target = asString(raw.target)
    const revised = asString(raw.revised)
    if (area === undefined || target === '' || revised === '') continue
    assimilation.push({ area, target, revised, why: asString(raw.why), evidence: asEvidence(raw.evidence) })
  }

  const accommodation: AccommodationItem[] = []
  for (const raw of Array.isArray(value.accommodation) ? value.accommodation : []) {
    if (!isRecord(raw)) continue
    const area = asSection(raw.area)
    const text = asString(raw.text)
    if (area === undefined || text === '') continue
    accommodation.push({ area, text, why: asString(raw.why), evidence: asEvidence(raw.evidence) })
  }

  if (disequilibrium.length === 0 && assimilation.length === 0 && accommodation.length === 0) {
    const summary = asString(value.summary)
    if (summary === '') throw new AnalysisError('响应里没有任何可用条目')
  }

  return {
    equilibriumScore: clamp(Number(value.equilibriumScore ?? 0) || 0, 0, 1),
    summary: asString(value.summary),
    disequilibrium,
    assimilation,
    accommodation,
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
