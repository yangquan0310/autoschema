import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  applySuggestions,
  findClosestIndex,
  itemCount,
  parseSchemaDoc,
  renderSchemaDoc,
  writeSchemaDoc,
} from '../src/agents-md.js'
import type { Suggestion } from '../src/types.js'

const SKELETON = `# 风格

> **说明：** 风格指怎么做事，强调外在行为的可观察性。

- 

# 信念

> **说明：** 信念指信什么，是内在的价值原则。

- 

# 价值观

> **说明：** 价值观指发生冲突时的排序。

- `

const FILLED = `# 风格

> **说明：** 风格指怎么做事，强调外在行为的可观察性。

- 说话简洁，先给结论再给依据
- 动手前先复述一遍需求

# 信念

> **说明：** 信念指信什么，是内在的价值原则。

- 不知道就说不知道

# 价值观

> **说明：** 价值观指发生冲突时的排序。

- 安全 > 进度
- 事实 > 面子
- 长期 > 短期
`

const suggestion = (over: Partial<Suggestion> & Pick<Suggestion, 'area' | 'op'>): Suggestion => ({
  id: 's1',
  piaget: over.op === 'modify' ? 'assimilation' : 'accommodation',
  reason: 'r',
  evidence: [],
  confidence: 0.7,
  severity: 'medium',
  ...over,
})

describe('parse / render', () => {
  it('reads the empty skeleton without inventing items', () => {
    const doc = parseSchemaDoc(SKELETON)
    expect(itemCount(doc)).toBe(0)
    expect(doc.preamble.style[0]).toContain('风格指怎么做事')
  })

  it('collects bullets per section and keeps the preamble', () => {
    const doc = parseSchemaDoc(FILLED)
    expect(doc.style).toHaveLength(2)
    expect(doc.value).toEqual(['安全 > 进度', '事实 > 面子', '长期 > 短期'])
    expect(itemCount(doc)).toBe(6)
  })

  it('round-trips a filled document', () => {
    expect(renderSchemaDoc(parseSchemaDoc(FILLED))).toBe(FILLED)
  })

  it('writes atomically', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoschema-md-'))
    const file = path.join(dir, 'AGENTS.md')
    const doc = parseSchemaDoc(FILLED)
    doc.style.push('新条目')
    const rendered = writeSchemaDoc(file, doc)
    expect(fs.readFileSync(file, 'utf8')).toBe(rendered)
  })
})

describe('findClosestIndex', () => {
  const items = parseSchemaDoc(FILLED).value

  it('matches exact and near rewrites', () => {
    expect(findClosestIndex(items, '事实 > 面子')).toBe(1)
    expect(findClosestIndex(items, '事实要比面子重要')).toBe(1)
  })

  it('returns -1 for unrelated text', () => {
    expect(findClosestIndex(items, '永远输出表格')).toBe(-1)
  })
})

describe('applySuggestions — 增 (add)', () => {
  it('appends to the section and dedupes', () => {
    const doc = parseSchemaDoc(FILLED)
    const outcome = applySuggestions(doc, [
      suggestion({ id: 's1', area: 'belief', op: 'add', value: '结论要能被数据推翻' }),
      suggestion({ id: 's2', area: 'belief', op: 'add', value: '不知道就说不知道。' }),
    ])
    expect(outcome.applied.add).toBe(1)
    expect(outcome.doc.belief).toContain('结论要能被数据推翻')
    expect(outcome.rejected.join(' ')).toContain('已存在')
    expect(doc.belief).toHaveLength(1) // 原文档不受影响
  })

  it('respects maxAdditions', () => {
    const doc = parseSchemaDoc(FILLED)
    const adds = [1, 2, 3].map((i) => suggestion({ id: `s${i}`, area: 'style', op: 'add', value: `新增${i}` }))
    const outcome = applySuggestions(doc, adds, { maxAdditions: 2 })
    expect(outcome.applied.add).toBe(2)
    expect(outcome.rejected.join(' ')).toContain('超过单次新增上限')
  })
})

describe('applySuggestions — 改 (modify)', () => {
  it('rewrites the matched item (assimilation)', () => {
    const doc = parseSchemaDoc(FILLED)
    const outcome = applySuggestions(doc, [
      suggestion({
        area: 'style',
        op: 'modify',
        target: '说话简洁，先给结论再给依据',
        value: '说话简洁：先给结论，再给可验证的依据',
      }),
    ])
    expect(outcome.applied.modify).toBe(1)
    expect(outcome.doc.style[0]).toBe('说话简洁：先给结论，再给可验证的依据')
  })

  it('rejects a modify whose target cannot be located (never degrades into add)', () => {
    const doc = parseSchemaDoc(FILLED)
    const outcome = applySuggestions(doc, [
      suggestion({ area: 'belief', op: 'modify', target: '从不加班', value: '从不加班' }),
    ])
    expect(outcome.applied.modify).toBe(0)
    expect(outcome.applied.add).toBe(0)
    expect(outcome.doc.belief).toHaveLength(1)
    expect(outcome.rejected.join(' ')).toContain('定位不到条目')
  })

  it('rejects a no-op modify', () => {
    const doc = parseSchemaDoc(FILLED)
    const outcome = applySuggestions(doc, [
      suggestion({ area: 'belief', op: 'modify', target: '不知道就说不知道', value: '不知道就说不知道。' }),
    ])
    expect(outcome.applied.modify).toBe(0)
    expect(outcome.rejected.join(' ')).toContain('相同')
  })
})

