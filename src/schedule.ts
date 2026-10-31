/**
 * AutoSchema — 定时触发。
 *
 * 两种用法，都不依赖守护进程常驻也都能常驻：
 *   1. 外部调度：`autoschema tick`（幂等）交给 cron / systemd timer，到点才真正干活；
 *   2. 内置循环：`autoschema daemon --interval 60` 自己按分钟检查。
 *
 * 是否"该跑"由三道闸门决定：cooldown、minNewDiaries、可选固定时刻。
 */

import { countUndigested, loadCursor, msSinceLastRun, saveCursor } from './cursor.js'
import { listEventIds, resolveDiaryDirs } from './diaries.js'
import { nowIso } from './util.js'
import type { AutoSchemaConfig } from './types.js'

export interface DueCheck {
  due: boolean
  reason: string
  /** 距离下次可跑还有多少毫秒（due=true 时为 0）。 */
  waitMs: number
  undigested: number
}

/** 解析 `HH:MM` 到今天（或明天）的时间点。 */
export function nextAtTime(now: Date, atTime: string): number | undefined {
  const match = /^(\d{1,2}):(\d{2})$/u.exec(atTime.trim())
  if (match === null) return undefined
  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours > 23 || minutes > 59) return undefined
  const target = new Date(now)
  target.setHours(hours, minutes, 0, 0)
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1)
  return target.getTime()
}

/**
 * 判断现在是否该跑。
 *
 * 闸门顺序：模式允许 → 冷却 → 最小新日记数 → 固定时刻（若配置）。
 */
export function checkDue(config: AutoSchemaConfig, now = new Date()): DueCheck {
  const cursor = loadCursor(config.stateRoot)
  const undigested = countUndigested(cursor, listEventIds(resolveDiaryDirs(config)))
  if (!config.trigger.modes.includes('schedule')) {
    return {
      due: false,
      reason: 'trigger.modes 未启用 schedule',
      waitMs: Number.POSITIVE_INFINITY,
      undigested,
    }
  }

  if (undigested < config.trigger.minNewDiaries) {
    return {
      due: false,
      reason: `未消化日记不足（${undigested} < ${config.trigger.minNewDiaries}）`,
      waitMs: 0,
      undigested,
    }
  }

  const sinceLast = msSinceLastRun(cursor, now.getTime())
  const cooldown = Math.max(config.trigger.cooldownMs, config.trigger.schedule.intervalMinutes * 60_000)
  if (sinceLast < cooldown) {
    const waitMs = cooldown - sinceLast
    return {
      due: false,
      reason: `冷却中（还需 ${Math.ceil(waitMs / 60_000)} 分钟；间隔 ${Math.round(cooldown / 60_000)} 分钟）`,
      waitMs,
      undigested,
    }
  }

  const atTime = config.trigger.schedule.atTime
  if (atTime !== undefined) {
    const next = nextAtTime(now, atTime)
    if (next === undefined) {
      return { due: false, reason: `trigger.schedule.atTime 格式无效：${atTime}（应为 HH:MM）`, waitMs: 0, undigested }
    }
    // 固定时刻模式：当天该时点已过且还没跑过 → 跑；否则等到下一个时点
    const todayTarget = new Date(now)
    const [h, m] = atTime.split(':').map(Number) as [number, number]
    todayTarget.setHours(h, m, 0, 0)
    const lastRun = cursor.lastRunAt === undefined ? 0 : Date.parse(cursor.lastRunAt)
    const alreadyRanSinceTarget = !Number.isNaN(lastRun) && lastRun >= todayTarget.getTime()
    if (now.getTime() >= todayTarget.getTime() && !alreadyRanSinceTarget) {
      const overdueMs = now.getTime() - todayTarget.getTime()
      const skipAfter = config.trigger.schedule.skipIfOverdueMinutes * 60_000
      if (skipAfter > 0 && overdueMs > skipAfter) {
        return {
          due: false,
          reason: `已错过 ${atTime} 的窗口 ${Math.round(overdueMs / 60_000)} 分钟（skipIfOverdueMinutes=${config.trigger.schedule.skipIfOverdueMinutes}）`,
          waitMs: next - now.getTime(),
          undigested,
        }
      }
      return { due: true, reason: `到达每日固定时刻 ${atTime}`, waitMs: 0, undigested }
    }
    return {
      due: false,
      reason: alreadyRanSinceTarget ? `今日 ${atTime} 已跑过` : `等待每日固定时刻 ${atTime}`,
      waitMs: next - now.getTime(),
      undigested,
    }
  }

  return { due: true, reason: `满足间隔 ${config.trigger.schedule.intervalMinutes} 分钟且新日记 ${undigested} 篇`, waitMs: 0, undigested }
}

