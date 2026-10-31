/**
 * AutoSchema — 从 AutoBioMemory 的数据根读取日记。
 *
 * 只依赖磁盘格式（`events/<id>.json` + `<id>.md`），不 import AutoBioMemory 包：
 * 两个项目独立演进，日记格式是它们之间的契约。
 */

import fs from 'node:fs'
import path from 'node:path'

import { readJsonFile, readTextFile, truncate } from './util.js'
import type { DiaryEntry } from './types.js'

interface RawEvent {
  id?: string
  diary?: string
  structured?: {
    title?: string
    startedAt?: string
    endedAt?: string
    tags?: string[]
    people?: Array<{ name?: string }>
    outcome?: { status?: string }
  }
  updatedAt?: string
}

export function eventsDir(memoryRoot: string): string {
  return path.join(memoryRoot, 'events')
}

/** 列出所有事件的 id（不做排序）。 */
export function listEventIds(memoryRoot: string): string[] {
  const dir = eventsDir(memoryRoot)
  let names: string[] = []
  try {
    names = fs.readdirSync(dir)
  } catch {
    return []
  }
  return names
    .filter((name) => name.endsWith('.json') && !name.startsWith('_'))
    .map((name) => name.slice(0, -'.json'.length))
}

/** 读一篇日记；正文优先取 `.md`（那才是记忆本体），缺失时回落到 JSON。 */
export function readDiary(memoryRoot: string, eventId: string): DiaryEntry | undefined {
  const json = readJsonFile<RawEvent>(path.join(eventsDir(memoryRoot), `${eventId}.json`))
  if (json === undefined) return undefined
  const md = readTextFile(path.join(eventsDir(memoryRoot), `${eventId}.md`))
  const diary = (md ?? json.diary ?? '').trim()
  if (diary === '') return undefined
  const structured = json.structured ?? {}
  return {
    eventId: json.id ?? eventId,
    occurredAt: structured.startedAt ?? '',
    endedAt: structured.endedAt ?? '',
    title: structured.title ?? '(无标题)',
    status: structured.outcome?.status ?? 'ongoing',
    tags: Array.isArray(structured.tags) ? structured.tags.filter((t): t is string => typeof t === 'string') : [],
    people: Array.isArray(structured.people)
      ? structured.people.map((p) => p?.name ?? '').filter((name) => name !== '')
      : [],
    diary,
  }
}

export interface DiaryQuery {
  limit: number
  /** ISO 时间下界（含）。 */
  since?: string
  /** 总字符预算；超出后停止收集。 */
  maxChars: number
  /** 单篇截断长度。 */
  diaryChars: number
}

/**
 * 取最近 `limit` 篇日记，按时间倒序。
 *
 * 时间取 `structured.startedAt`，无法解析时按事件 id 里的时间戳排序（id 里带了北京时间）。
 */
export function collectDiaries(memoryRoot: string, query: DiaryQuery): DiaryEntry[] {
  const entries: DiaryEntry[] = []
  for (const id of listEventIds(memoryRoot)) {
    const entry = readDiary(memoryRoot, id)
    if (entry !== undefined) entries.push(entry)
  }
  const timeOf = (entry: DiaryEntry): number => {
    const parsed = Date.parse(entry.occurredAt)
    if (!Number.isNaN(parsed)) return parsed
    const fromId = /^ev_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/u.exec(entry.eventId)
    if (fromId !== null) {
      const [, y, mo, d, h, mi, s] = fromId
      return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 8, Number(mi), Number(s))
    }
    return 0
  }
  const sinceMs = query.since === undefined ? undefined : Date.parse(query.since)
  const sorted = entries
    .filter((entry) => (sinceMs === undefined || Number.isNaN(sinceMs) ? true : timeOf(entry) >= sinceMs))
    .sort((a, b) => timeOf(b) - timeOf(a))

  const selected: DiaryEntry[] = []
  let budget = query.maxChars
  for (const entry of sorted) {
    if (selected.length >= query.limit) break
    if (budget <= 0) break
    const body = truncate(entry.diary, query.diaryChars)
    selected.push({ ...entry, diary: body })
    budget -= body.length + 200
  }
  return selected
}

/** 渲染成提示词里的日记块。 */
export function renderDiaries(entries: DiaryEntry[]): string {
  return entries
    .map((entry) => {
      const head = `### ${entry.occurredAt || '(无时间)'} · ${entry.title} · ${entry.status}`
      const meta: string[] = [`事件 ID：${entry.eventId}`]
      if (entry.tags.length > 0) meta.push(`标签：${entry.tags.join('、')}`)
      if (entry.people.length > 0) meta.push(`人物：${entry.people.join('、')}`)
      return [head, meta.join('　|　'), '', entry.diary].join('\n')
    })
    .join('\n\n---\n\n')
}
