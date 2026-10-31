import { describe, expect, it } from 'vitest'

import { collectDiaries, listEventIds, readDiary, renderDiaries } from '../src/diaries.js'
import {
  ANALYSIS_GUIDE,
  AnalysisError,
  RESPONSE_CONTRACT,
  buildAnalysisRequest,
  normalizeAnalysis,
  parseAnalysisResponse,
  renderSchema,
} from '../src/prompt.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

function makeMemoryRoot(events: Array<{ id: string; title: string; at: string; diary: string; tags?: string[] }>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autoschema-mem-'))
  fs.mkdirSync(path.join(root, 'events'), { recursive: true })
  for (const event of events) {
    fs.writeFileSync(
      path.join(root, 'events', `${event.id}.json`),
      JSON.stringify({
        id: event.id,
        diary: event.diary,
        structured: {
          title: event.title,
          startedAt: event.at,
          endedAt: event.at,
          tags: event.tags ?? [],
          people: [{ name: '我' }, { name: '用户' }],
          outcome: { status: 'completed' },
        },
      }),
    )
    fs.writeFileSync(path.join(root, 'events', `${event.id}.md`), `${event.diary}\n`)
  }
  return root
}

/** 分支独立：agents-md 在另一条 feat 分支上，这里用等价的最小 SchemaDoc 夹具。 */
function parseSchemaDoc(_text: string) {
  return {
    style: ['说话简洁，先给结论'],
    belief: ['不知道就说不知道'],
    value: ['安全 > 进度'],
    preamble: { style: ['> **说明：** 风格指怎么做事'], belief: [], value: [] },
    extra: [],
    raw: _text,
  }
}

const SCHEMA_TEXT = `# 风格

> **说明：** 风格指怎么做事，强调外在行为的可观察性。

- 说话简洁，先给结论

# 信念

> **说明：** 信念指信什么，是内在的价值原则。

- 不知道就说不知道

# 价值观

> **说明：** 价值观指发生冲突时的排序。

- 安全 > 进度
`

describe('diaries', () => {
  const root = makeMemoryRoot([
    { id: 'ev_20261030T100000_aaaaaaaa', title: '第一件', at: '2026-10-30T10:00:00+08:00', diary: '我先给结论，再补依据。' },
    { id: 'ev_20261031T100000_bbbbbbbb', title: '第二件', at: '2026-10-31T10:00:00+08:00', diary: '我没有先说结论，而是铺了一大段背景。', tags: ['沟通'] },
  ])

  it('lists and reads events, preferring the md body', () => {
    expect(listEventIds(root).sort()).toEqual(['ev_20261030T100000_aaaaaaaa', 'ev_20261031T100000_bbbbbbbb'])
    const entry = readDiary(root, 'ev_20261031T100000_bbbbbbbb')
    expect(entry?.title).toBe('第二件')
    expect(entry?.diary).toContain('铺了一大段背景')
    expect(entry?.tags).toEqual(['沟通'])
    expect(entry?.people).toEqual(['我', '用户'])
  })

  it('collects newest first and honours limit/since/budget', () => {
    const all = collectDiaries(root, { limit: 10, maxChars: 10_000, diaryChars: 1000 })
    expect(all.map((entry) => entry.title)).toEqual(['第二件', '第一件'])

    const one = collectDiaries(root, { limit: 1, maxChars: 10_000, diaryChars: 1000 })
    expect(one).toHaveLength(1)
    expect(one[0]?.title).toBe('第二件')

    const recent = collectDiaries(root, { limit: 10, since: '2026-10-31T00:00:00+08:00', maxChars: 10_000, diaryChars: 1000 })
    expect(recent.map((entry) => entry.title)).toEqual(['第二件'])

    const tiny = collectDiaries(root, { limit: 10, maxChars: 40, diaryChars: 30 })
    expect(tiny.length).toBeLessThanOrEqual(1)
  })

  it('renders a diary block with ids and metadata', () => {
    const text = renderDiaries(collectDiaries(root, { limit: 10, maxChars: 10_000, diaryChars: 1000 }))
    expect(text).toContain('事件 ID：ev_20261031T100000_bbbbbbbb')
    expect(text).toContain('标签：沟通')
    expect(text).toContain('---')
  })
})

