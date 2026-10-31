import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import { loadConfig } from '../src/config.js'
import { listEventIds, readDiary, resolveDiaryDirs } from '../src/diaries.js'
import { emptyCursor, loadCursor, markDigested, saveCursor } from '../src/cursor.js'
import {
  applyPending,
  applySelected,
  clearPending,
  gatherDiaries,
  listHistory,
  loadPending,
  propose,
  readSchema,
  renderReport,
  snapshotSchema,
} from '../src/reconcile.js'
import { parseSchemaDoc } from '../src/agents-md.js'
import { silentLogger } from '../src/util.js'
import type { ChatClient } from '../src/types.js'

const AGENTS = `# 风格

> **说明：** 风格指怎么做事，强调外在行为的可观察性。

- 说话简洁，先给结论

# 信念

> **说明：** 信念指信什么，是内在的价值原则。

- 不知道就说不知道

# 价值观

> **说明：** 价值观指发生冲突时的排序。

- 安全 > 进度
- 事实 > 面子
`

function makeWorkspace(diaryCount = 2): {
  root: string
  agentsFile: string
  memoryRoot: string
  stateRoot: string
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autoschema-run-'))
  const agentsFile = path.join(root, 'AGENTS.md')
  fs.writeFileSync(agentsFile, AGENTS)
  const memoryRoot = path.join(root, 'mem')
  const dir = path.join(memoryRoot, 'events')
  fs.mkdirSync(dir, { recursive: true })
  for (let i = 0; i < diaryCount; i += 1) {
    const id = `ev_2026103${i}T1000${String(i).padStart(2, '0')}_${String(i).padStart(8, 'a')}`
    fs.writeFileSync(
      path.join(dir, `${id}.json`),
      JSON.stringify({
        id,
        structured: { title: `事件${i}`, startedAt: `2026-10-3${i}T10:00:00+08:00`, tags: [], people: [], outcome: { status: 'completed' } },
      }),
    )
    fs.writeFileSync(path.join(dir, `${id}.md`), `第 ${i} 篇日记正文。\n`)
  }
  return { root, agentsFile, memoryRoot, stateRoot: path.join(root, 'state') }
}

const PAYLOAD = JSON.stringify({
  equilibriumScore: 0.55,
  summary: '我在"先给结论"上不稳定',
  observations: [
    {
      area: 'style',
      observed: '第二篇日记里我先铺了三段背景',
      against: '说话简洁，先给结论',
      conflict: '顺序与图式相反',
      severity: 'medium',
      evidence: [{ eventId: 'ev_1', title: '事件1', quote: '铺了三段背景' }],
    },
  ],
  suggestions: [
    { id: 's1', area: 'style', op: 'modify', target: '说话简洁，先给结论', value: '开口先给结论；需要背景时放结论之后', piaget: 'assimilation', reason: 'r', evidence: [], confidence: 0.8, severity: 'medium' },
    { id: 's2', area: 'value', op: 'reorder', order: ['事实 > 面子', '安全 > 进度'], piaget: 'accommodation', reason: 'r', evidence: [], confidence: 0.7, severity: 'medium' },
    { id: 's3', area: 'belief', op: 'add', value: '结论必须可被数据推翻', piaget: 'accommodation', reason: 'r', evidence: [], confidence: 0.6, severity: 'low' },
  ],
  notes: '样本少',
})

const fakeClient = (payload = PAYLOAD): ChatClient => ({ chat: async () => payload })

function configure(ws: ReturnType<typeof makeWorkspace>, patch: Record<string, unknown> = {}) {
  return loadConfig({
    patch: {
      agentsFile: ws.agentsFile,
      memoryRoot: ws.memoryRoot,
      stateRoot: ws.stateRoot,
      ...patch,
    } as never,
  })
}

describe('propose 只产出建议，绝不改 AGENTS.md', () => {
  it('returns suggestions and leaves the file byte-identical', async () => {
    const ws = makeWorkspace()
    const config = configure(ws)
    const before = fs.readFileSync(ws.agentsFile, 'utf8')

    const result = await propose({ config, client: fakeClient(), logger: silentLogger() })

    expect(result.analysis.suggestions.map((s) => s.op)).toEqual(['modify', 'reorder', 'add'])
    expect(result.pendingSaved).toBe(true)
    expect(fs.readFileSync(ws.agentsFile, 'utf8')).toBe(before)
    expect(listHistory(config)).toHaveLength(0) // 没有写，就没有快照
    expect(loadPending(config)?.analysis.suggestions).toHaveLength(3)
  })

  it('report labels each op and never claims it wrote anything', async () => {
    const ws = makeWorkspace()
    const config = configure(ws)
    const result = await propose({ config, client: fakeClient(), logger: silentLogger() })
    const report = renderReport(result)
    expect(report).toContain('改')
    expect(report).toContain('重排')
    expect(report).toContain('增')
    expect(report).toContain('是否采纳由你决定')
    expect(report).not.toContain('已写回 AGENTS')
  })

  it('records the run in the cursor as proposed (not digested)', async () => {
    const ws = makeWorkspace()
    const config = configure(ws)
    await propose({ config, client: fakeClient(), logger: silentLogger(), runId: 'run-1' })
    const cursor = loadCursor(ws.stateRoot)
    expect(Object.keys(cursor.proposed)).toHaveLength(2)
    expect(Object.keys(cursor.digested)).toHaveLength(0)
  })
})

