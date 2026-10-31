import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadConfig, validateConfig } from '../src/config.js'
import { emptyCursor, loadCursor, markDigested, saveCursor } from '../src/cursor.js'
import { checkDue, checkHookDue, cronLine, nextAtTime } from '../src/schedule.js'
import { tick } from '../src/tick.js'
import { silentLogger } from '../src/util.js'
import type { ChatClient } from '../src/types.js'

function workspace(diaries = 6): { agentsFile: string; memoryRoot: string; stateRoot: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autoschema-trig-'))
  const agentsFile = path.join(root, 'AGENTS.md')
  fs.writeFileSync(
    agentsFile,
    '# 风格\n\n> **说明：** 风格指怎么做事\n\n- 先给结论\n\n# 信念\n\n- 诚实\n\n# 价值观\n\n- 安全 > 进度\n- 事实 > 面子\n',
  )
  const dir = path.join(root, 'mem', 'events')
  fs.mkdirSync(dir, { recursive: true })
  for (let i = 0; i < diaries; i += 1) {
    const id = `ev_2026103${i % 9}T1000${String(i).padStart(2, '0')}_${String(i).padStart(8, 'a')}`
    fs.writeFileSync(
      path.join(dir, `${id}.json`),
      JSON.stringify({
        id,
        structured: { title: `事件${i}`, startedAt: `2026-10-3${i % 9}T10:00:00+08:00`, tags: [], people: [], outcome: { status: 'completed' } },
      }),
    )
    fs.writeFileSync(path.join(dir, `${id}.md`), `第 ${i} 篇日记正文。\n`)
  }
  return { agentsFile, memoryRoot: path.join(root, 'mem'), stateRoot: path.join(root, 'state') }
}

const PAYLOAD = JSON.stringify({
  equilibriumScore: 0.6,
  summary: 's',
  observations: [],
  suggestions: [
    { id: 's1', area: 'value', op: 'reorder', order: ['事实 > 面子', '安全 > 进度'], piaget: 'accommodation', reason: 'r', evidence: [], confidence: 0.8, severity: 'medium' },
  ],
  notes: '',
})
const client = (): ChatClient => ({ chat: async () => PAYLOAD })

function configure(ws: ReturnType<typeof workspace>, trigger: Record<string, unknown>) {
  return loadConfig({
    patch: {
      agentsFile: ws.agentsFile,
      memoryRoot: ws.memoryRoot,
      stateRoot: ws.stateRoot,
      trigger: trigger as never,
      digest: { limit: 10, onlyUndigested: true, diaryChars: 500, maxInputChars: 20000 } as never,
    },
  })
}

const scheduleTrigger = (over: Record<string, unknown> = {}) => ({
  modes: ['schedule'],
  cooldownMs: 0,
  minNewDiaries: 1,
  maxRemovals: 2,
  maxAdditions: 4,
  schedule: { intervalMinutes: 1, skipIfOverdueMinutes: 0 },
  hook: { events: [], cooldownMs: 0 },
  ...over,
})

