/** AutoSchema — 小工具：原子写、时间、截断、密钥读取。 */

import fs from 'node:fs'
import path from 'node:path'

export function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

export function readTextFile(file: string): string | undefined {
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return undefined
  }
}

/** 原子写：同目录临时文件 + rename。 */
export function writeTextAtomic(file: string, text: string): void {
  ensureDir(path.dirname(file))
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`)
  fs.writeFileSync(tmp, text, 'utf8')
  fs.renameSync(tmp, file)
}

export function readJsonFile<T>(file: string): T | undefined {
  const text = readTextFile(file)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text) as T
  } catch {
    return undefined
  }
}

export function writeJsonFile(file: string, value: unknown): void {
  writeTextAtomic(file, `${JSON.stringify(value, null, 2)}\n`)
}

export function nowIso(): string {
  return new Date().toISOString()
}

export function timestampForFile(date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`
}

export function truncate(text: string, max: number): string {
  if (max <= 0) return ''
  if (text.length <= max) return text
  return `${text.slice(0, Math.max(0, max - 1))}…`
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min
  return Math.min(max, Math.max(min, value))
}

/** 解析 dotenv，仅用于取 DEEPSEEK_API_KEY。 */
export function parseDotEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq <= 0) continue
    const key = line.slice(0, eq).trim().replace(/^export\s+/u, '')
    let value = line.slice(eq + 1).trim()
    if (/^['"].*['"]$/u.test(value)) value = value.slice(1, -1)
    out[key] = value
  }
  return out
}

/** 密钥来源优先级：进程环境 → 状态根 .env → ~/.dsh/.env → memory 根 .env。 */
export function resolveDeepseekKey(candidates: string[]): string | undefined {
  const envValue = process.env.DEEPSEEK_API_KEY
  if (envValue && envValue.trim() !== '') return envValue.trim()
  for (const file of candidates) {
    const text = readTextFile(file)
    if (text === undefined) continue
    const value = parseDotEnv(text).DEEPSEEK_API_KEY
    if (value && value.trim() !== '') return value.trim()
  }
  if (process.env.AUTOBIO_DEEPSEEK_API_KEY) return process.env.AUTOBIO_DEEPSEEK_API_KEY.trim()
  return undefined
}

export function maskSecret(value: string | undefined): string {
  if (!value) return '(missing)'
  return value.length <= 8 ? `${value.slice(0, 2)}***` : `${value.slice(0, 4)}…${value.slice(-4)}`
}

export interface LogLevel {
  level?: 'debug' | 'info' | 'warn' | 'error'
}

const ORDER = { debug: 10, info: 20, warn: 30, error: 40 } as const

export function createLogger(options: LogLevel = {}) {
  const threshold = ORDER[options.level ?? 'info']
  const emit = (level: keyof typeof ORDER, message: string, args: unknown[]): void => {
    if (ORDER[level] < threshold) return
    const suffix = args.length > 0 ? ` ${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}` : ''
    process.stderr.write(`${nowIso()} ${level.toUpperCase().padEnd(5)} [autoschema] ${message}${suffix}\n`)
  }
  return {
    debug: (m: string, ...a: unknown[]) => emit('debug', m, a),
    info: (m: string, ...a: unknown[]) => emit('info', m, a),
    warn: (m: string, ...a: unknown[]) => emit('warn', m, a),
    error: (m: string, ...a: unknown[]) => emit('error', m, a),
  }
}

export function silentLogger() {
  const noop = (): void => {}
  return { debug: noop, info: noop, warn: noop, error: noop }
}
