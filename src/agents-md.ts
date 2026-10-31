/**
 * AutoSchema — AGENTS.md 的解析、渲染与合并。
 *
 * 只认三节：`# 风格` / `# 信念` / `# 价值观`（也接受英文与 `##` 形式）。
 * 其余内容一律原样保留：`> 说明：…` 引用行放 preamble，无法归类的行放 extra，
 * 渲染时按原顺序拼回，保证"只改要点、不动框架"。
 */

import { readTextFile, writeTextAtomic } from './util.js'
import { SECTION_LABELS } from './types.js'
import type { SchemaDoc, Section, Suggestion } from './types.js'

const HEADING_PATTERNS: Array<{ section: Section; pattern: RegExp }> = [
  { section: 'style', pattern: /^#{1,3}\s*风格/u },
  { section: 'belief', pattern: /^#{1,3}\s*信念/u },
  { section: 'value', pattern: /^#{1,3}\s*价值观/u },
  { section: 'style', pattern: /^#{1,3}\s*style\b/iu },
  { section: 'belief', pattern: /^#{1,3}\s*beliefs?\b/iu },
  { section: 'value', pattern: /^#{1,3}\s*values?\b/iu },
]

const BULLET = /^[-*+]\s+(.*)$/u

function sectionOfHeading(line: string): Section | undefined {
  for (const { section, pattern } of HEADING_PATTERNS) {
    if (pattern.test(line)) return section
  }
  return undefined
}

function emptyDoc(raw: string): SchemaDoc {
  return { style: [], belief: [], value: [], preamble: { style: [], belief: [], value: [] }, extra: [], raw }
}

/**
 * 解析 AGENTS.md。
 *
 * 没有三节标题时返回空条目集合，但 `raw` 与 `extra` 完整保留，渲染时可原样还原。
 */
export function parseSchemaDoc(raw: string): SchemaDoc {
  const doc = emptyDoc(raw)
  let current: Section | undefined
  for (const line of raw.split(/\r?\n/u)) {
    const heading = sectionOfHeading(line)
    if (heading !== undefined) {
      current = heading
      doc.extra.push(line) // 标题原样保留
      continue
    }
    if (current === undefined) {
      if (line.trim() !== '') doc.extra.push(line)
      continue
    }
    if (/^#{1,6}\s/u.test(line)) {
      // 其他标题：结束当前节
      current = undefined
      doc.extra.push(line)
      continue
    }
    const bullet = BULLET.exec(line)
    if (bullet !== null) {
      const item = (bullet[1] ?? '').trim()
      if (item !== '') doc[current].push(item)
      continue
    }
    if (line.trim().startsWith('>')) {
      doc.preamble[current].push(line.trimEnd())
      continue
    }
    if (line.trim() !== '') doc.preamble[current].push(line.trimEnd())
  }
  return doc
}

export function readSchemaDoc(file: string): SchemaDoc {
  return parseSchemaDoc(readTextFile(file) ?? '')
}

/** 三节的条目总数。 */
export function itemCount(doc: SchemaDoc): number {
  return doc.style.length + doc.belief.length + doc.value.length
}

function headingFor(section: Section, raw: string): string {
  const found = raw.split(/\r?\n/u).find((line) => sectionOfHeading(line) === section)
  return found ?? `# ${SECTION_LABELS[section]}`
}

/**
 * 渲染回 Markdown：标题与说明沿用原文，条目按当前数组输出。
 * `extra` 里出现过标题行，这里用 section 归属重新组织，避免重复。
 */
export function renderSchemaDoc(doc: SchemaDoc): string {
  const headings = new Set(doc.extra.filter((line) => sectionOfHeading(line) !== undefined))
  const sections: Section[] = ['style', 'belief', 'value']
  const hasHeadings = headings.size > 0
  const lines: string[] = []

  // 标题之前的自由内容（若有）
  for (const line of doc.extra) {
    if (sectionOfHeading(line) !== undefined) break
    lines.push(line)
  }
  if (!hasHeadings) {
    // 没有框架：退化为三节输出，方便首次生成
    for (const section of sections) {
      const items = doc[section]
      if (items.length === 0 && doc.preamble[section].length === 0) continue
      lines.push(headingFor(section, doc.raw), '')
      lines.push(...doc.preamble[section])
      if (doc.preamble[section].length > 0) lines.push('')
      for (const item of items) lines.push(`- ${item}`)
      lines.push('')
    }
    return `${lines.join('\n').replace(/\n{3,}/gu, '\n\n').trimEnd()}\n`
  }

  for (const section of sections) {
    const items = doc[section]
    const preamble = doc.preamble[section]
    if (items.length === 0 && preamble.length === 0) continue
    lines.push(headingFor(section, doc.raw), '')
    lines.push(...preamble)
    if (preamble.length > 0) lines.push('')
    for (const item of items) lines.push(`- ${item}`)
    lines.push('')
  }
  // 三节之后的其他内容
  const trailing: string[] = []
  let seenSection = false
  for (const line of doc.extra) {
    const heading = sectionOfHeading(line)
    if (heading !== undefined) {
      seenSection = true
      continue
    }
    if (seenSection) trailing.push(line)
  }
  if (trailing.length > 0) {
    lines.push(...trailing)
    lines.push('')
  }
  return `${lines.join('\n').replace(/\n{3,}/gu, '\n\n').trimEnd()}\n`
}

export function writeSchemaDoc(file: string, doc: SchemaDoc): string {
  const rendered = renderSchemaDoc(doc)
  writeTextAtomic(file, rendered)
  return rendered
}

/* ------------------------------------------------------------------ *
 * 合并：同化改条目、顺应当增条目
 * ------------------------------------------------------------------ */

function normalise(text: string): string {
  return text.replace(/\s+/gu, '').replace(/[。，、；：""''（）()]/gu, '').toLowerCase()
}

/** 在一节里找最接近的条目下标；找不到返回 -1。 */
export function findClosestIndex(items: string[], target: string): number {
  const wanted = normalise(target)
  if (wanted === '') return -1
  let best = -1
  let bestScore = 0
  items.forEach((item, index) => {
    const candidate = normalise(item)
    let score = 0
    if (candidate === wanted) score = 1
    else if (candidate.includes(wanted) || wanted.includes(candidate)) {
      score = Math.min(candidate.length, wanted.length) / Math.max(candidate.length, wanted.length)
    } else {
      // 字符级重合度：皮亚杰式的"就近改写"通常共享大部分字词
      const chars = new Set(candidate)
      let shared = 0
      for (const char of new Set(wanted)) if (chars.has(char)) shared += 1
      score = shared / Math.max(1, Math.min(chars.size, new Set(wanted).size))
    }
    if (score > bestScore) {
      bestScore = score
      best = index
    }
  })
  return bestScore >= 0.5 ? best : -1
}

export interface ApplyOptions {
  /** 只采纳这些 id；缺省表示全部采纳。 */
  ids?: string[]
  /** 单次最多删几条（默认 2）。 */
  maxRemovals?: number
  /** 单次最多新增几条（默认 4）。 */
  maxAdditions?: number
}

export interface ApplyOutcome {
  doc: SchemaDoc
  rendered: string
  applied: { add: number; remove: number; modify: number; reorder: number }
  /** 未采纳 / 无法定位的建议及原因。 */
  rejected: string[]
}

function describe(area: Section, op: string, what: string): string {
  return `[${SECTION_LABELS[area]}·${op}] ${what}`
}

/**
 * 采纳建议（**只由显式调用触发**，默认流程从不执行它）。
 *
 * 建议本身只描述"怎么改"，这里负责定位与落地：
 * - `modify`：就近匹配 `target` → 替换为 `value`
 * - `add`：同节去重后追加
 * - `remove`：就近匹配 `target` → 删除（不删空该节、受 maxRemovals 限制）
 * - `reorder`：按 `order` 重排（未提及的条目按原相对顺序排在末尾，不丢弃）
 *
 * 定位不到就进 `rejected`，**绝不**把"改"悄悄变成"增"。
 */
export function applySuggestions(
  doc: SchemaDoc,
  suggestions: Suggestion[],
  options: ApplyOptions = {},
): ApplyOutcome {
  const next: SchemaDoc = structuredClone(doc)
  const rejected: string[] = []
  const applied = { add: 0, remove: 0, modify: 0, reorder: 0 }
  const maxRemovals = options.maxRemovals ?? 2
  const maxAdditions = options.maxAdditions ?? 4
  const wanted = options.ids === undefined ? undefined : new Set(options.ids)
  let added = 0
  let removed = 0

  for (const suggestion of suggestions) {
    if (wanted !== undefined && !wanted.has(suggestion.id)) continue
    const items = next[suggestion.area]
    const label = SECTION_LABELS[suggestion.area]

    if (suggestion.op === 'modify') {
      const revised = (suggestion.value ?? '').trim()
      const target = (suggestion.target ?? '').trim()
      if (revised === '' || target === '') {
        rejected.push(describe(suggestion.area, 'modify', `缺少 target 或 value：${suggestion.id}`))
        continue
      }
      let index = findClosestIndex(items, target)
      if (index < 0) index = findClosestIndex(items, revised)
      if (index < 0) {
        rejected.push(describe(suggestion.area, 'modify', `定位不到条目：${target}`))
        continue
      }
      if (normalise(items[index] ?? '') === normalise(revised)) {
        rejected.push(describe(suggestion.area, 'modify', `改后与原条目相同：${target}`))
        continue
      }
      items[index] = revised
      applied.modify += 1
      continue
    }

    if (suggestion.op === 'add') {
      const text = (suggestion.value ?? '').trim()
      if (text === '') {
        rejected.push(describe(suggestion.area, 'add', `缺少 value：${suggestion.id}`))
        continue
      }
      if (added >= maxAdditions) {
        rejected.push(describe(suggestion.area, 'add', `超过单次新增上限 ${maxAdditions}：${text}`))
        continue
      }
      if (items.some((existing) => normalise(existing) === normalise(text))) {
        rejected.push(describe(suggestion.area, 'add', `条目已存在：${text}`))
        continue
      }
      items.push(text)
      added += 1
      applied.add += 1
      continue
    }

    if (suggestion.op === 'remove') {
      const target = (suggestion.target ?? '').trim()
      if (target === '') {
        rejected.push(describe(suggestion.area, 'remove', `缺少 target：${suggestion.id}`))
        continue
      }
      const index = findClosestIndex(items, target)
      if (index < 0) {
        rejected.push(describe(suggestion.area, 'remove', `定位不到条目：${target}`))
        continue
      }
      if (removed >= maxRemovals) {
        rejected.push(describe(suggestion.area, 'remove', `超过单次删除上限 ${maxRemovals}：${target}`))
        continue
      }
      if (items.length <= 1) {
        rejected.push(describe(suggestion.area, 'remove', `拒绝删空该节：${target}`))
        continue
      }
      items.splice(index, 1)
      removed += 1
      applied.remove += 1
      continue
    }

    // reorder
    const order = Array.isArray(suggestion.order)
      ? suggestion.order.map((entry) => String(entry).trim()).filter((entry) => entry !== '')
      : []
    if (order.length < 2) {
      rejected.push(describe(suggestion.area, 'reorder', `order 至少需要 2 条：${suggestion.id}`))
      continue
    }
    const taken = new Set<number>()
    const head: string[] = []
    for (const entry of order) {
      const index = findClosestIndex(items, entry)
      if (index < 0 || taken.has(index)) {
        rejected.push(describe(suggestion.area, 'reorder', `定位不到条目：${entry}`))
        continue
      }
      taken.add(index)
      head.push(items[index] as string)
    }
    if (taken.size < 2) {
      rejected.push(describe(suggestion.area, 'reorder', '可匹配条目不足 2 条，放弃重排'))
      continue
    }
    const rest = items.filter((_, index) => !taken.has(index))
    const before = items.join('\u0000')
    next[suggestion.area] = [...head, ...rest]
    if (next[suggestion.area].join('\u0000') === before) {
      rejected.push(describe(suggestion.area, 'reorder', '顺序未变化'))
      continue
    }
    applied.reorder += 1
  }

  return { doc: next, rendered: renderSchemaDoc(next), applied, rejected }
}