/**
 * hook 触发的闸门：只看 hook 自己的冷却与未消化数量。
 *
 * 与 schedule 闸门分开，是因为 hook 的时机由生命周期点决定（例如压缩开始时**必须**看一眼），
 * 不该被"每日一次"这类间隔拦住；它用的是 `trigger.hook.cooldownMs`。
 */
export function checkHookDue(config: AutoSchemaConfig, now = new Date()): DueCheck {
  if (!config.trigger.modes.includes('hook')) {
    return { due: false, reason: 'trigger.modes 未启用 hook', waitMs: Number.POSITIVE_INFINITY, undigested: 0 }
  }
  const events = config.trigger.hook.events
  const cursor = loadCursor(config.stateRoot)
  const undigested = countUndigested(cursor, listEventIds(resolveDiaryDirs(config)))
  if (events.length === 0) {
    return {
      due: false,
      reason: 'trigger.hook.events 为空（未选择挂点）',
      waitMs: Number.POSITIVE_INFINITY,
      undigested,
    }
  }
  if (undigested < config.trigger.minNewDiaries) {
    return {
      due: false,
      reason: `未消化日记不足（${undigested} < ${config.trigger.minNewDiaries}）`,
      waitMs: 0,
      undigested,
    }
  }
  const cooldown = Math.max(0, config.trigger.hook.cooldownMs)
  const sinceLast = msSinceLastRun(cursor, now.getTime())
  if (sinceLast < cooldown) {
    const waitMs = cooldown - sinceLast
    return {
      due: false,
      reason: `hook 冷却中（还需 ${Math.ceil(waitMs / 60_000)} 分钟；cooldownMs=${cooldown}）`,
      waitMs,
      undigested,
    }
  }
  return {
    due: true,
    reason: `hook 闸门通过（挂点 ${events.join('、')}，未消化 ${undigested} 篇）`,
    waitMs: 0,
    undigested,
  }
}

/** 记录一次"看过但没有可做"的跳过（用于冷却，避免 daemon 每秒重算）。 */
export function recordSkip(config: AutoSchemaConfig): void {
  const cursor = loadCursor(config.stateRoot)
  saveCursor(config.stateRoot, { ...cursor, lastRunAt: nowIso(), skippedRuns: (cursor.skippedRuns ?? 0) + 1 })
}

/** 建议的 cron 行（用户粘到自己机器的 crontab）。 */
export function cronLine(config: AutoSchemaConfig, cliPath = 'autoschema'): string {
  const minutes = config.trigger.schedule.intervalMinutes
  if (config.trigger.schedule.atTime !== undefined) {
    const [h, m] = config.trigger.schedule.atTime.split(':') as [string, string]
    return `${Number(m)} ${Number(h)} * * * ${cliPath} tick --state ${config.stateRoot} >> ${config.stateRoot}/logs/tick.log 2>&1`
  }
  const tail = `${cliPath} tick --state ${config.stateRoot} >> ${config.stateRoot}/logs/tick.log 2>&1`
  if (minutes >= 1_440) {
    // 每天一次：cron 的小时字段上限 23，不能用 */24
    const days = Math.max(1, Math.round(minutes / 1_440))
    return days === 1 ? `0 3 * * * ${tail}` : `0 3 */${days} * * ${tail}`
  }
  if (minutes % 60 === 0) {
    return `0 */${Math.max(1, minutes / 60)} * * * ${tail}`
  }
  return `*/${Math.max(1, minutes)} * * * * ${tail}`
}