describe('apply 只采纳被点名的建议', () => {
  it('applies only the chosen ids', async () => {
    const ws = makeWorkspace()
    const config = configure(ws)
    const result = await propose({ config, client: fakeClient(), logger: silentLogger() })
    const applied = applySelected(config, result.analysis.suggestions, { ids: ['s1'] })

    expect(applied.changed).toBe(true)
    expect(applied.applied.modify).toBe(1)
    expect(applied.applied.reorder).toBe(0)
    expect(applied.applied.add).toBe(0)

    const written = fs.readFileSync(ws.agentsFile, 'utf8')
    expect(written).toContain('开口先给结论；需要背景时放结论之后')
    expect(written).not.toContain('结论必须可被数据推翻')
    // 价值观顺序未动
    expect(parseSchemaDoc(written).value).toEqual(['安全 > 进度', '事实 > 面子'])
    expect(applied.snapshot).toBeDefined()
    expect(listHistory(config)).toHaveLength(1)
  })

  it('applies everything from pending and marks diaries digested', async () => {
    const ws = makeWorkspace()
    const config = configure(ws)
    await propose({ config, client: fakeClient(), logger: silentLogger(), runId: 'run-1' })
    const { result } = applyPending(config)

    expect(result.applied).toEqual({ add: 1, remove: 0, modify: 1, reorder: 1 })
    const written = parseSchemaDoc(fs.readFileSync(ws.agentsFile, 'utf8'))
    expect(written.value).toEqual(['事实 > 面子', '安全 > 进度']) // reorder 生效
    expect(written.belief).toContain('结论必须可被数据推翻')

    const cursor = loadCursor(ws.stateRoot)
    expect(Object.keys(cursor.digested)).toHaveLength(2)
    expect(Object.keys(cursor.proposed)).toHaveLength(0)
    expect(loadPending(config)).toBeUndefined()
  })

  it('does nothing when there is no pending proposal', () => {
    const ws = makeWorkspace()
    const config = configure(ws)
    expect(() => applyPending(config)).toThrow(/没有待审建议/u)
  })

  it('clearPending drops the proposal without touching the file', async () => {
    const ws = makeWorkspace()
    const config = configure(ws)
    const before = fs.readFileSync(ws.agentsFile, 'utf8')
    await propose({ config, client: fakeClient(), logger: silentLogger() })
    clearPending(config)
    expect(loadPending(config)).toBeUndefined()
    expect(fs.readFileSync(ws.agentsFile, 'utf8')).toBe(before)
  })
})

describe('日记位置可配置', () => {
  it('falls back to <memoryRoot>/events when diaries.dirs is empty', () => {
    const ws = makeWorkspace()
    const config = configure(ws)
    expect(resolveDiaryDirs(config)).toEqual([path.join(ws.memoryRoot, 'events')])
    expect(listEventIds(resolveDiaryDirs(config))).toHaveLength(2)
  })

  it('reads from explicitly configured directories (multiple, merged)', () => {
    const ws = makeWorkspace()
    const second = fs.mkdtempSync(path.join(os.tmpdir(), 'autoschema-alt-'))
    const id = 'ev_20261101T090000_zzzzzzzz'
    fs.writeFileSync(
      path.join(second, `${id}.json`),
      JSON.stringify({ id, structured: { title: '别处的日记', startedAt: '2026-11-01T09:00:00+08:00', tags: [], people: [], outcome: { status: 'completed' } } }),
    )
    fs.writeFileSync(path.join(second, `${id}.md`), '另一处目录里的日记。\n')

    const config = configure(ws, { diaries: { dirs: [path.join(ws.memoryRoot, 'events'), second], strict: true } })
    expect(resolveDiaryDirs(config)).toHaveLength(2)
    const diaries = gatherDiaries(config, 10)
    expect(diaries.map((entry) => entry.title)).toContain('别处的日记')
    expect(readDiary(resolveDiaryDirs(config), id)?.diary).toContain('另一处目录')
  })

  it('expands ~ and dedupes configured directories', () => {
    const config = loadConfig({
      patch: { diaries: { dirs: ['~/events-a', '~/events-a', '/abs/events-b'] } } as never,
    })
    expect(config.diaries.dirs).toEqual([path.join(os.homedir(), 'events-a'), '/abs/events-b'])
  })

  it('strict mode refuses to fall back', () => {
    const ws = makeWorkspace()
    const config = configure(ws, { diaries: { dirs: [], strict: true } })
    expect(resolveDiaryDirs(config)).toEqual([])
  })
})

describe('游标与守卫', () => {
  it('skips already-digested diaries and reports why', async () => {
    const ws = makeWorkspace()
    const config = configure(ws)
    const ids = listEventIds(path.join(ws.memoryRoot, 'events'))
    saveCursor(ws.stateRoot, markDigested(emptyCursor(), ids, 'run-0'))
    await expect(propose({ config, client: fakeClient(), logger: silentLogger() })).rejects.toThrow(/没有"未消化"/u)
  })

  it('fails clearly when there are no diaries at all', async () => {
    const ws = makeWorkspace(0)
    const config = configure(ws)
    await expect(propose({ config, client: fakeClient(), logger: silentLogger() })).rejects.toThrow(/没有可用日记/u)
  })

  it('snapshots are unique and listed', () => {
    const ws = makeWorkspace()
    const config = configure(ws)
    const a = snapshotSchema(config, 'v1')
    const b = snapshotSchema(config, 'v2')
    expect(a).not.toBe(b)
    expect(listHistory(config)).toHaveLength(2)
  })

  it('readSchema parses the live file', () => {
    const ws = makeWorkspace()
    const config = configure(ws)
    expect(readSchema(config).value).toEqual(['安全 > 进度', '事实 > 面子'])
  })
})