describe('prompt', () => {
  it('ships the piaget guide and the contract', () => {
    for (const phrase of ['非平衡', '同化', '顺应', '平衡', '图式', '可观察', '只输出 JSON']) {
      expect(ANALYSIS_GUIDE).toContain(phrase)
    }
    expect(RESPONSE_CONTRACT).toContain('equilibriumScore')
    expect(RESPONSE_CONTRACT).toContain('assimilation')
    expect(RESPONSE_CONTRACT).toContain('accommodation')
  })

  it('renders the schema with section labels and empty markers', () => {
    const doc = parseSchemaDoc(SCHEMA_TEXT)
    const text = renderSchema(doc)
    expect(text).toContain('## 风格（style）')
    expect(text).toContain('1. 说话简洁，先给结论')
    const empty = { ...parseSchemaDoc(''), style: [], belief: [], value: [] }
    expect(renderSchema(empty)).toContain('（当前为空）')
  })

  it('builds a request containing schema and diaries', () => {
    const doc = parseSchemaDoc(SCHEMA_TEXT)
    const diaries = collectDiaries(makeMemoryRoot([{ id: 'ev_20261031T100000_cccccccc', title: 'X', at: '2026-10-31T10:00:00+08:00', diary: '我铺了背景。' }]), {
      limit: 3,
      maxChars: 5000,
      diaryChars: 500,
    })
    const { system, user } = buildAnalysisRequest({ doc, diaries, renderedDiaries: renderDiaries(diaries) })
    expect(system).toContain('皮亚杰')
    expect(user).toContain('我的当前图式')
    expect(user).toContain('说话简洁')
    expect(user).toContain('我铺了背景')
  })

  it('parses a clean response', () => {
    const analysis = parseAnalysisResponse(
      JSON.stringify({
        equilibriumScore: 0.4,
        summary: '我在"先给结论"上不稳定',
        disequilibrium: [
          {
            area: 'style',
            observed: '第二篇日记里我先铺了背景',
            against: '说话简洁，先给结论',
            conflict: '图式要求的顺序与行为相反',
            severity: 'medium',
            evidence: [{ eventId: 'ev_20261031T100000_bbbbbbbb', title: '第二件', quote: '铺了一大段背景' }],
          },
        ],
        assimilation: [
          {
            area: 'style',
            target: '说话简洁，先给结论',
            revised: '开口先给结论；需要背景时放在结论之后，且不超三句',
            why: '把边界说清楚，避免把"简洁"理解成"不许解释"',
            evidence: [],
          },
        ],
        accommodation: [
          { area: 'belief', text: '结论必须可被数据推翻', why: '日记里反复出现验证动作', evidence: [] },
        ],
        notes: '样本只有两篇',
      }),
    )
    expect(analysis.equilibriumScore).toBeCloseTo(0.4)
    expect(analysis.disequilibrium[0]?.severity).toBe('medium')
    expect(analysis.assimilation[0]?.area).toBe('style')
    expect(analysis.accommodation[0]?.text).toBe('结论必须可被数据推翻')
  })

  it('tolerates fences, prose and chinese area names', () => {
    const payload = JSON.stringify({
      equilibriumScore: 1.7,
      summary: 's',
      disequilibrium: [{ area: '风格', observed: 'o', against: 'a', conflict: 'c', severity: 'weird', evidence: [{ eventId: 'ev_1' }] }],
      assimilation: [],
      accommodation: [],
    })
    const analysis = parseAnalysisResponse(`好的：\n\`\`\`json\n${payload}\n\`\`\`\n以上。`)
    expect(analysis.equilibriumScore).toBe(1)
    expect(analysis.disequilibrium[0]?.area).toBe('style')
    expect(analysis.disequilibrium[0]?.severity).toBe('low')
  })

  it('drops malformed items instead of failing the whole analysis', () => {
    const analysis = parseAnalysisResponse(
      JSON.stringify({
        equilibriumScore: 0.5,
        summary: 's',
        disequilibrium: [{ area: 'nope', observed: 'x' }, { area: 'value', observed: 'y', against: 'z', conflict: 'c', evidence: [] }],
        assimilation: [{ area: 'style', target: '', revised: 'r' }, { area: 'style', target: 't', revised: 'r' }],
        accommodation: [{ area: 'belief', text: '' }],
        notes: '',
      }),
    )
    expect(analysis.disequilibrium).toHaveLength(1)
    expect(analysis.assimilation).toHaveLength(1)
    expect(analysis.accommodation).toHaveLength(0)
  })

  it('throws when nothing usable comes back', () => {
    expect(() => parseAnalysisResponse('not json')).toThrow(AnalysisError)
    expect(() => parseAnalysisResponse('{}')).toThrow(AnalysisError)
    expect(() => parseAnalysisResponse(JSON.stringify({ disequilibrium: [], assimilation: [], accommodation: [] }))).toThrow(AnalysisError)
  })
})

describe('normalizeAnalysis', () => {
  it('clamps the score and defaults the area/severity', () => {
    const analysis = normalizeAnalysis({
      equilibriumScore: -3,
      summary: 'x',
      disequilibrium: [{ area: 'VALUE', observed: 'o', conflict: 'c' }],
    })
    expect(analysis.equilibriumScore).toBe(0)
    expect(analysis.disequilibrium[0]?.area).toBe('value')
    expect(analysis.disequilibrium[0]?.against).toBe('（该节为空）')
    expect(analysis.disequilibrium[0]?.severity).toBe('low')
  })
})