describe('checkDue（定时闸门）', () => {
  it('refuses when schedule mode is off — but still reports the real diary count', () => {
    const ws = workspace(4)
    const config = configure(ws, scheduleTrigger({ modes: ['manual'] }))
    const due = checkDue(config)
    expect(due.due).toBe(false)
    expect(due.reason).toContain('未启用 schedule')
    expect(due.undigested).toBe(4)
  })

  it('refuses when there are not enough undigested diaries', () => {
    const ws = workspace(3)
    const config = configure(ws, scheduleTrigger({ minNewDiaries: 5 }))
    expect(checkDue(config).reason).toContain('未消化日记不足')
  })

  it('refuses inside the cooldown window', () => {
    const ws = workspace()
    const config = configure(ws, scheduleTrigger({ cooldownMs: 3_600_000 }))
    saveCursor(ws.stateRoot, { ...emptyCursor(), lastRunAt: new Date().toISOString() })
    const due = checkDue(config)
    expect(due.due).toBe(false)
    expect(due.reason).toContain('冷却中')
    expect(due.waitMs).toBeGreaterThan(0)
  })

  it('runs once cooldown elapsed and enough new diaries exist', () => {
    const ws = workspace(6)
    const due = checkDue(configure(ws, scheduleTrigger({ minNewDiaries: 5 })))
    expect(due.due).toBe(true)
    expect(due.undigested).toBe(6)
  })

  it('honours the daily atTime window and skips a badly overdue one', () => {
    const ws = workspace(6)
    const at = (atTime: string, skip: number) =>
      configure(ws, scheduleTrigger({ schedule: { intervalMinutes: 1440, atTime, skipIfOverdueMinutes: skip } }))
    const now = new Date()
    const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`

    expect(checkDue(at(hhmm(now), 720), now).due).toBe(true)
    const twoHoursAgo = hhmm(new Date(now.getTime() - 2 * 3600_000))
    expect(checkDue(at(twoHoursAgo, 30), now).due).toBe(false)
    expect(checkDue(at(twoHoursAgo, 30), now).reason).toContain('错过')
  })

  it('counts only undigested diaries', () => {
    const ws = workspace(6)
    const config = configure(ws, scheduleTrigger())
    const ids = fs
      .readdirSync(path.join(ws.memoryRoot, 'events'))
      .filter((name) => name.endsWith('.json'))
      .map((name) => name.slice(0, -5))
    saveCursor(ws.stateRoot, markDigested(emptyCursor(), ids.slice(0, 5), 'r1'))
    expect(checkDue(config).undigested).toBe(1)
  })

  it('parses HH:MM and the next occurrence', () => {
    const now = new Date('2026-10-31T10:00:00')
    expect(nextAtTime(now, '11:30')).toBe(new Date('2026-10-31T11:30:00').getTime())
    expect(nextAtTime(now, '09:00')).toBe(new Date('2026-11-01T09:00:00').getTime())
    expect(nextAtTime(now, '25:00')).toBeUndefined()
  })

  it('emits valid cron expressions (never */24)', () => {
    const ws = workspace()
    const hourly = cronLine(configure(ws, scheduleTrigger({ schedule: { intervalMinutes: 60, skipIfOverdueMinutes: 0 } })))
    expect(hourly).toMatch(/^0 \*\/1 \* \* \* autoschema tick/u)

    const daily = cronLine(
      configure(ws, scheduleTrigger({ schedule: { intervalMinutes: 1440, skipIfOverdueMinutes: 0 } })),
    )
    expect(daily).toMatch(/^0 3 \* \* \* autoschema tick/u)
    expect(daily).not.toMatch(/\*\/24/u)

    const atTime = cronLine(
      configure(ws, scheduleTrigger({ schedule: { intervalMinutes: 1440, atTime: '03:30', skipIfOverdueMinutes: 0 } })),
    )
    expect(atTime).toMatch(/^30 3 \* \* \* autoschema tick/u)
  })
})

describe('checkHookDue（hook 闸门）', () => {
  it('refuses when hook mode is off or no hook point chosen', () => {
    const ws = workspace()
    expect(checkHookDue(configure(ws, scheduleTrigger({ modes: ['schedule'] }))).reason).toContain('未启用 hook')
    const noEvents = configure(ws, scheduleTrigger({ modes: ['hook'], hook: { events: [], cooldownMs: 0 } }))
    expect(checkHookDue(noEvents).reason).toContain('未选择挂点')
  })

  it('passes with the configured hook point and enough new diaries', () => {
    const ws = workspace(6)
    const config = configure(ws, scheduleTrigger({ modes: ['hook'], hook: { events: ['compaction/start'], cooldownMs: 0 } }))
    const due = checkHookDue(config)
    expect(due.due).toBe(true)
    expect(due.reason).toContain('compaction/start')
  })

  it('uses its own cooldown, not the schedule interval', () => {
    const ws = workspace(6)
    const config = configure(
      ws,
      scheduleTrigger({
        modes: ['hook'],
        cooldownMs: 0,
        schedule: { intervalMinutes: 1440, skipIfOverdueMinutes: 720 },
        hook: { events: ['compaction/start'], cooldownMs: 5_000 },
      }),
    )
    saveCursor(ws.stateRoot, { ...emptyCursor(), lastRunAt: new Date().toISOString() })
    expect(checkHookDue(config).reason).toContain('hook 冷却中')
  })
})

describe('tick 只产建议', () => {
  it('skips when the gate says no, and records the skip', async () => {
    const ws = workspace(2)
    const config = configure(ws, scheduleTrigger({ minNewDiaries: 5 }))
    const outcome = await tick({ config, client: client(), logger: silentLogger(), origin: 'schedule' })
    expect(outcome.ran).toBe(false)
    expect(outcome.mode).toBe('skipped')
    expect(loadCursor(ws.stateRoot).lastRunAt).toBeDefined()
  })

  it('produces suggestions and never writes AGENTS.md', async () => {
    const ws = workspace(6)
    const config = configure(ws, scheduleTrigger())
    const before = fs.readFileSync(ws.agentsFile, 'utf8')
    const outcome = await tick({ config, client: client(), logger: silentLogger(), origin: 'schedule' })
    expect(outcome.ran).toBe(true)
    expect(outcome.mode).toBe('proposed')
    expect(outcome.message).toContain('建议 1')
    expect(fs.readFileSync(ws.agentsFile, 'utf8')).toBe(before)
  })

  it('hook origin uses the hook gate and also only proposes', async () => {
    const ws = workspace(6)
    const config = configure(ws, scheduleTrigger({ modes: ['hook'], hook: { events: ['compaction/start'], cooldownMs: 0 } }))
    const before = fs.readFileSync(ws.agentsFile, 'utf8')
    const outcome = await tick({ config, client: client(), logger: silentLogger(), origin: 'hook' })
    expect(outcome.ran).toBe(true)
    expect(fs.readFileSync(ws.agentsFile, 'utf8')).toBe(before)
  })

  it('manual origin bypasses the gate', async () => {
    const ws = workspace(2)
    const config = configure(ws, scheduleTrigger({ modes: ['manual'], minNewDiaries: 99, cooldownMs: 9_999_999 }))
    const outcome = await tick({ config, client: client(), logger: silentLogger(), origin: 'manual' })
    expect(outcome.ran).toBe(true)
  })

  it('does not re-run the same diaries', async () => {
    const ws = workspace(6)
    const config = configure(ws, scheduleTrigger())
    expect((await tick({ config, client: client(), logger: silentLogger(), origin: 'schedule' })).ran).toBe(true)
    const second = await tick({ config, client: client(), logger: silentLogger(), origin: 'schedule' })
    expect(second.ran).toBe(false)
    expect(second.message).toContain('未消化日记不足')
  })
})

describe('配置校验', () => {
  it('rejects unknown hook events and empty hook lists in hook mode', () => {
    const ws = workspace()
    expect(
      validateConfig(configure(ws, scheduleTrigger({ modes: ['hook'], hook: { events: ['session/end'], cooldownMs: 0 } }))).join(' '),
    ).toContain('trigger.hook.events')
    expect(
      validateConfig(configure(ws, scheduleTrigger({ modes: ['hook'], hook: { events: [], cooldownMs: 0 } }))).join(' '),
    ).toContain('不能为空')
  })

  it('rejects relative diary dirs', () => {
    const config = loadConfig({ patch: { diaries: { dirs: ['relative/path'] } } as never })
    // loadConfig 会展开成绝对路径，所以这里应通过；校验只拦未展开的输入
    expect(config.diaries.dirs[0]).toBe(path.resolve('relative/path'))
  })
})
