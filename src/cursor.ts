/**
 * AutoSchema — 消化游标：记住"哪些日记已经被吸收进图式"。
 *
 * 为什么要它：
 *   - 定时触发若每次都取"最近 N 篇"，会把同一批日记反复分析（重复烧 token、重复提同样的建议）。
 *   - 只喂**未消化**的日记，非平衡才真正对应"新经验"。
 *
 * 游标存在 `<stateRoot>/state/cursor.json`，`apply`（或自动模式的 propose 成功）后标记消化；
 * 失败不标记，下次重试同一批。
 */

import path from 'node:path'

import { ensureDir, nowIso, readJsonFile, writeJsonFile } from './util.js'
import type { DigestCursor, DiaryEntry } from './types.js'

const VERSION = 1

export function cursorFile(stateRoot: string): string {
  return path.join(stateRoot, 'state', 'cursor.json')
}

export function emptyCursor(): DigestCursor {
  return { version: VERSION, digested: {}, proposed: {} }
}

export function loadCursor(stateRoot: string): DigestCursor {
  const raw = readJsonFile<DigestCursor>(cursorFile(stateRoot))
  if (raw === undefined || typeof raw !== 'object' || typeof raw.digested !== 'object' || raw.digested === null) {
    return emptyCursor()
  }
  return {
    ...emptyCursor(),
    ...raw,
    version: VERSION,
    digested: raw.digested ?? {},
    proposed: raw.proposed ?? {},
  }
}

export function saveCursor(stateRoot: string, cursor: DigestCursor): void {
  ensureDir(path.join(stateRoot, 'state'))
  writeJsonFile(cursorFile(stateRoot), { ...cursor, version: VERSION })
}

export function isDigested(cursor: DigestCursor, eventId: string): boolean {
  return cursor.digested[eventId] !== undefined
}

export function isPending(cursor: DigestCursor, eventId: string): boolean {
  return cursor.proposed[eventId] !== undefined
}

/** 已吸收或已提出建议——两种都不该再喂一次。 */
export function isSettled(cursor: DigestCursor, eventId: string): boolean {
  return isDigested(cursor, eventId) || isPending(cursor, eventId)
}

/** 只保留未消化过的日记（保持传入顺序）。 */
export function filterUndigested(cursor: DigestCursor, entries: DiaryEntry[]): DiaryEntry[] {
  return entries.filter((entry) => !isSettled(cursor, entry.eventId))
}

/** 统计未消化数量（不读正文，只看 id）。 */
export function countUndigested(cursor: DigestCursor, eventIds: string[]): number {
  return eventIds.reduce((sum, id) => (isSettled(cursor, id) ? sum : sum + 1), 0)
}

/** 标记消化；返回新的游标（不落盘）。 */
/** 标记"已吸收"（真正写回了图式）。 */
export function markDigested(
  cursor: DigestCursor,
  eventIds: string[],
  runId: string = nowIso(),
): DigestCursor {
  const digested = { ...cursor.digested }
  const proposed = { ...cursor.proposed }
  const at = nowIso()
  for (const eventId of eventIds) {
    digested[eventId] = { at, runId }
    delete proposed[eventId]
  }
  return { ...cursor, digested, proposed, lastRunAt: at, lastRunId: runId, skippedRuns: 0 }
}

/** 标记"已提出建议、待人工落盘"。 */
export function markProposed(
  cursor: DigestCursor,
  eventIds: string[],
  runId: string = nowIso(),
): DigestCursor {
  const proposed = { ...cursor.proposed }
  const at = nowIso()
  for (const eventId of eventIds) if (cursor.digested[eventId] === undefined) proposed[eventId] = { at, runId }
  return { ...cursor, proposed, lastRunAt: at, lastRunId: runId, skippedRuns: 0 }
}

/** 待落盘的事件 id。 */
export function pendingEventIds(cursor: DigestCursor): string[] {
  return Object.keys(cursor.proposed)
}

/** 清空待落盘标记（拒绝建议时用）。 */
export function clearProposed(cursor: DigestCursor): DigestCursor {
  return { ...cursor, proposed: {} }
}

/** 只记录"跑过但没消化"（证据不足/空结果时也算把这一批看过一遍）。 */
export function markRun(cursor: DigestCursor, runId: string = nowIso()): DigestCursor {
  return { ...cursor, lastRunAt: nowIso(), lastRunId: runId }
}

/** 最近一次运行距今多久（毫秒）；没跑过返回 Infinity。 */
export function msSinceLastRun(cursor: DigestCursor, now = Date.now()): number {
  if (cursor.lastRunAt === undefined) return Number.POSITIVE_INFINITY
  const parsed = Date.parse(cursor.lastRunAt)
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : now - parsed
}

/** 清空消化记录（配合 --reset-cursor）。 */
export function resetCursor(stateRoot: string): void {
  saveCursor(stateRoot, emptyCursor())
}
