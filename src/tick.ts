/**
 * AutoSchema — 触发执行器：把"该不该跑"与"跑什么"接起来。
 *
 * 供 tick / daemon / hook 三条路径共用，保证三种触发方式的语义完全一致：
 *   闸门（冷却 + 未消化数量）→ 取未消化日记 → 分析 → 按 applyMode 落盘或存为待审。
 */

import { checkDue, checkHookDue, recordSkip, type DueCheck } from './schedule.js'
import { readSchema, run } from './reconcile.js'
import { loadCursor, saveCursor } from './cursor.js'
import { createLogger, nowIso } from './util.js'
import { SECTION_LABELS } from './types.js'
import type { RunResult } from './reconcile.js'
import type { AutoSchemaConfig, ChatClient, Logger } from './types.js'

export interface TickOptions {
  config: AutoSchemaConfig
  client?: ChatClient
  logger?: Logger
  /** manual=强制跑（忽略闸门）；schedule/hook=按闸门判断。 */
  origin: 'manual' | 'schedule' | 'hook'
  /** 仅检查不执行。 */
  dryCheck?: boolean
}

export interface TickResult {
  ran: boolean
  due?: DueCheck
  result?: RunResult
  /** 落盘还是仅出建议。 */
  mode: 'applied' | 'proposed' | 'skipped'
  message: string
}

function describe(result: RunResult): string {
  const parts = [
    `平衡度 ${Math.round(result.analysis.equilibriumScore * 100)}%`,
    `非平衡 ${result.analysis.disequilibrium.length}`,
    `同化 ${result.applied.assimilation}/${result.analysis.assimilation.length}`,
    `顺应 ${result.applied.accommodation}/${result.analysis.accommodation.length}`,
  ]
  const sections = (['style', 'belief', 'value'] as const)
    .map((section) => `${SECTION_LABELS[section]}${result.after[section].length}`)
    .join(' ')
  return `${parts.join(' · ')}（图式：${sections}）`
}

/** 跑一次（受闸门约束，除非 origin=manual）。 */
export async function tick(options: TickOptions): Promise<TickResult> {
  const logger = options.logger ?? createLogger()
  const { config } = options

  if (options.origin !== 'manual') {
    const due = options.origin === 'hook' ? checkHookDue(config) : checkDue(config)
    if (!due.due) {
      if (!options.dryCheck) recordSkip(config)
      logger.debug(`跳过：${due.reason}`)
      return { ran: false, due, mode: 'skipped', message: due.reason }
    }
  } else if (options.dryCheck) {
    return { ran: false, due: checkDue(config), mode: 'skipped', message: 'manual dry-check' }
  }

  const applyNow = options.origin === 'manual' ? false : config.trigger.applyMode === 'apply'
  const result = await run({
    config,
    logger,
    dryRun: !applyNow,
    ...(options.client === undefined ? {} : { client: options.client }),
    runId: nowIso(),
  })

  const mode = result.wrote ? 'applied' : 'proposed'
  const message = describe(result)
  if (result.wrote) logger.info(`已写回 AGENTS.md：${message}`)
  else logger.info(`建议已就绪（待落盘）：${message}`)
  return { ran: true, result, mode, message }
}

/** 供 hook 使用：把最近的运行时间写进游标，避免同一生命周期点连跑。 */
export function touchRun(config: AutoSchemaConfig): void {
  const cursor = loadCursor(config.stateRoot)
  saveCursor(config.stateRoot, { ...cursor, lastRunAt: nowIso(), skippedRuns: 0 })
}

export { readSchema }
