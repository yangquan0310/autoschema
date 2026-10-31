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

import { applySuggestions, parseSchemaDoc, renderSchemaDoc, writeSchemaDoc } from './agents-md.js'
import { collectDiaries, renderDiaries, resolveDiaryDirs } from './diaries.js'
import { filterUndigested, loadCursor, markDigested, markProposed, markRun, saveCursor } from './cursor.js'
import { DeepseekClient } from './deepseek.js'
import { buildAnalysisRequest, parseAnalysisResponse } from './prompt.js'
import { resolveApiKey } from './config.js'
import {
  createLogger,
  ensureDir,
  nowIso,
  readJsonFile,
  readTextFile,
  timestampForFile,
  writeJsonFile,
  writeTextAtomic,
} from './util.js'
import { SECTION_LABELS } from './types.js'
import type {
  Analysis,
  ApplyResult,
  Suggestion,
  AutoSchemaConfig,
  ChatClient,
  DiaryEntry,
  Logger,
  PendingProposal,
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
  /** 覆盖：是否只喂未消化的日记（默认取 config.digest.onlyUndigested）。 */
  onlyUndigested?: boolean
  /** 覆盖：跑完是否标记消化（默认 true；失败/异常不标记）。 */
  markDigested?: boolean
  /** 运行批次 id（测试可注入）。 */
  runId?: string
}

export interface RunResult {
  analysis: Analysis
  /** 本次实际喂进去的日记 id。 */
  digestedIds: string[]
  /** 因"已处理过"被跳过的篇数。 */
  skippedDigested: number
  diaries: DiaryEntry[]
  /** 当前图式渲染（未改动）。 */
  rendered: string
  /** 建议已存为待审（供 apply --from-pending 消费）。 */
  pendingSaved: boolean
}

/** 读取当前图式；文件不存在时返回空图式（而不是报错）。 */
export function readSchema(config: AutoSchemaConfig): SchemaDoc {
  const raw = readTextFile(config.agentsFile) ?? ''
  return parseSchemaDoc(raw)
}

/** 取 DeepSeek 密钥或抛出可读错误。 */
function requireApiKey(config: AutoSchemaConfig): string {
  const key = resolveApiKey(config)
  if (key === undefined || key === '') {
    throw new Error(
      '缺少 DEEPSEEK_API_KEY：请写入 ~/.dsh/.env、~/.autobiomemory/.env 或 ~/.autoschema/.env，或用环境变量提供。',
    )
  }
  return key
}

