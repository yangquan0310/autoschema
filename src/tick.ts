/**
 * AutoSchema — 触发执行器：把"该不该跑"与"跑什么"接起来。
 *
 * 供 tick / daemon / hook 三条路径共用，保证三种触发方式的语义完全一致：
 *   闸门（冷却 + 未消化数量）→ 取未消化日记 → 分析 → 按 applyMode 落盘或存为待审。
 */

import { checkDue, checkHookDue, recordSkip, type DueCheck } from './schedule.js'
import { propose, readSchema } from './reconcile.js'
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
  /** 只出建议（proposed）｜无建议（clean）｜被闸门跳过（skipped）。 */
  mode: 'proposed' | 'clean' | 'skipped'
  message: string
}

/** 自动触发只产建议：摘要里说清条数与操作分布，不说"已写回"。 */
function describe(result: RunResult): string {
  const ops = result.analysis.suggestions.map((s) => s.op)
  const count = (op: string): number => ops.filter((entry) => entry === op).length
  return [
    `平衡度 ${Math.round(result.analysis.equilibriumScore * 100)}%`,
    `非平衡 ${result.analysis.observations.length}`,
    `建议 ${result.analysis.suggestions.length}（增 ${count('add')} 删 ${count('remove')} 改 ${count('modify')} 重排 ${count('reorder')}）`,
  ].join(' · ')
}

/** 跑一次（受闸门约束，除非 origin=manual）。**产出建议，从不改 AGENTS.md。** */
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

  const result = await propose({
    config,
    logger,
    ...(options.client === undefined ? {} : { client: options.client }),
    runId: nowIso(),
  })

  const mode = result.pendingSaved ? 'proposed' : 'clean'
  const message = describe(result)
  logger.info(`${result.pendingSaved ? '建议已就绪（未写回）' : '图式与经验基本自洽'}：${message}`)
  return { ran: true, result, mode, message }
}

/** 供 hook 使用：把最近运行时间写进游标，避免同一生命周期点连跑。 */
export function touchRun(config: AutoSchemaConfig): void {
  const cursor = loadCursor(config.stateRoot)
  saveCursor(config.stateRoot, { ...cursor, lastRunAt: nowIso(), skippedRuns: 0 })
}

export { readSchema }