describe('applySuggestions — 删 (remove)', () => {
  it('removes the matched item', () => {
    const doc = parseSchemaDoc(FILLED)
    const outcome = applySuggestions(doc, [suggestion({ area: 'value', op: 'remove', target: '事实 > 面子' })])
    expect(outcome.applied.remove).toBe(1)
    expect(outcome.doc.value).toEqual(['安全 > 进度', '长期 > 短期'])
  })

  it('refuses to empty a section', () => {
    const doc = parseSchemaDoc(FILLED)
    const outcome = applySuggestions(doc, [
      suggestion({ area: 'belief', op: 'remove', target: '不知道就说不知道' }),
    ])
    expect(outcome.applied.remove).toBe(0)
    expect(outcome.rejected.join(' ')).toContain('拒绝删空')
  })

  it('caps removals per run and rejects unknown targets', () => {
    const doc = parseSchemaDoc(FILLED)
    const outcome = applySuggestions(
      doc,
      [
        suggestion({ id: 's1', area: 'value', op: 'remove', target: '安全 > 进度' }),
        suggestion({ id: 's2', area: 'value', op: 'remove', target: '事实 > 面子' }),
        suggestion({ id: 's3', area: 'style', op: 'remove', target: '不存在的条目' }),
      ],
      { maxRemovals: 1 },
    )
    expect(outcome.applied.remove).toBe(1)
    expect(outcome.rejected.join(' ')).toContain('超过单次删除上限')
    expect(outcome.rejected.join(' ')).toContain('定位不到条目')
  })
})

describe('applySuggestions — 价值观重排 (reorder)', () => {
  it('reorders exactly as asked (order = priority)', () => {
    const doc = parseSchemaDoc(FILLED)
    const outcome = applySuggestions(doc, [
      suggestion({ area: 'value', op: 'reorder', order: ['长期 > 短期', '安全 > 进度', '事实 > 面子'] }),
    ])
    expect(outcome.applied.reorder).toBe(1)
    expect(outcome.doc.value).toEqual(['长期 > 短期', '安全 > 进度', '事实 > 面子'])
  })

  it('keeps unmentioned items at the tail in their original relative order', () => {
    const doc = parseSchemaDoc(FILLED)
    const outcome = applySuggestions(doc, [
      suggestion({ area: 'value', op: 'reorder', order: ['长期 > 短期', '事实 > 面子'] }),
    ])
    expect(outcome.doc.value).toEqual(['长期 > 短期', '事实 > 面子', '安全 > 进度'])
  })

  it('rejects a no-op reorder and a single-item order', () => {
    const doc = parseSchemaDoc(FILLED)
    const noop = applySuggestions(doc, [
      suggestion({ area: 'value', op: 'reorder', order: ['安全 > 进度', '事实 > 面子', '长期 > 短期'] }),
    ])
    expect(noop.applied.reorder).toBe(0)
    expect(noop.rejected.join(' ')).toContain('顺序未变化')

    const single = applySuggestions(doc, [suggestion({ area: 'value', op: 'reorder', order: ['事实 > 面子'] })])
    expect(single.applied.reorder).toBe(0)
    expect(single.rejected.join(' ')).toContain('至少需要 2 条')
  })
})

describe('applySuggestions — 选择性采纳与纯函数性', () => {
  it('only applies the requested ids', () => {
    const doc = parseSchemaDoc(FILLED)
    const outcome = applySuggestions(
      doc,
      [
        suggestion({ id: 's1', area: 'belief', op: 'add', value: '新增 A' }),
        suggestion({ id: 's2', area: 'belief', op: 'add', value: '新增 B' }),
      ],
      { ids: ['s2'] },
    )
    expect(outcome.applied.add).toBe(1)
    expect(outcome.doc.belief).toContain('新增 B')
    expect(outcome.doc.belief).not.toContain('新增 A')
  })

  it('leaves the input document untouched', () => {
    const doc = parseSchemaDoc(FILLED)
    const before = renderSchemaDoc(doc)
    applySuggestions(doc, [
      suggestion({ area: 'style', op: 'add', value: 'x' }),
      suggestion({ area: 'value', op: 'remove', target: '安全 > 进度' }),
    ])
    expect(renderSchemaDoc(doc)).toBe(before)
  })
})
