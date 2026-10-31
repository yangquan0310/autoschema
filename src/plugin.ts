/**
 * AutoSchema — dsh 插件（hook 触发）。
 *
 * 只挂"特定的"生命周期点，由 `trigger.hook.events` 显式指定，默认仅 `compaction/start`：
 *   - `compaction/start`：上下文压缩开始时（这个时刻 agent 刚结束一段完整经历，最适合回看自己）
 *   - `agent/pre-step`（prepend）：每次模型请求前，代价高，仅在显式启用时注册
 *   - `agent/idle`：回合结束空闲时
 *   - `session/start`：新会话出现时
 *
 * 每次触发都先过闸门（冷却 + 未消化数量），再按 `trigger.applyMode` 决定只出建议还是直接写回。
 * 任何异常都被吞掉并记日志——生命周期钩子绝不能把错误抛进 agent loop。
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

// 这些 type-only 导入只为把 dsh 的 Events / Context 声明合并带进来（运行时零引入）。
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'

import { loadConfig, ensureConfigFile } from './config.js'
import { tick } from './tick.js'
import { createLogger } from './util.js'
import type { HookEvent } from './types.js'

export const name = 'autoschema'

/** 只依赖这两个服务；缺了就不加载。 */
export const inject = ['tools', 'systemPrompt']

export interface PluginConfig {
  /** 状态根（含 config.json 与 cursor）；默认 ~/.autoschema。 */
  stateRoot?: string
  /** AGENTS.md 路径；默认 ~/.dsh/AGENTS.md。 */
  agentsFile?: string
  /** AutoBioMemory 数据根；默认 ~/.autobiomemory。 */
  memoryRoot?: string
  /** 覆盖 config.trigger.hook.events（取值：compaction/start、agent/pre-step、agent/idle、session/start）。 */
  events?: string[]
  /** 覆盖 config.trigger.hook.cooldownMs。 */
  cooldownMs?: number
  /** 关闭插件（只留 CLI）。 */
  disabled?: boolean
}

export const Config: z<PluginConfig> = z.object({
  stateRoot: z.string(),
  agentsFile: z.string(),
  memoryRoot: z.string(),
  events: z.array(z.string()),
  cooldownMs: z.natural(),
  disabled: z.boolean().default(false),
})

function bridgeLogger(ctx: Context) {
  const base = ctx.logger(name) as unknown as Record<string, (...args: unknown[]) => void>
  const emit = (level: string, message: string): void => {
    try {
      base[level]?.(`[${name}] ${message}`)
    } catch {
      /* 日志失败不能影响 agent loop */
    }
  }
  return {
    debug: (m: string) => emit('debug', m),
    info: (m: string) => emit('info', m),
    warn: (m: string) => emit('warn', m),
    error: (m: string) => emit('error', m),
  }
}

export function apply(ctx: Context, pluginConfig: PluginConfig = {}): void {
  if (pluginConfig.disabled === true) return

  const config = loadConfig({
    ...(pluginConfig.stateRoot === undefined ? {} : { stateRoot: pluginConfig.stateRoot }),
    patch: {
      ...(pluginConfig.agentsFile === undefined ? {} : { agentsFile: pluginConfig.agentsFile }),
      ...(pluginConfig.memoryRoot === undefined ? {} : { memoryRoot: pluginConfig.memoryRoot }),
      ...(pluginConfig.events === undefined
        ? {}
        : { trigger: { hook: { events: pluginConfig.events as HookEvent[] } } as never }),
      ...(pluginConfig.cooldownMs === undefined
        ? {}
        : { trigger: { hook: { cooldownMs: pluginConfig.cooldownMs } } as never }),
      trigger: { modes: ['hook'] } as never,
    },
  })

  ensureConfigFile(config)
  const logger = createLogger({ level: 'warn' })
  const cLogger = bridgeLogger(ctx)
  const events = config.trigger.hook.events as string[]

  const fire = (label: string): void => {
    void (async () => {
      try {
        const result = await tick({ config, origin: 'hook', logger })
        if (result.ran) {
          cLogger.info(`${label} → ${result.mode}：${result.message}`)
        } else {
          cLogger.debug(`${label} 跳过：${result.message}`)
        }
      } catch (error) {
        cLogger.warn(`${label} 失败：${error instanceof Error ? error.message : String(error)}`)
      }
    })()
  }

  if (events.includes('compaction/start')) {
    ctx.on('session/event', ((_session: unknown, event: { type?: string }) => {
      if ((event?.type as string | undefined) === 'compaction/start') fire('compaction/start')
    }) as never)
  }

  if (events.includes('agent/pre-step')) {
    ctx.on(
      'agent/pre-step',
      (async (_payload: unknown, next: () => Promise<unknown>) => {
        fire('agent/pre-step')
        return next()
      }) as never,
      { prepend: true },
    )
  }

  if (events.includes('agent/idle')) {
    ctx.on('agent/status', ((payload: { status?: string }) => {
      if (payload.status === 'idle') fire('agent/idle')
    }) as never)
  }

  if (events.includes('session/start')) {
    ctx.on('agent/created', (() => fire('session/start')) as never)
  }

  cLogger.info(`AutoSchema hook 已启用：${events.join(', ')}（applyMode=${config.trigger.applyMode}）`)
}

export default { name, inject, Config, apply }
