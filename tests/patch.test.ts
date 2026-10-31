import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import yaml from 'js-yaml'
import { describe, expect, it } from 'vitest'

import { Config } from '../src/plugin.js'

/**
 * 回归：随包发布的 `cordis.patch.yml` 必须是 dsh 能解析的那套 YAML 方言。
 *
 * dsh 用 js-yaml（JSON_SCHEMA + 一个 `tag:yaml.org,2002:js` 标量类型）读这一层：
 * `!!js <expr>` 会被构造成 `{ __jsExpr }` 节点，加载时在 `with (ctx)` 里 eval。
 * 裸标量里一旦出现 `? … : …`（三元）或 `: `，YAML 会把它当**映射**——
 * `events` 就变成 `{ '[object Object]': [...] }`，插件在 schemastery 校验时报
 * `$.events expected array but got [object Object]`，整个 dsh 启动失败。
 */

const here = path.dirname(fileURLToPath(import.meta.url))
const patchFile = path.resolve(here, '..', 'cordis.patch.yml')

const isJsExpr = (value: unknown): value is { __jsExpr: string } =>
  value instanceof Object && '__jsExpr' in value

/** 与 dsh 的 `vendor/include` 同构的标量类型。 */
const JsExpr = new yaml.Type('tag:yaml.org,2002:js', {
  kind: 'scalar',
  resolve: (data: string) => typeof data === 'string',
  construct: (data: string) => ({ __jsExpr: data }),
  predicate: isJsExpr,
  represent: (data: unknown) => (data as { __jsExpr: string }).__jsExpr,
})

const schema = yaml.JSON_SCHEMA.extend(JsExpr)

/**
 * 与 cordis-plugin-loader 的 `interpolate` 同构：递归求值 `!!js` 节点。
 * `with (ctx)` 只遮蔽 ctx 里有的名字，`JSON` / `Number` 等仍走全局——和 dsh 一致。
 */
function interpolate(value: unknown, scope: Record<string, unknown> = {}): unknown {
  if (isJsExpr(value)) {
    // eslint-disable-next-line no-new-func
    return new Function('ctx', 'expr', 'with (ctx) { return eval(expr) }')(scope, value.__jsExpr)
  }
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map((item) => interpolate(item, scope))
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, interpolate(item, scope)]),
  )
}

function autoschemaConfig(): { raw: unknown; entry: Record<string, unknown> } {
  const tree = yaml.load(fs.readFileSync(patchFile, 'utf8'), { schema }) as Array<Record<string, unknown>>
  const insert = tree.flatMap((layer) => (Array.isArray(layer.insert) ? layer.insert : [])) as Array<
    Record<string, unknown>
  >
  const entry = insert.find((item) => item.id === 'autoschema')
  expect(entry, 'cordis.patch.yml 里应当有一条 id: autoschema 的 insert 条目').toBeDefined()
  return { raw: (entry as Record<string, unknown>).config, entry: entry as Record<string, unknown> }
}

describe('cordis.patch.yml', () => {
  it('能被 dsh 的 YAML 方言解析：每个 !!js 都是标量节点，而不是被切碎的映射', () => {
    const { raw } = autoschemaConfig()
    expect(raw, 'config 必须是映射').toBeTypeOf('object')

    // 被误解析成映射时，键会退化成 "[object Object]"
    const keys = Object.keys(raw as Record<string, unknown>)
    expect(keys).not.toContain('[object Object]')
    expect(keys.sort()).toStrictEqual(
      ['agentsFile', 'cooldownMs', 'disabled', 'events', 'memoryRoot', 'stateRoot'].sort(),
    )

    // 五个 !!js 值都必须是完整的表达式节点
    for (const key of ['stateRoot', 'agentsFile', 'memoryRoot', 'events', 'cooldownMs']) {
      const value = (raw as Record<string, unknown>)[key]
      expect(isJsExpr(value), `${key} 应当被解析成 !!js 标量（裸三元会让 YAML 把它当成映射）`).toBe(true)
    }
  })

  it('表达式求值后通过插件的 Config 校验（环境变量缺省时）', () => {
    const { raw } = autoschemaConfig()
    const config = interpolate(raw, { process: { env: {} } }) as Record<string, unknown>
    expect(config.events).toStrictEqual(['compaction/start'])
    expect(config.cooldownMs).toBe(1_800_000)
    expect(config.disabled).toBe(false)
    expect(() => Config(config)).not.toThrow()
  })

  it('表达式求值后通过插件的 Config 校验（环境变量全开时）', () => {
    const { raw } = autoschemaConfig()
    const config = interpolate(raw, { process: { env: {} } }) as Record<string, unknown>
    const env = {
      DSH_AUTOSCHEMA_ROOT: '/tmp/autoschema-root',
      DSH_AUTOSCHEMA_AGENTS: '/tmp/AGENTS.md',
      DSH_AUTOBIO_ROOT: '/tmp/autobio',
      DSH_AUTOSCHEMA_HOOKS: '["compaction/start","session/start"]',
      DSH_AUTOSCHEMA_COOLDOWN: '60000',
    }
    const envConfig = interpolate(raw, { process: { env } }) as Record<string, unknown>
    expect(envConfig.events).toStrictEqual(['compaction/start', 'session/start'])
    expect(envConfig.cooldownMs).toBe(60_000)
    expect(() => Config(envConfig)).not.toThrow()
    // 对照：缺省流程不受影响
    expect(config.stateRoot).toBeUndefined()
  })
})
