/**
 * AutoSchema — 编排：读图式与日记，交给 DeepSeek 做皮亚杰式分析，按需写回 AGENTS.md。
 *
 * 一次完整的平衡化循环：
 *   1. 读 `~/.dsh/AGENTS.md`（当前图式）
 *   2. 读最近若干篇日记（经验）
 *   3. 让 DeepSeek 给出非平衡 / 同化 / 顺应
 *   4. 校验并应用（可选）→ 快照旧版本 → 写回
 */

import fs from 'node:fs'
import path from 'node:path'

import { applyChanges, parseSchemaDoc, renderSchemaDoc, writeSchemaDoc } from './agents-md.js'
import { collectDiaries, renderDiaries } from './diaries.js'
import { DeepseekClient } from './deepseek.js'
import { buildAnalysisRequest, parseAnalysisResponse } from './prompt.js'
import { resolveApiKey } from './config.js'
import { createLogger, ensureDir, nowIso, readTextFile, timestampForFile, writeJsonFile, writeTextAtomic } from './util.js'
import { SECTION_LABELS } from './types.js'
import type {
  Analysis,
  AutoSchemaConfig,
  ChatClient,
  DiaryEntry,
  Logger,
  SchemaDoc,
} from './types.js'

export interface RunOptions {
  config: AutoSchemaConfig
  /** 注入传输层（测试用）；缺省走真实 DeepSeek。 */
  client?: ChatClient
  logger?: Logger
  /** 只分析不写回（默认 true）。 */
  dryRun?: boolean
  /** 覆盖：只取最近 N 篇日记。 */
  limit?: number
  /** 覆盖：时间下界。 */
  since?: string
}

export interface RunResult {
  analysis: Analysis
  /** 变更前的图式。 */
  before: SchemaDoc
  /** 变更后的图式（dryRun 时等于 before 加变更的草案，不落盘）。 */
  after: SchemaDoc
  applied: { assimilation: number; accommodation: number }
  skipped: string[]
  diaries: DiaryEntry[]
  rendered: string
  /** 写回成功后的快照路径。 */
  snapshot?: string
  wrote: boolean
}

/** 读取当前图式；文件不存在时返回空图式（而不是报错）。 */
export function readSchema(config: AutoSchemaConfig): SchemaDoc {
  const raw = readTextFile(config.agentsFile) ?? ''
  return parseSchemaDoc(raw)
}

/** 采集日记。 */
export function gatherDiaries(config: AutoSchemaConfig, limit?: number, since?: string): DiaryEntry[] {
  return collectDiaries(config.memoryRoot, {
    limit: limit ?? config.diaryLimit,
    maxChars: config.maxInputChars,
    diaryChars: config.diaryChars,
    ...(since ?? config.since ?? undefined ? { since: since ?? config.since ?? undefined } : {}),
  })
}

/** 快照旧版本，保留历史（不依赖 git）。 */
export function snapshotSchema(config: AutoSchemaConfig, raw: string): string {
  const historyDir = path.join(config.stateRoot, 'history')
  ensureDir(historyDir)
  const file = path.join(historyDir, `AGENTS-${timestampForFile()}.md`)
  writeTextAtomic(file, raw)
  const logFile = path.join(historyDir, 'changelog.jsonl')
  const line = JSON.stringify({ at: nowIso(), file, chars: raw.length })
  fs.appendFileSync(logFile, `${line}\n`, 'utf8')
  return file
}

/**
 * 一次分析（不写回）。
 *
 * 传 `dryRun: false` 时才把结果写进 AGENTS.md（先快照）。
 */
