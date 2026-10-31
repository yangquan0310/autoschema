import { describe, expect, it } from 'vitest'

import {
  applyChanges,
  findClosestIndex,
  itemCount,
  parseSchemaDoc,
  renderSchemaDoc,
  writeSchemaDoc,
} from '../src/agents-md.js'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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
`

describe('parseSchemaDoc', () => {
  it('reads the empty skeleton without inventing items', () => {
    const doc = parseSchemaDoc(SKELETON)
    expect(itemCount(doc)).toBe(0)
    expect(doc.preamble.style).toHaveLength(1)
    expect(doc.preamble.style[0]).toContain('风格指怎么做事')
    expect(doc.preamble.value[0]).toContain('冲突时的排序')
  })

  it('collects bullets per section and keeps the preamble', () => {
    const doc = parseSchemaDoc(FILLED)
    expect(doc.style).toEqual(['说话简洁，先给结论再给依据', '动手前先复述一遍需求'])
    expect(doc.belief).toEqual(['不知道就说不知道'])
    expect(doc.value).toEqual(['安全 > 进度', '事实 > 面子'])
    expect(itemCount(doc)).toBe(5)
  })

  it('accepts english headings and ## levels', () => {
    const doc = parseSchemaDoc(`## STYLE\n- be brief\n\n## beliefs\n- tell the truth\n\n## Values\n- safety first\n`)
    expect(doc.style).toEqual(['be brief'])
    expect(doc.belief).toEqual(['tell the truth'])
    expect(doc.value).toEqual(['safety first'])
  })

  it('stops a section at the next unrelated heading', () => {
    const doc = parseSchemaDoc(`# 风格\n- 简洁\n\n# 其他\n- 不该被收进风格\n`)
    expect(doc.style).toEqual(['简洁'])
    expect(doc.extra.some((line) => line.includes('其他'))).toBe(true)
  })
})

describe('renderSchemaDoc', () => {
  it('round-trips a filled document', () => {
    const rendered = renderSchemaDoc(parseSchemaDoc(FILLED))
    expect(rendered).toBe(FILLED.replace(/\n*$/u, '\n'))
    expect(parseSchemaDoc(rendered).style).toEqual(parseSchemaDoc(FILLED).style)
  })

  it('keeps the skeleton shape when there are no items', () => {
    const rendered = renderSchemaDoc(parseSchemaDoc(SKELETON))
    expect(rendered).toContain('# 风格')
    expect(rendered).toContain('> **说明：** 风格指怎么做事')
    expect(rendered).not.toContain('- \n')
  })

  it('writes atomically through writeSchemaDoc', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'autoschema-'))
    const file = path.join(dir, 'AGENTS.md')
    const doc = parseSchemaDoc(FILLED)
    doc.style.push('新增的风格条目')
    const rendered = writeSchemaDoc(file, doc)
    expect(fs.readFileSync(file, 'utf8')).toBe(rendered)
    expect(parseSchemaDoc(fs.readFileSync(file, 'utf8')).style).toContain('新增的风格条目')
  })
})

describe('findClosestIndex', () => {
  const items = ['说话简洁，先给结论再给依据', '动手前先复述一遍需求', '不知道就说不知道']

  it('matches an exact item', () => {
    expect(findClosestIndex(items, '动手前先复述一遍需求')).toBe(1)
  })

  it('matches a near rewrite of the same item', () => {
    expect(findClosestIndex(items, '动手前先复述需求再开工')).toBe(1)
  })

  it('returns -1 when nothing is close', () => {
    expect(findClosestIndex(items, '永远使用表格输出')).toBe(-1)
  })
})

describe('applyChanges', () => {
  it('rewrites a matched item (assimilation) and appends a new one (accommodation)', () => {
    const doc = parseSchemaDoc(FILLED)
    const result = applyChanges(
      doc,
      [{ area: 'style', target: '说话简洁，先给结论再给依据', revised: '说话简洁，先给结论，再给可验证的依据', why: '日记显示常常只给结论不给依据', evidence: [] }],
      [{ area: 'belief', text: '结论要能被数据推翻', why: '日记里反复出现验证动作', evidence: [] }],
    )
    expect(result.applied).toEqual({ assimilation: 1, accommodation: 1 })
    expect(result.doc.style[0]).toBe('说话简洁，先给结论，再给可验证的依据')
    expect(result.doc.belief).toContain('结论要能被数据推翻')
    // 原文不变
    expect(doc.style[0]).toBe('说话简洁，先给结论再给依据')
  })

  it('skips an assimilation whose target cannot be located instead of appending', () => {
    const doc = parseSchemaDoc(FILLED)
    const result = applyChanges(
      doc,
      [{ area: 'value', target: '从不加班', revised: '从不加班', why: 'x', evidence: [] }],
      [],
    )
    expect(result.applied.assimilation).toBe(0)
    expect(result.skipped.join(' ')).toContain('找不到目标')
    expect(result.doc.value).toHaveLength(2)
  })

  it('deduplicates an accommodation that already exists', () => {
    const doc = parseSchemaDoc(FILLED)
    const result = applyChanges(doc, [], [{ area: 'belief', text: '不知道就说不知道。', why: 'x', evidence: [] }])
    expect(result.applied.accommodation).toBe(0)
    expect(result.skipped.join(' ')).toContain('已存在')
  })

  it('appends accommodations at the end of the 价值观 section (lowest priority)', () => {
    const doc = parseSchemaDoc(FILLED)
    const result = applyChanges(doc, [], [{ area: 'value', text: '长期 > 短期', why: 'x', evidence: [] }])
    expect(result.doc.value).toEqual(['安全 > 进度', '事实 > 面子', '长期 > 短期'])
  })

  it('leaves the document untouched when given empty inputs', () => {
    const doc = parseSchemaDoc(FILLED)
    const result = applyChanges(doc, [], [])
    expect(result.applied).toEqual({ assimilation: 0, accommodation: 0 })
    expect(renderSchemaDoc(result.doc)).toBe(renderSchemaDoc(doc))
  })
})
