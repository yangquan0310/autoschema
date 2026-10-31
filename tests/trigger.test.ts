import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { loadConfig } from '../src/config.js'
import { loadCursor, markDigested, saveCursor, emptyCursor, markProposed } from '../src/cursor.js'
import { checkDue, cronLine, nextAtTime } from '../src/schedule.js'
import { tick } from '../src/tick.js'
import { silentLogger } from '../src/util.js'
import type { ChatClient } from '../src/types.js'

function workspace(diaries = 6): { agentsFile: string; memoryRoot: string; stateRoot: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autoschema-trig-'))
  const agentsFile = path.join(root, 'AGENTS.md')
  fs.writeFileSync(agentsFile, '# 风格\n\n> **说明：** 风格指怎么做事\n\n- 先给结论\n\n# 信念\n\n- 诚实\n\n# 价值观\n\n- 安全 > 进度\n')
  const memoryRoot = path.join(root, 'mem')
  fs.mkdirSync(path.join(memoryRoot, 'events'), { recursive: true })
  for (let i = 0; i < diaries; i += 1) {
    const id = `ev_2026103${i % 9}T1000${String(i).padStart(2, '0')}_${String(i).padStart(8, 'a')}`
    fs.writeFileSync(
      path.join(memoryRoot, 'events', `${id}.json`),
      JSON.stringify({ id, structured: { title: `事件${i}`, startedAt: `2026-10-3${i % 9}T10:00:00+08:00`, tags: [], people: [], outcome: { status: 'completed' } } }),
    )
    fs.writeFileSync(path.join(memoryRoot, 'events', `${id}.md`), `第 ${i} 篇日记正文。\n`)
  }
  return { agentsFile, memoryRoot, stateRoot: path.join(root, 'state') }
}

const payload = JSON.stringify({
  equilibriumScore: 0.6,
  summary: 's',
  disequilibrium: [],
  assimilation: [{ area: 'style', target: '先给结论', revised: '开口先给结论，需要时再补依据', why: 'w', evidence: [] }],
  accommodation: [{ area: 'value', text: '长期 > 短期', why: 'w', evidence: [] }],
  notes: '',
})
const client = (): ChatClient => ({ chat: async () => payload })

function configure(ws: ReturnType<typeof workspace>, trigger: Record<string, unknown>, digest: Record<string, unknown> = {}) {
  return loadConfig({
    patch: {
      agentsFile: ws.agentsFile,
      memoryRoot: ws.memoryRoot,
      stateRoot: ws.stateRoot,
      trigger: trigger as never,
      digest: { limit: 10, onlyUndigested: true, diaryChars: 500, maxInputChars: 20000, ...digest } as never,
    },
  })
}

