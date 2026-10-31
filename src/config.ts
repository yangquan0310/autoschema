/** AutoSchema — 配置：默认值、加载、校验。 */

import path from 'node:path'

import { DEFAULT_AGENTS_FILE, DEFAULT_MEMORY_ROOT, DEFAULT_STATE_ROOT } from './constants.js'
import { clamp, readJsonFile, resolveDeepseekKey, writeJsonFile, ensureDir } from './util.js'
import type { AutoSchemaConfig } from './types.js'

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K]
}

export function defaultConfig(): AutoSchemaConfig {
  return {
    version: 1,
    agentsFile: DEFAULT_AGENTS_FILE,
    memoryRoot: DEFAULT_MEMORY_ROOT,
    diaryLimit: 30,
    diaryChars: 1800,
    maxInputChars: 60_000,
    stateRoot: DEFAULT_STATE_ROOT,
    trigger: {
      modes: ['manual'],
      cooldownMs: 3_600_000,
      minNewDiaries: 5,
      applyMode: 'propose',
      maxRemovals: 2,
      maxAdditions: 4,
      schedule: { intervalMinutes: 1_440, skipIfOverdueMinutes: 720 },
      hook: { events: ['compaction/start'], cooldownMs: 1_800_000 },
    },
    digest: {
      limit: 30,
      onlyUndigested: true,
      diaryChars: 1800,
      maxInputChars: 60_000,
    },
    deepseek: {
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      temperature: 0.3,
      maxTokens: 8000,
      timeoutMs: 240_000,
      jsonMode: true,
      retries: 3,
    },
  }
}

function merge<T>(base: T, patch?: DeepPartial<T>): T {
  if (!patch) return structuredClone(base)
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) }
  for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
    if (value === undefined) continue
    const current = out[key]
    if (
      value !== null &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      current !== null &&
      typeof current === 'object' &&
      !Array.isArray(current)
    ) {
      out[key] = merge(current, value as DeepPartial<typeof current>)
    } else {
      out[key] = value
    }
  }
  return out as T
}

/** 配置文件：`<stateRoot>/config.json`（可选）。 */
export function configFile(stateRoot: string): string {
  return path.join(stateRoot, 'config.json')
}

export function loadConfig(options: { stateRoot?: string; patch?: DeepPartial<AutoSchemaConfig> } = {}): AutoSchemaConfig {
  const base = defaultConfig()
  const patchRoot = options.patch?.stateRoot
  const stateRoot = path.resolve(
    options.stateRoot ?? (typeof patchRoot === 'string' && patchRoot !== '' ? patchRoot : base.stateRoot),
  )
  const onDisk = readJsonFile<DeepPartial<AutoSchemaConfig>>(configFile(stateRoot))
  const merged = merge(merge(base, onDisk), options.patch)
  merged.stateRoot = stateRoot
  merged.diaryChars = Math.round(clamp(merged.diaryChars, 200, 20_000))
  merged.maxInputChars = Math.round(clamp(merged.maxInputChars, 2_000, 400_000))
  merged.diaryLimit = Math.round(clamp(merged.diaryLimit, 1, 500))
  merged.deepseek.temperature = clamp(merged.deepseek.temperature, 0, 2)
  // 兼容：旧字段 diaryLimit/diaryChars/maxInputChars 与 digest.* 双向对齐（digest 为准）
  if (onDisk?.digest !== undefined) {
    merged.diaryLimit = merged.digest.limit
    merged.diaryChars = merged.digest.diaryChars
    merged.maxInputChars = merged.digest.maxInputChars
  } else {
    merged.digest.limit = merged.diaryLimit
    merged.digest.diaryChars = merged.diaryChars
    merged.digest.maxInputChars = merged.maxInputChars
  }
  merged.digest.limit = Math.round(clamp(merged.digest.limit, 1, 500))
  merged.digest.diaryChars = Math.round(clamp(merged.digest.diaryChars, 200, 20_000))
  merged.digest.maxInputChars = Math.round(clamp(merged.digest.maxInputChars, 2_000, 400_000))
  if (!Array.isArray(merged.trigger.modes) || merged.trigger.modes.length === 0) merged.trigger.modes = ['manual']
  merged.trigger.cooldownMs = Math.max(0, merged.trigger.cooldownMs)
  merged.trigger.hook.cooldownMs = Math.max(0, merged.trigger.hook.cooldownMs)
  merged.trigger.minNewDiaries = Math.max(1, Math.round(merged.trigger.minNewDiaries))
  merged.trigger.maxRemovals = Math.max(0, Math.round(merged.trigger.maxRemovals ?? 2))
  merged.trigger.maxAdditions = Math.max(1, Math.round(merged.trigger.maxAdditions ?? 4))
  merged.trigger.schedule.intervalMinutes = Math.max(1, Math.round(merged.trigger.schedule.intervalMinutes))
  merged.agentsFile = path.resolve(merged.agentsFile)
  merged.memoryRoot = path.resolve(merged.memoryRoot)
  return merged
}

export function ensureConfigFile(config: AutoSchemaConfig): string {
  const file = configFile(config.stateRoot)
  ensureDir(config.stateRoot)
  if (readJsonFile(file) === undefined) {
    const { deepseek: _deepseek, ...persisted } = config
    writeJsonFile(file, persisted)
  }
  return file
}

export function validateConfig(config: AutoSchemaConfig): string[] {
  const problems: string[] = []
  if (!Number.isFinite(config.diaryLimit) || config.diaryLimit < 1) problems.push('diaryLimit 必须 ≥ 1')
  if (!/^https?:\/\//u.test(config.deepseek.baseUrl)) problems.push('deepseek.baseUrl 必须是 http(s)')
  if (!config.deepseek.model) problems.push('deepseek.model 不能为空')
  const allowedModes = ['manual', 'schedule', 'hook']
  if (!config.trigger.modes.every((mode) => allowedModes.includes(mode))) {
    problems.push('trigger.modes 只能是 manual / schedule / hook')
  }
  if (config.trigger.modes.includes('schedule') && config.trigger.schedule.intervalMinutes < 1) {
    problems.push('trigger.schedule.intervalMinutes 必须 ≥ 1')
  }
  const allowedHooks = ['compaction/start', 'agent/pre-step', 'agent/idle', 'session/start']
  if (!config.trigger.hook.events.every((event) => allowedHooks.includes(event))) {
    problems.push('trigger.hook.events 只能取 compaction/start、agent/pre-step、agent/idle、session/start')
  }
  if (config.trigger.modes.includes('hook') && config.trigger.hook.events.length === 0) {
    problems.push('hook 模式下 trigger.hook.events 不能为空（要挂"特定的"生命周期点）')
  }
  if (config.trigger.applyMode !== 'propose' && config.trigger.applyMode !== 'apply') {
    problems.push("trigger.applyMode 只能是 propose 或 apply")
  }
  if (typeof config.trigger.maxRemovals === 'number' && config.trigger.maxRemovals < 0) {
    problems.push('trigger.maxRemovals 不能为负')
  }
  return problems
}

/** DeepSeek 密钥：状态根 .env → ~/.dsh/.env → memory 根 .env。 */
export function resolveApiKey(config: AutoSchemaConfig): string | undefined {
  return resolveDeepseekKey([
    path.join(config.stateRoot, '.env'),
    path.join(process.env.HOME ?? '', '.dsh', '.env'),
    path.join(config.memoryRoot, '.env'),
  ])
}