export async function run(options: RunOptions): Promise<RunResult> {
  const { config } = options
  const logger = options.logger ?? createLogger()
  const dryRun = options.dryRun !== false

  const before = readSchema(config)
  const diaries = gatherDiaries(config, options.limit, options.since)
  if (diaries.length === 0) {
    throw new Error(
      `没有可用日记：${config.memoryRoot}/events 为空，或 since/limit 过滤后无内容。先跑一次 AutoBioMemory 的整理。`,
    )
  }
  logger.info(`图式：风格 ${before.style.length} / 信念 ${before.belief.length} / 价值观 ${before.value.length} 条；日记 ${diaries.length} 篇`)

  const client = options.client ?? new DeepseekClient(config.deepseek, requireApiKey(config), logger)
  const renderedDiaries = renderDiaries(diaries)
  const { system, user } = buildAnalysisRequest({ doc: before, diaries, renderedDiaries })
  const raw = await client.chat([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ])
  const analysis = parseAnalysisResponse(raw)

  const merged = applyChanges(before, analysis.assimilation, analysis.accommodation)
  const rendered = renderSchemaDoc(merged.doc)

  let snapshot: string | undefined
  let wrote = false
  if (!dryRun && (merged.applied.assimilation > 0 || merged.applied.accommodation > 0)) {
    const original = readTextFile(config.agentsFile) ?? ''
    snapshot = snapshotSchema(config, original)
    writeSchemaDoc(config.agentsFile, merged.doc)
    wrote = true
    logger.info(`已写回 ${config.agentsFile}（快照：${snapshot}）`)
  }

  const result: RunResult = {
    analysis,
    before,
    after: merged.doc,
    applied: merged.applied,
    skipped: merged.skipped,
    diaries,
    rendered,
    wrote,
    ...(snapshot === undefined ? {} : { snapshot }),
  }
  writeJsonFile(path.join(config.stateRoot, 'last-run.json'), {
    at: nowIso(),
    dryRun,
    equilibriumScore: analysis.equilibriumScore,
    diarised: diaries.length,
    applied: merged.applied,
    skipped: merged.skipped,
    wrote,
  })
  return result
}

function requireApiKey(config: AutoSchemaConfig): string {
  const key = resolveApiKey(config)
  if (key === undefined || key === '') {
    throw new Error(
      '缺少 DEEPSEEK_API_KEY：请写入 ~/.dsh/.env、~/.autobiomemory/.env 或 ~/.autoschema/.env，或用环境变量提供。',
    )
  }
  return key
}

/** 人类可读报告（CLI 与测试共用）。 */
export function renderReport(result: RunResult): string {
  const { analysis, applied, skipped } = result
  const lines: string[] = []
  const pct = Math.round(analysis.equilibriumScore * 100)
  lines.push(`平衡度：${pct}%（0=完全冲突，100=完全自洽）`)
  if (analysis.summary !== '') lines.push(`总览：${analysis.summary}`)
  lines.push('')

  lines.push(`非平衡 ${analysis.disequilibrium.length} 条`)
  for (const item of analysis.disequilibrium) {
    lines.push(`  · [${SECTION_LABELS[item.area]}·${item.severity}] ${item.observed}`)
    lines.push(`    冲突对象：${item.against}`)
    if (item.conflict !== '') lines.push(`    张力：${item.conflict}`)
    for (const evidence of item.evidence.slice(0, 3)) {
      lines.push(`    证据：${evidence.eventId}${evidence.quote === undefined ? '' : ` 「${evidence.quote}」`}`)
    }
  }
  lines.push('')

  lines.push(`同化 ${analysis.assimilation.length} 条（实际应用 ${applied.assimilation}）`)
  for (const item of analysis.assimilation) {
    lines.push(`  · [${SECTION_LABELS[item.area]}] ${item.target}`)
    lines.push(`    → ${item.revised}`)
    if (item.why !== '') lines.push(`    理由：${item.why}`)
  }
  lines.push('')

  lines.push(`顺应 ${analysis.accommodation.length} 条（实际应用 ${applied.accommodation}）`)
  for (const item of analysis.accommodation) {
    lines.push(`  · [${SECTION_LABELS[item.area]}] ${item.text}`)
    if (item.why !== '') lines.push(`    理由：${item.why}`)
  }

  if (skipped.length > 0) {
    lines.push('')
    lines.push(`已跳过：`)
    for (const reason of skipped) lines.push(`  · ${reason}`)
  }
  if (analysis.notes !== '') {
    lines.push('')
    lines.push(`备注：${analysis.notes}`)
  }
  lines.push('')
  lines.push(result.wrote ? `已写回：${result.snapshot ?? '(无快照)'}` : '未写回（dry-run，加 --apply 才落盘）')
  return lines.join('\n')
}

/** 图式变更历史。 */
export function listHistory(config: AutoSchemaConfig): Array<{ at: string; file: string; chars: number }> {
  const logFile = path.join(config.stateRoot, 'history', 'changelog.jsonl')
  const text = readTextFile(logFile)
  if (text === undefined) return []
  return text
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => {
      try {
        return JSON.parse(line) as { at: string; file: string; chars: number }
      } catch {
        return undefined
      }
    })
    .filter((entry): entry is { at: string; file: string; chars: number } => entry !== undefined)
}