describe('checkDue', () => {
  it('refuses when schedule mode is off', () => {
    const ws = workspace()
    const config = configure(ws, { modes: ['manual'] })
    expect(checkDue(config).due).toBe(false)
    expect(checkDue(config).reason).toContain('未启用 schedule')
  })

  it('refuses while inside the cooldown window', () => {
    const ws = workspace()
    const config = configure(ws, { modes: ['schedule'], cooldownMs: 3_600_000, minNewDiaries: 1, applyMode: 'propose', schedule: { intervalMinutes: 60, skipIfOverdueMinutes: 720 }, hook: { events: [], cooldownMs: 0 } })
    saveCursor(ws.stateRoot, { ...emptyCursor(), lastRunAt: new Date().toISOString() })
    const due = checkDue(config)
    expect(due.due).toBe(false)
    expect(due.reason).toContain('冷却中')
    expect(due.waitMs).toBeGreaterThan(0)
  })

  it('refuses when there are not enough undigested diaries', () => {
    const ws = workspace(3)
    const config = configure(ws, { modes: ['schedule'], cooldownMs: 0, minNewDiaries: 5, applyMode: 'propose', schedule: { intervalMinutes: 1, skipIfOverdueMinutes: 0 }, hook: { events: [], cooldownMs: 0 } })
    expect(checkDue(config).due).toBe(false)
    expect(checkDue(config).reason).toContain('未消化日记不足')
  })

  it('runs once the cooldown elapsed and enough new diaries exist', () => {
    const ws = workspace(6)
    const config = configure(ws, { modes: ['schedule'], cooldownMs: 0, minNewDiaries: 5, applyMode: 'propose', schedule: { intervalMinutes: 1, skipIfOverdueMinutes: 0 }, hook: { events: [], cooldownMs: 0 } })
    const due = checkDue(config)
    expect(due.due).toBe(true)
    expect(due.undigested).toBe(6)
  })

  it('honours the daily atTime window and skips an overdue one', () => {
    const ws = workspace(6)
    const base = { modes: ['schedule'], cooldownMs: 0, minNewDiaries: 1, applyMode: 'propose' as const, hook: { events: [], cooldownMs: 0 } }
    const at = (atTime: string, skip: number) => configure(ws, { ...base, schedule: { intervalMinutes: 1440, atTime, skipIfOverdueMinutes: skip } })

    const now = new Date()
    const today = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
    expect(checkDue(at(today, 720), now).due).toBe(true)

    const twoHoursAgo = new Date(now.getTime() - 2 * 3600_000)
    const past = `${String(twoHoursAgo.getHours()).padStart(2, '0')}:${String(twoHoursAgo.getMinutes()).padStart(2, '0')}`
    expect(checkDue(at(past, 30), now).due).toBe(false)
    expect(checkDue(at(past, 30), now).reason).toContain('错过')
  })

  it('counts only undigested diaries', () => {
    const ws = workspace(6)
    const config = configure(ws, { modes: ['schedule'], cooldownMs: 0, minNewDiaries: 1, applyMode: 'propose', schedule: { intervalMinutes: 1, skipIfOverdueMinutes: 0 }, hook: { events: [], cooldownMs: 0 } })
    const ids = fs.readdirSync(path.join(ws.memoryRoot, 'events')).filter((n) => n.endsWith('.json')).map((n) => n.slice(0, -5))
    saveCursor(ws.stateRoot, markDigested(emptyCursor(), ids.slice(0, 5), 'r1'))
    expect(checkDue(config).undigested).toBe(1)
  })

  it('parses HH:MM and next occurrence', () => {
    const now = new Date('2026-10-31T10:00:00')
    expect(nextAtTime(now, '11:30')).toBe(new Date('2026-10-31T11:30:00').getTime())
    expect(nextAtTime(now, '09:00')).toBe(new Date('2026-11-01T09:00:00').getTime())
    expect(nextAtTime(now, '25:00')).toBeUndefined()
  })

  it('renders a usable crontab line', () => {
    const ws = workspace()
    const hourly = configure(ws, { modes: ['schedule'], cooldownMs: 0, minNewDiaries: 1, applyMode: 'propose', schedule: { intervalMinutes: 60, skipIfOverdueMinutes: 0 }, hook: { events: [], cooldownMs: 0 } })
    expect(cronLine(hourly)).toMatch(/^0 \*\/1 \* \* \* autoschema tick/u)
    const daily = configure(ws, { modes: ['schedule'], cooldownMs: 0, minNewDiaries: 1, applyMode: 'propose', schedule: { intervalMinutes: 1440, atTime: '03:30', skipIfOverdueMinutes: 0 }, hook: { events: [], cooldownMs: 0 } })
    expect(cronLine(daily)).toMatch(/^30 3 \* \* \* autoschema tick/u)
  })
})

