import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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

function makeMemoryRoot(
  events: Array<{ id: string; title: string; at: string; diary: string; tags?: string[] }>,
): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'autoschema-mem-'))
  fs.mkdirSync(path.join(root, 'events'), { recursive: true })
  for (const event of events) {
    fs.writeFileSync(
      path.join(root, 'events', `${event.id}.json`),
      JSON.stringify({
        id: event.id,
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

const doc = {
  style: ['说话简洁，先给结论'],
  belief: ['不知道就说不知道'],
  value: ['安全 > 进度', '事实 > 面子'],
  preamble: { style: ['> **说明：** 风格指怎么做事'], belief: [], value: [] },
  extra: [],
  raw: '# 风格\n',
}

const fullPayload = {
  equilibriumScore: 0.42,
  summary: '我在"先给结论"上不稳定',
  observations: [
    {
      area: 'style',
      observed: '第二篇日记里我先铺了三段背景',
      against: '说话简洁，先给结论',
      conflict: '图式要求的顺序与行为相反',
      severity: 'medium',
      evidence: [{ eventId: 'ev_2', title: '第二件', quote: '铺了三段背景' }],
    },
  ],
  suggestions: [
    { id: 's1', area: 'style', op: 'modify', target: '说话简洁，先给结论', value: '开口先给结论；需要背景时放结论之后', piaget: 'assimilation', reason: 'r', evidence: [], confidence: 0.8, severity: 'medium', risk: '汇报可能变长' },
    { id: 's2', area: 'belief', op: 'add', value: '结论必须可被数据推翻', piaget: 'accommodation', reason: 'r', evidence: [], confidence: 0.6, severity: 'low' },
    { id: 's3', area: 'belief', op: 'remove', target: '不知道就说不知道', piaget: 'accommodation', reason: 'r', evidence: [], confidence: 0.4, severity: 'high' },
    { id: 's4', area: 'value', op: 'reorder', order: ['事实 > 面子', '安全 > 进度'], piaget: 'accommodation', reason: 'r', evidence: [], confidence: 0.7, severity: 'medium' },
  ],
  notes: '样本只有两篇',
}

describe('guide & contract', () => {
  it('states the four ops and that the model must not touch files', () => {
    for (const token of ['add', 'remove', 'modify', 'reorder', '价值观的本质是排序', '只产出建议', '不改文件']) {
      expect(ANALYSIS_GUIDE).toContain(token)
    }
    expect(RESPONSE_CONTRACT).toContain('"suggestions"')
    expect(RESPONSE_CONTRACT).toContain('"op": "add | remove | modify | reorder"')
    expect(RESPONSE_CONTRACT).toContain('只输出 JSON')
  })

  it('renders the schema with labels and empty markers', () => {
    expect(renderSchema(doc)).toContain('## 风格（style）')
    expect(renderSchema({ ...doc, style: [] })).toContain('（当前为空）')
  })

  it('builds a request with schema + diaries', () => {
    const root = makeMemoryRoot([{ id: 'ev_1', title: 'X', at: '2026-10-31T10:00:00+08:00', diary: '我铺了背景。' }])
    const diaries = collectDiaries(path.join(root, 'events'), { limit: 3, maxChars: 5000, diaryChars: 500 })
    const { system, user } = buildAnalysisRequest({ doc, diaries, renderedDiaries: renderDiaries(diaries) })
    expect(system).toContain('皮亚杰')
    expect(user).toContain('我的当前图式')
    expect(user).toContain('说话简洁')
    expect(user).toContain('我铺了背景')
  })
})

describe('diaries', () => {
  const root = makeMemoryRoot([
    { id: 'ev_20261030T100000_aaaaaaaa', title: '第一件', at: '2026-10-30T10:00:00+08:00', diary: '我先给结论。' },
    { id: 'ev_20261031T100000_bbbbbbbb', title: '第二件', at: '2026-10-31T10:00:00+08:00', diary: '我先铺背景。', tags: ['沟通'] },
  ])

  it('lists and reads events preferring the md body', () => {
    expect(listEventIds(path.join(root, 'events'))).toHaveLength(2)
    expect(readDiary(path.join(root, 'events'), 'ev_20261031T100000_bbbbbbbb')?.tags).toEqual(['沟通'])
  })

  it('collects newest first with limit/since/budget', () => {
    expect(collectDiaries(path.join(root, 'events'), { limit: 10, maxChars: 9999, diaryChars: 500 }).map((e) => e.title)).toEqual([
      '第二件',
      '第一件',
    ])
    expect(
      collectDiaries(path.join(root, 'events'), { limit: 10, since: '2026-10-31T00:00:00+08:00', maxChars: 9999, diaryChars: 500 }),
    ).toHaveLength(1)
  })

  it('renders ids and metadata', () => {
    const text = renderDiaries(collectDiaries(path.join(root, 'events'), { limit: 10, maxChars: 9999, diaryChars: 500 }))
    expect(text).toContain('事件 ID：ev_20261031T100000_bbbbbbbb')
    expect(text).toContain('标签：沟通')
  })
})

describe('parseAnalysisResponse', () => {
  it('parses all four ops', () => {
    const analysis = parseAnalysisResponse(JSON.stringify(fullPayload))
    expect(analysis.observations).toHaveLength(1)
    expect(analysis.suggestions.map((s) => s.op)).toEqual(['modify', 'add', 'remove', 'reorder'])
    const reorder = analysis.suggestions[3]!
    expect(reorder.order).toEqual(['事实 > 面子', '安全 > 进度'])
    expect(analysis.suggestions[0]?.risk).toBe('汇报可能变长')
  })

  it('derives piaget class from the op', () => {
    const analysis = parseAnalysisResponse(
      JSON.stringify({ equilibriumScore: 0.5, summary: 's', observations: [], suggestions: [
        { id: 'a', area: 'style', op: 'modify', target: 't', value: 'v', reason: 'r', evidence: [] },
        { id: 'b', area: 'style', op: 'add', value: 'v2', reason: 'r', evidence: [] },
      ] }),
    )
    expect(analysis.suggestions[0]?.piaget).toBe('assimilation')
    expect(analysis.suggestions[1]?.piaget).toBe('accommodation')
  })

  it('drops suggestions missing their op-specific fields', () => {
    const analysis = parseAnalysisResponse(
      JSON.stringify({
        equilibriumScore: 0.3,
        summary: 's',
        observations: [],
        suggestions: [
          { id: 's1', area: 'style', op: 'add' }, // 缺 value
          { id: 's2', area: 'style', op: 'remove' }, // 缺 target
          { id: 's3', area: 'value', op: 'modify', target: 'x' }, // 缺 value
          { id: 's4', area: 'value', op: 'reorder', order: ['only-one'] }, // 不足 2 条
          { id: 's5', area: 'style', op: 'add', value: '有效条目', reason: 'r', evidence: [] },
        ],
      }),
    )
    expect(analysis.suggestions.map((s) => s.id)).toEqual(['s5'])
  })

  it('tolerates fences, prose and chinese area/op words', () => {
    const analysis = parseAnalysisResponse(
      '好的：\n```json\n' +
        JSON.stringify({
          equilibriumScore: 1.7,
          summary: 's',
          observations: [],
          suggestions: [{ id: 's1', area: '风格', op: '增', value: '先给结论', reason: 'r', evidence: [] }],
        }) +
        '\n```\n以上。',
    )
    expect(analysis.equilibriumScore).toBe(1)
    expect(analysis.suggestions[0]?.area).toBe('style')
    expect(analysis.suggestions[0]?.op).toBe('add')
    expect(analysis.suggestions[0]?.confidence).toBeCloseTo(0.5)
  })

  it('throws only when nothing usable came back', () => {
    expect(() => parseAnalysisResponse('not json')).toThrow(AnalysisError)
    expect(() => parseAnalysisResponse('{}')).toThrow(AnalysisError)
    expect(() =>
      parseAnalysisResponse(JSON.stringify({ observations: [], suggestions: [], summary: '' })),
    ).toThrow(AnalysisError)
  })
})

describe('normalizeAnalysis', () => {
  it('clamps score and defaults severity/against', () => {
    const analysis = normalizeAnalysis({
      equilibriumScore: -3,
      summary: 'x',
      observations: [{ area: 'VALUE', observed: 'o', conflict: 'c' }],
      suggestions: [],
    })
    expect(analysis.equilibriumScore).toBe(0)
    expect(analysis.observations[0]?.area).toBe('value')
    expect(analysis.observations[0]?.against).toBe('（该节为空）')
    expect(analysis.observations[0]?.severity).toBe('low')
  })
})
