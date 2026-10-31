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
  const stateRoot = path.resolve(options.stateRoot ?? base.stateRoot)
  const onDisk = readJsonFile<DeepPartial<AutoSchemaConfig>>(configFile(stateRoot))
  const merged = merge(merge(base, onDisk), options.patch)
  merged.stateRoot = stateRoot
  merged.diaryChars = Math.round(clamp(merged.diaryChars, 200, 20_000))
  merged.maxInputChars = Math.round(clamp(merged.maxInputChars, 2_000, 400_000))
  merged.diaryLimit = Math.round(clamp(merged.diaryLimit, 1, 500))
  merged.deepseek.temperature = clamp(merged.deepseek.temperature, 0, 2)
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