describe('tick', () => {
  it('skips when the gate says no', async () => {
    const ws = workspace(2)
    const config = configure(ws, { modes: ['schedule'], cooldownMs: 0, minNewDiaries: 5, applyMode: 'propose', schedule: { intervalMinutes: 1, skipIfOverdueMinutes: 0 }, hook: { events: [], cooldownMs: 0 } })
    const outcome = await tick({ config, client: client(), logger: silentLogger(), origin: 'schedule' })
    expect(outcome.ran).toBe(false)
    expect(outcome.mode).toBe('skipped')
    // 跳过会写 lastRunAt，避免 daemon 每秒重算
    expect(loadCursor(ws.stateRoot).lastRunAt).toBeDefined()
  })

  it('proposes without writing the file in propose mode', async () => {
    const ws = workspace(6)
    const config = configure(ws, { modes: ['schedule'], cooldownMs: 0, minNewDiaries: 1, applyMode: 'propose', schedule: { intervalMinutes: 1, skipIfOverdueMinutes: 0 }, hook: { events: [], cooldownMs: 0 } })
    const before = fs.readFileSync(ws.agentsFile, 'utf8')
    const outcome = await tick({ config, client: client(), logger: silentLogger(), origin: 'schedule' })
    expect(outcome.ran).toBe(true)
    expect(outcome.mode).toBe('proposed')
    expect(fs.readFileSync(ws.agentsFile, 'utf8')).toBe(before)
    expect(Object.keys(loadCursor(ws.stateRoot).proposed).length).toBe(6)
  })

  it('writes when applyMode is apply', async () => {
    const ws = workspace(6)
    const config = configure(ws, { modes: ['hook'], cooldownMs: 0, minNewDiaries: 1, applyMode: 'apply', schedule: { intervalMinutes: 1, skipIfOverdueMinutes: 0 }, hook: { events: ['compaction/start'], cooldownMs: 0 } })
    const outcome = await tick({ config, client: client(), logger: silentLogger(), origin: 'hook' })
    expect(outcome.ran).toBe(true)
    expect(outcome.mode).toBe('applied')
    const written = fs.readFileSync(ws.agentsFile, 'utf8')
    expect(written).toContain('长期 > 短期')
    const cursor = loadCursor(ws.stateRoot)
    expect(Object.keys(cursor.digested).length).toBe(6)
    expect(Object.keys(cursor.proposed).length).toBe(0)
  })

  it('manual origin bypasses the gate but never auto-writes', async () => {
    const ws = workspace(2)
    const config = configure(ws, { modes: ['manual'], cooldownMs: 9_999_999, minNewDiaries: 99, applyMode: 'apply', schedule: { intervalMinutes: 1, skipIfOverdueMinutes: 0 }, hook: { events: [], cooldownMs: 0 } })
    const outcome = await tick({ config, client: client(), logger: silentLogger(), origin: 'manual' })
    expect(outcome.ran).toBe(true)
    expect(outcome.mode).toBe('proposed')
  })

  it('never re-runs the same diaries twice', async () => {
    const ws = workspace(6)
    const config = configure(ws, { modes: ['schedule'], cooldownMs: 0, minNewDiaries: 1, applyMode: 'propose', schedule: { intervalMinutes: 1, skipIfOverdueMinutes: 0 }, hook: { events: [], cooldownMs: 0 } })
    const first = await tick({ config, client: client(), logger: silentLogger(), origin: 'schedule' })
    expect(first.ran).toBe(true)
    const second = await tick({ config, client: client(), logger: silentLogger(), origin: 'schedule' })
    expect(second.ran).toBe(false)
    expect(second.message).toContain('未消化日记不足')
  })
})

describe('hook events', () => {
  it('only the configured events are considered hook points', async () => {
    const ws = workspace()
    const config = configure(ws, { modes: ['hook'], cooldownMs: 0, minNewDiaries: 1, applyMode: 'propose', schedule: { intervalMinutes: 1, skipIfOverdueMinutes: 0 }, hook: { events: ['compaction/start'], cooldownMs: 0 } })
    expect(config.trigger.hook.events).toEqual(['compaction/start'])
    saveCursor(ws.stateRoot, markProposed(emptyCursor(), [], 'r1'))
    expect(checkDue(config).due).toBe(false) // schedule 未启用
    // hook 模式下 tick 用 origin=hook，闸门只看 cooldown/minNewDiaries
    const outcome = await tick({ config, client: client(), logger: silentLogger(), origin: 'hook' })
    expect(outcome.ran).toBe(true)
  })

  it('rejects unknown hook events and empty hook lists in hook mode', async () => {
    const { validateConfig } = await import('../src/config.js')
    const ws = workspace()
    const bad = configure(ws, { modes: ['hook'], cooldownMs: 0, minNewDiaries: 1, applyMode: 'propose', schedule: { intervalMinutes: 1, skipIfOverdueMinutes: 0 }, hook: { events: ['session/end'], cooldownMs: 0 } })
    expect(validateConfig(bad).join(' ')).toContain('trigger.hook.events')
    const empty = configure(ws, { modes: ['hook'], cooldownMs: 0, minNewDiaries: 1, applyMode: 'propose', schedule: { intervalMinutes: 1, skipIfOverdueMinutes: 0 }, hook: { events: [], cooldownMs: 0 } })
    expect(validateConfig(empty).join(' ')).toContain('不能为空')
  })
})
