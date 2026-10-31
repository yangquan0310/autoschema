/**
 * AutoSchema — AGENTS.md 的解析、渲染与合并。
 *
 * 只认三节：`# 风格` / `# 信念` / `# 价值观`（也接受英文与 `##` 形式）。
 * 其余内容一律原样保留：`> 说明：…` 引用行放 preamble，无法归类的行放 extra，
 * 渲染时按原顺序拼回，保证"只改要点、不动框架"。
 */

import { readTextFile, writeTextAtomic } from './util.js'
import { SECTION_LABELS } from './types.js'
import type { AccommodationItem, AssimilationItem, SchemaDoc, Section } from './types.js'

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

export interface MergeOptions {
  /** 同化时允许的最大"就近匹配"阈值；找不到目标则跳过。 */
  minMatch?: number
}

/**
 * 应用同化与顺应。
 *
 * - 同化：定位 `target` 现有条目并替换为 `revised`；定位不到时记入 `skipped`（不凭空新增，
 *   避免把"改写"退化成"追加"而污染图式）。
 * - 顺应：同一节内按文本去重后追加到末尾。
 */
export function applyChanges(
  doc: SchemaDoc,
  assimilation: AssimilationItem[],
  accommodation: AccommodationItem[],
  options: MergeOptions = {},
): { doc: SchemaDoc; applied: { assimilation: number; accommodation: number }; skipped: string[] } {
  const next: SchemaDoc = structuredClone(doc)
  const skipped: string[] = []
  let appliedAssimilation = 0
  let appliedAccommodation = 0

  for (const item of assimilation) {
    const items = next[item.area]
    const revised = item.revised.trim()
    if (revised === '') {
      skipped.push(`同化条目为空：${item.target}`)
      continue
    }
    let index = findClosestIndex(items, item.target)
    if (index < 0) index = findClosestIndex(items, item.revised)
    if (index < 0) {
      skipped.push(`同化找不到目标（${SECTION_LABELS[item.area]}）：${item.target}`)
      continue
    }
    const before = items[index] ?? ''
    if (normalise(before) === normalise(revised)) {
      skipped.push(`同化后与原条目相同，跳过：${before}`)
      continue
    }
    items[index] = revised
    appliedAssimilation += 1
  }

  for (const item of accommodation) {
    const text = item.text.trim()
    if (text === '') {
      skipped.push('顺应条目为空')
      continue
    }
    const items = next[item.area]
    if (items.some((existing) => normalise(existing) === normalise(text))) {
      skipped.push(`顺应条目已存在：${text}`)
      continue
    }
    items.push(text)
    appliedAccommodation += 1
  }

  void options
  return { doc: next, applied: { assimilation: appliedAssimilation, accommodation: appliedAccommodation }, skipped }
}
