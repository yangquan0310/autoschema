import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { defaultConfig, loadConfig } from '../src/config.js'
import { gatherDiaries, listHistory, readSchema, renderReport, run, snapshotSchema } from '../src/reconcile.js'
import { readDiary } from '../src/diaries.js'
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
`

function makeWorkspace(): { agentsFile: string; memoryRoot: string; stateRoot: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autoschema-run-'))
  const agentsFile = path.join(root, 'AGENTS.md')
  fs.writeFileSync(agentsFile, AGENTS)
  const memoryRoot = path.join(root, 'mem')
  fs.mkdirSync(path.join(memoryRoot, 'events'), { recursive: true })
  const events = [
    { id: 'ev_20261030T100000_aaaaaaaa', title: '汇报进展', at: '2026-10-30T10:00:00+08:00', diary: '我先给了结论，再补两句依据。' },
    { id: 'ev_20261031T100000_bbbbbbbb', title: '解释概念', at: '2026-10-31T10:00:00+08:00', diary: '这次我铺了三段背景才给结论。' },
  ]
  for (const event of events) {
    fs.writeFileSync(
      path.join(memoryRoot, 'events', `${event.id}.json`),
      JSON.stringify({
        id: event.id,
        structured: { title: event.title, startedAt: event.at, endedAt: event.at, tags: [], people: [{ name: '我' }], outcome: { status: 'completed' } },
      }),
    )
    fs.writeFileSync(path.join(memoryRoot, 'events', `${event.id}.md`), `${event.diary}\n`)
  }
  return { agentsFile, memoryRoot, stateRoot: path.join(root, 'state') }
}

const ANALYSIS_JSON = JSON.stringify({
  equilibriumScore: 0.55,
  summary: '我在"先给结论"上不稳定',
  disequilibrium: [
    {
      area: 'style',
      observed: '第二篇日记里我先铺了三段背景',
      against: '说话简洁，先给结论',
      conflict: '图式要求开口即结论，实际行为相反',
      severity: 'medium',
      evidence: [{ eventId: 'ev_20261031T100000_bbbbbbbb', title: '解释概念', quote: '铺了三段背景才给结论' }],
    },
  ],
  assimilation: [
    {
      area: 'style',
      target: '说话简洁，先给结论',
      revised: '开口先给结论；需要铺垫时放在结论之后，且不超三句',
      why: '把"简洁"的边界写清楚',
      evidence: [],
    },
  ],
  accommodation: [
    { area: 'belief', text: '结论必须能被数据推翻', why: '日记里反复出现验证动作', evidence: [] },
  ],
  notes: '样本只有两篇',
})

const fakeClient = (payload = ANALYSIS_JSON): ChatClient => ({
  chat: async () => payload,
})

describe('run (dry-run)', () => {
  it('analyses without touching AGENTS.md', async () => {
    const ws = makeWorkspace()
    const config = loadConfig({
      patch: { agentsFile: ws.agentsFile, memoryRoot: ws.memoryRoot, stateRoot: ws.stateRoot, diaryLimit: 10 },
    })
    const beforeText = fs.readFileSync(ws.agentsFile, 'utf8')
    const result = await run({ config, client: fakeClient(), logger: silentLogger(), dryRun: true })

    expect(result.analysis.equilibriumScore).toBeCloseTo(0.55)
    expect(result.analysis.disequilibrium).toHaveLength(1)
    expect(result.applied).toEqual({ assimilation: 1, accommodation: 1 })
    expect(result.after.style[0]).toContain('且不超三句')
    expect(result.after.belief).toContain('结论必须能被数据推翻')
    expect(result.wrote).toBe(false)
    // 文件未变
    expect(fs.readFileSync(ws.agentsFile, 'utf8')).toBe(beforeText)
    expect(listHistory(config)).toHaveLength(0)
  })
})

describe('run (apply)', () => {
  it('writes the merged schema and snapshots the previous version', async () => {
    const ws = makeWorkspace()
    const config = loadConfig({
      patch: { agentsFile: ws.agentsFile, memoryRoot: ws.memoryRoot, stateRoot: ws.stateRoot },
    })
    const result = await run({ config, client: fakeClient(), logger: silentLogger(), dryRun: false })

    expect(result.wrote).toBe(true)
    expect(result.snapshot).toBeDefined()
    const written = fs.readFileSync(ws.agentsFile, 'utf8')
    expect(written).toContain('且不超三句')
    expect(written).toContain('结论必须能被数据推翻')
    expect(written).toContain('> **说明：** 风格指怎么做事') // 框架保留

    // 快照与历史
    const history = listHistory(config)
    expect(history).toHaveLength(1)
    const snapshotText = fs.readFileSync(history[0]!.file, 'utf8')
    expect(snapshotText).toBe(AGENTS)
    // 解析结果与写入一致
    expect(parseSchemaDoc(written).belief).toContain('结论必须能被数据推翻')
  })

  it('does not write when nothing is applied', async () => {
    const ws = makeWorkspace()
    const config = loadConfig({ patch: { agentsFile: ws.agentsFile, memoryRoot: ws.memoryRoot, stateRoot: ws.stateRoot } })
    const empty = JSON.stringify({ equilibriumScore: 0.9, summary: '基本自洽', disequilibrium: [], assimilation: [], accommodation: [], notes: '' })
    const result = await run({ config, client: fakeClient(empty), logger: silentLogger(), dryRun: false })
    expect(result.wrote).toBe(false)
    expect(fs.readFileSync(ws.agentsFile, 'utf8')).toBe(AGENTS)
  })
})

describe('guards', () => {
  it('fails clearly when there are no diaries', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autoschema-empty-'))
    const agentsFile = path.join(root, 'AGENTS.md')
    fs.writeFileSync(agentsFile, AGENTS)
    const config = loadConfig({ patch: { agentsFile, memoryRoot: path.join(root, 'none'), stateRoot: path.join(root, 's') } })
    await expect(run({ config, client: fakeClient(), logger: silentLogger() })).rejects.toThrow(/没有可用日记/u)
  })

  it('gatherDiaries honours limit and reads md bodies', () => {
    const ws = makeWorkspace()
    const config = loadConfig({ patch: { agentsFile: ws.agentsFile, memoryRoot: ws.memoryRoot, stateRoot: ws.stateRoot } })
    const diaries = gatherDiaries(config, 1)
    expect(diaries).toHaveLength(1)
    expect(diaries[0]?.title).toBe('解释概念')
    expect(readDiary(ws.memoryRoot, diaries[0]!.eventId)?.diary).toContain('铺了三段背景')
  })

  it('report mentions the three stages', async () => {
    const ws = makeWorkspace()
    const config = loadConfig({ patch: { agentsFile: ws.agentsFile, memoryRoot: ws.memoryRoot, stateRoot: ws.stateRoot } })
    const result = await run({ config, client: fakeClient(), logger: silentLogger(), dryRun: true })
    const report = renderReport(result)
    expect(report).toContain('非平衡')
    expect(report).toContain('同化')
    expect(report).toContain('顺应')
    expect(report).toContain('dry-run')
  })

  it('snapshotSchema keeps one file per call', () => {
    const ws = makeWorkspace()
    const config = loadConfig({ patch: { agentsFile: ws.agentsFile, memoryRoot: ws.memoryRoot, stateRoot: ws.stateRoot } })
    const first = snapshotSchema(config, 'v1')
    const second = snapshotSchema(config, 'v2')
    expect(first).not.toBe(second)
    expect(fs.readFileSync(first, 'utf8')).toBe('v1')
    expect(listHistory(config)).toHaveLength(2)
  })

  it('defaultConfig stays inside the state root', () => {
    const base = defaultConfig()
    expect(base.agentsFile).toMatch(/AGENTS\.md$/u)
    expect(base.memoryRoot).toMatch(/\.autobiomemory$/u)
    expect(base.diaryLimit).toBeGreaterThan(0)
  })
})

describe('digest cursor', () => {
  it('feeds only undigested diaries, and a dry-run proposal parks them as pending', async () => {
    const ws = makeWorkspace()
    const config = loadConfig({
      patch: { agentsFile: ws.agentsFile, memoryRoot: ws.memoryRoot, stateRoot: ws.stateRoot, digest: { onlyUndigested: true, limit: 10, diaryChars: 1000, maxInputChars: 20000 } },
    })
    const { loadCursor } = await import('../src/cursor.js')
    const { loadPending, pendingFile } = await import('../src/reconcile.js')

    const first = await run({ config, client: fakeClient(), logger: silentLogger(), dryRun: true, runId: 'run-1' })
    expect(first.digestedIds).toHaveLength(2)
    expect(first.pendingSaved).toBe(true)
    const cursor = loadCursor(ws.stateRoot)
    expect(Object.keys(cursor.proposed)).toHaveLength(2)
    expect(Object.keys(cursor.digested)).toHaveLength(0)
    expect(fs.existsSync(pendingFile(ws.stateRoot))).toBe(true)
    expect(loadPending(config)?.runId).toBe('run-1')

    // 第二次运行：没有新的未消化日记 → 明确报错而不是重复烧 token
    await expect(run({ config, client: fakeClient(), logger: silentLogger() })).rejects.toThrow(/没有"未消化"的日记/u)
  })

  it('marks diaries digested only after a real write, and consumes the pending proposal', async () => {
    const ws = makeWorkspace()
    const config = loadConfig({
      patch: { agentsFile: ws.agentsFile, memoryRoot: ws.memoryRoot, stateRoot: ws.stateRoot },
    })
    const { loadCursor } = await import('../src/cursor.js')
    const { applyProposal, loadPending } = await import('../src/reconcile.js')

    await run({ config, client: fakeClient(), logger: silentLogger(), dryRun: true, runId: 'run-1' })
    const proposal = loadPending(config)
    expect(proposal).toBeDefined()

    const applied = applyProposal(config, proposal!, { runId: 'run-2' })
    expect(applied.applied).toEqual({ assimilation: 1, accommodation: 1 })
    expect(applied.snapshot).toBeDefined()
    expect(fs.readFileSync(ws.agentsFile, 'utf8')).toContain('且不超三句')

    const cursor = loadCursor(ws.stateRoot)
    expect(Object.keys(cursor.digested)).toHaveLength(2)
    expect(Object.keys(cursor.proposed)).toHaveLength(0)
    expect(loadPending(config)).toBeUndefined()

    // 再跑一次：全部已吸收
    await expect(run({ config, client: fakeClient(), logger: silentLogger() })).rejects.toThrow(/没有"未消化"/u)
  })

  it('allows processing everything with onlyUndigested=false', async () => {
    const ws = makeWorkspace()
    const config = loadConfig({
      patch: { agentsFile: ws.agentsFile, memoryRoot: ws.memoryRoot, stateRoot: ws.stateRoot, digest: { onlyUndigested: false, limit: 10, diaryChars: 1000, maxInputChars: 20000 } },
    })
    await run({ config, client: fakeClient(), logger: silentLogger(), dryRun: true, runId: 'run-1' })
    const again = await run({ config, client: fakeClient(), logger: silentLogger(), dryRun: true, runId: 'run-2' })
    expect(again.digestedIds).toHaveLength(2)
    expect(again.skippedDigested).toBe(0)
  })

  it('counts undigested diaries and resets on demand', async () => {
    const ws = makeWorkspace()
    const { emptyCursor, countUndigested, markDigested, isSettled, markProposed, pendingEventIds, clearProposed } = await import('../src/cursor.js')
    let cursor = emptyCursor()
    expect(countUndigested(cursor, ['a', 'b'])).toBe(2)
    cursor = markDigested(cursor, ['a'], 'r1')
    expect(isSettled(cursor, 'a')).toBe(true)
    expect(countUndigested(cursor, ['a', 'b'])).toBe(1)
    cursor = markProposed(cursor, ['b'], 'r1')
    expect(pendingEventIds(cursor)).toEqual(['b'])
    cursor = clearProposed(cursor)
    expect(pendingEventIds(cursor)).toEqual([])
    void ws
  })
})