/** 采集日记。 */
export function gatherDiaries(config: AutoSchemaConfig, limit?: number, since?: string): DiaryEntry[] {
  return collectDiaries(resolveDiaryDirs(config), {
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
  // 同一秒内多次快照要各自成文件：加毫秒与递增后缀
  const stamp = timestampForFile()
  let file = path.join(historyDir, `AGENTS-${stamp}.md`)
  let counter = 1
  while (fs.existsSync(file)) {
    file = path.join(historyDir, `AGENTS-${stamp}-${counter}.md`)
    counter += 1
  }
  writeTextAtomic(file, raw)
  const logFile = path.join(historyDir, 'changelog.jsonl')
  const line = JSON.stringify({ at: nowIso(), file, chars: raw.length })
  fs.appendFileSync(logFile, `${line}\n`, 'utf8')
  return file
}

/**
 * 一次分析 —— **只产出建议，绝不改 AGENTS.md**。
 *
 * 建议同时写入 `state/pending.json`（供 agent 之后挑选采纳）与 `state/last-run.json`（摘要）。
 */
export async function propose(options: RunOptions): Promise<RunResult> {
  const { config } = options
  const logger = options.logger ?? createLogger()

  const before = readSchema(config)
  const onlyUndigested = options.onlyUndigested ?? config.digest.onlyUndigested
  const cursor = loadCursor(config.stateRoot)
  const gathered = gatherDiaries(config, options.limit, options.since)
  const diaries = onlyUndigested ? filterUndigested(cursor, gathered) : gathered
  const skippedDigested = gathered.length - diaries.length
  if (diaries.length === 0) {
    throw new Error(
      gathered.length === 0
        ? `没有可用日记：${resolveDiaryDirs(config).join('、') || '(未配置 diaries.dirs)'} 为空，或 since/limit 过滤后无内容。先跑一次 AutoBioMemory 的整理，或在 config.json 的 diaries.dirs 里指向正确的目录。`
        : `没有"未消化"的日记（最近 ${gathered.length} 篇都已处理过）。用 --all 或 digest.onlyUndigested=false 重新分析全部。`,
    )
  }
  logger.info(
    `图式：风格 ${before.style.length} / 信念 ${before.belief.length} / 价值观 ${before.value.length} 条；日记 ${diaries.length} 篇`,
  )

  const client = options.client ?? new DeepseekClient(config.deepseek, requireApiKey(config), logger)
  const renderedDiaries = renderDiaries(diaries)
  const { system, user } = buildAnalysisRequest({ doc: before, diaries, renderedDiaries })
  const raw = await client.chat([
    { role: 'system', content: system },
    { role: 'user', content: user },
  ])
  const analysis = parseAnalysisResponse(raw)

  const runId = options.runId ?? nowIso()
  const ids = diaries.map((entry) => entry.eventId)
  saveCursor(
    config.stateRoot,
    analysis.suggestions.length > 0 ? markProposed(cursor, ids, runId) : markRun(cursor, runId),
  )
  const pendingSaved = analysis.suggestions.length > 0
  if (pendingSaved) {
    writeJsonFile(pendingFile(config.stateRoot), { at: nowIso(), runId, analysis, eventIds: ids })
  }
  writeJsonFile(path.join(config.stateRoot, 'last-run.json'), {
    at: nowIso(),
    equilibriumScore: analysis.equilibriumScore,
    observations: analysis.observations.length,
    suggestions: analysis.suggestions.length,
    diaries: diaries.length,
  })

  return {
    analysis,
    digestedIds: ids,
    skippedDigested,
    diaries,
    rendered: renderSchemaDoc(before),
    pendingSaved,
  }
}

/** 兼容旧名字（`run` 现在等同于"只出建议"）。 */
export const run = propose

/** 待审建议文件位置。 */
export function pendingFile(stateRoot: string): string {
  return path.join(stateRoot, 'state', 'pending.json')
}

/** 读取待审建议。 */
export function loadPending(config: AutoSchemaConfig): PendingProposal | undefined {
  return readJsonFile<PendingProposal>(pendingFile(config.stateRoot))
}

export function clearPending(config: AutoSchemaConfig): void {
  try {
    fs.rmSync(pendingFile(config.stateRoot))
  } catch {
    /* 不存在即视为已清 */
  }
}

export interface ApplySelectionOptions {
  /** 只采纳这些建议 id；缺省=全部。 */
  ids?: string[]
  /** 运行批次（写进快照历史）。 */
  runId?: string
}

/**
 * 采纳建议并写回 —— **只由显式调用触发**（`autoschema apply --ids s1,s3`）。
 *
 * 写前先快照；定位不到的建议进 `rejected`，不做猜测性降级。
 */
export function applySelected(
  config: AutoSchemaConfig,
  suggestions: Suggestion[],
  options: ApplySelectionOptions = {},
): ApplyResult {
  const before = readSchema(config)
  const outcome = applySuggestions(before, suggestions, {
    ...(options.ids === undefined ? {} : { ids: options.ids }),
    maxRemovals: config.trigger.maxRemovals,
    maxAdditions: config.trigger.maxAdditions,
  })
  const changed =
    outcome.applied.add + outcome.applied.remove + outcome.applied.modify + outcome.applied.reorder > 0
  let snapshot: string | undefined
  if (changed) {
    snapshot = snapshotSchema(config, readTextFile(config.agentsFile) ?? '')
    writeSchemaDoc(config.agentsFile, outcome.doc)
  }
  return {
    changed,
    doc: outcome.doc,
    rendered: outcome.rendered,
    applied: outcome.applied,
    rejected: outcome.rejected,
    ...(snapshot === undefined ? {} : { snapshot }),
  }
}

/** 采纳待审建议（`autoschema apply --from-pending`）。 */
export function applyPending(
  config: AutoSchemaConfig,
  options: ApplySelectionOptions = {},
): { result: ApplyResult; cursorMarked: number } {
  const pending = loadPending(config)
  if (pending === undefined) throw new Error('没有待审建议（先运行 autoschema propose）')
  const result = applySelected(config, pending.analysis.suggestions, options)
  const cursor = loadCursor(config.stateRoot)
  const accepted = options.ids === undefined
    ? pending.eventIds
    : pending.analysis.suggestions.filter((s) => options.ids?.includes(s.id)).length > 0
      ? pending.eventIds
      : []
  if (accepted.length > 0 && result.changed) {
    saveCursor(config.stateRoot, markDigested(cursor, accepted, options.runId ?? pending.runId))
  }
  if (options.ids === undefined) clearPending(config)
  return { result, cursorMarked: accepted.length }
}

const OP_LABELS: Record<Suggestion['op'], string> = {
  add: '增',
  remove: '删',
  modify: '改',
  reorder: '重排',
}

/** 人类可读报告（CLI 与测试共用）。**只讲建议，不讲"已写回"**。 */
export function renderReport(result: RunResult): string {
  const { analysis } = result
  const lines: string[] = []
  lines.push(`平衡度：${Math.round(analysis.equilibriumScore * 100)}%（0=完全冲突，100=完全自洽）`)
  if (analysis.summary !== '') lines.push(`总览：${analysis.summary}`)
  lines.push('')

  lines.push(`非平衡观察 ${analysis.observations.length} 条`)
  for (const item of analysis.observations) {
    lines.push(`  · [${SECTION_LABELS[item.area]}·${item.severity}] ${item.observed}`)
    lines.push(`    冲突对象：${item.against}`)
    if (item.conflict !== '') lines.push(`    张力：${item.conflict}`)
    for (const evidence of item.evidence.slice(0, 3)) {
      lines.push(`    证据：${evidence.eventId}${evidence.quote === undefined ? '' : ` 「${evidence.quote}」`}`)
    }
  }
  lines.push('')

  lines.push(`建议 ${analysis.suggestions.length} 条（是否采纳由你决定）`)
  for (const suggestion of analysis.suggestions) {
    const label = OP_LABELS[suggestion.op]
    lines.push(`  · ${suggestion.id} [${SECTION_LABELS[suggestion.area]}·${label}] ${
      suggestion.op === 'reorder'
        ? `新顺序：${(suggestion.order ?? []).join(' → ')}`
        : suggestion.op === 'add'
          ? `+ ${suggestion.value ?? ''}`
          : suggestion.op === 'remove'
            ? `- ${suggestion.target ?? ''}`
            : `${suggestion.target ?? ''} → ${suggestion.value ?? ''}`
    }`)
    lines.push(`    皮亚杰：${suggestion.piaget === 'assimilation' ? '同化（改措辞）' : '顺应（改结构）'}｜把握 ${Math.round(suggestion.confidence * 100)}%｜${suggestion.severity}`)
    if (suggestion.reason !== '') lines.push(`    理由：${suggestion.reason}`)
    if (suggestion.risk !== undefined) lines.push(`    风险：${suggestion.risk}`)
    for (const evidence of suggestion.evidence.slice(0, 3)) {
      lines.push(`    证据：${evidence.eventId}${evidence.quote === undefined ? '' : ` 「${evidence.quote}」`}`)
    }
  }

  if (analysis.notes !== '') {
    lines.push('')
    lines.push(`备注：${analysis.notes}`)
  }
  lines.push('')
  lines.push(
    result.pendingSaved
      ? `建议已存为待审：${'~/.autoschema/state/pending.json'}（采纳：autoschema apply --ids s1,s3）`
      : '没有需要落地的建议（图式与经验基本自洽）。',
  )
  return lines.join('\n')
}

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
