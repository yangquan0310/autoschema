#!/usr/bin/env node
/**
 * AutoSchema — 命令行。
 *
 *   autoschema analyze   读图式 + 日记，出非平衡/同化/顺应建议（默认不写回）
 *   autoschema apply     同上，并写回 AGENTS.md（先快照）
 *   autoschema history   查看历次快照
 *   autoschema show      打印当前解析出的图式
 *   autoschema init      建状态目录与默认 config.json
 *   autoschema doctor    环境自检（密钥 / 日记 / 图式 / 连通性）
 */

import path from 'node:path'

import { loadConfig, ensureConfigFile, validateConfig, resolveApiKey, configFile } from './config.js'
import { listEventIds } from './diaries.js'
import { DeepseekClient } from './deepseek.js'
import { listHistory, readSchema, renderReport, run } from './reconcile.js'
import { renderSchemaDoc } from './agents-md.js'
import { createLogger, ensureDir, maskSecret } from './util.js'
import { SECTION_LABELS } from './types.js'
import type { ChatClient, Section } from './types.js'

interface Args {
  command: string
  flags: Map<string, string | true>
}

function parseArgs(argv: string[]): Args {
  const flags = new Map<string, string | true>()
  const positional: string[] = []
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i] as string
    if (token.startsWith('--')) {
      const [key, inline] = token.slice(2).split('=')
      if (inline !== undefined) flags.set(key ?? '', inline)
      else {
        const next = argv[i + 1]
        if (next !== undefined && !next.startsWith('--')) {
          flags.set(key ?? '', next)
          i += 1
        } else flags.set(key ?? '', true)
      }
    } else positional.push(token)
  }
  return { command: positional.shift() ?? 'help', flags }
}

const str = (args: Args, key: string): string | undefined => {
  const value = args.flags.get(key)
  return typeof value === 'string' ? value : undefined
}
const num = (args: Args, key: string): number | undefined => {
  const raw = str(args, key)
  if (raw === undefined) return undefined
  const value = Number(raw)
  return Number.isFinite(value) ? value : undefined
}
const bool = (args: Args, key: string): boolean => args.flags.has(key)

function help(): void {
  process.stdout.write(`AutoSchema 0.1.0 — 让自我图式随日记演化（皮亚杰：非平衡 → 同化/顺应 → 平衡）

用法：autoschema <command> [options]

命令：
  analyze      分析并打印建议（不写回）；--limit N --since ISO --json
  apply        分析并写回 AGENTS.md（先快照到状态根 history/）
  show         打印当前图式（风格/信念/价值观）
  history      列出历次快照
  init         创建状态目录与默认 config.json
  doctor       自检：密钥、日记、图式、DeepSeek 连通性

通用：
  --agents <file>   AGENTS.md 路径（默认 ~/.dsh/AGENTS.md）
  --memory <dir>    AutoBioMemory 数据根（默认 ~/.autobiomemory）
  --state <dir>     本工具状态根（默认 ~/.autoschema）
  --verbose         调试日志
`)
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2))
  const logger = createLogger({ level: bool(args, 'verbose') ? 'debug' : 'warn' })

  if (args.command === 'help' || args.command === '--help' || args.command === '-h') {
    help()
    return 0
  }
  if (args.command === '--version' || args.command === 'version') {
    process.stdout.write('AutoSchema 0.1.0\n')
    return 0
  }

  const config = loadConfig({
    ...(str(args, 'state') === undefined ? {} : { stateRoot: str(args, 'state') }),
    patch: {
      ...(str(args, 'agents') === undefined ? {} : { agentsFile: path.resolve(str(args, 'agents') as string) }),
      ...(str(args, 'memory') === undefined ? {} : { memoryRoot: path.resolve(str(args, 'memory') as string) }),
    },
  })

  switch (args.command) {
    case 'init': {
      ensureDir(config.stateRoot)
      const file = ensureConfigFile(config)
      process.stdout.write(
        [
          `状态目录：${config.stateRoot}`,
          `配置文件：${file}`,
          `AGENTS.md：${config.agentsFile}`,
          `日记目录：${path.join(config.memoryRoot, 'events')}`,
          `DeepSeek key：${maskSecret(resolveApiKey(config))}`,
          '',
          '下一步：autoschema doctor，然后 autoschema analyze',
        ].join('\n') + '\n',
      )
      return 0
    }

    case 'show': {
      const doc = readSchema(config)
      process.stdout.write(`${renderSchemaDoc(doc)}\n`)
      const sections: Section[] = ['style', 'belief', 'value']
      process.stdout.write(
        sections.map((s) => `${SECTION_LABELS[s]}：${doc[s].length} 条`).join(' · ') + '\n',
      )
      return 0
    }

    case 'history': {
      const entries = listHistory(config)
      if (entries.length === 0) {
        process.stdout.write('还没有快照（apply 时才会生成）。\n')
        return 0
      }
      for (const entry of entries) process.stdout.write(`${entry.at}  ${entry.file}  ${entry.chars} 字符\n`)
      return 0
    }

    case 'analyze':
    case 'apply': {
      const problems = validateConfig(config)
      if (problems.length > 0) {
        process.stderr.write(`配置有问题：\n${problems.map((p) => `  - ${p}`).join('\n')}\n`)
        return 2
      }
      const result = await run({
        config,
        logger,
        dryRun: args.command !== 'apply',
        ...(num(args, 'limit') === undefined ? {} : { limit: num(args, 'limit') as number }),
        ...(str(args, 'since') === undefined ? {} : { since: str(args, 'since') as string }),
      })
      if (bool(args, 'json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      else process.stdout.write(`${renderReport(result)}\n`)
      return 0
    }

    case 'doctor': {
      const checks: Array<{ name: string; ok: boolean; detail: string }> = []
      const push = (name: string, ok: boolean, detail: string): void => {
        checks.push({ name, ok, detail })
      }
      const key = resolveApiKey(config)
      push('状态目录', true, config.stateRoot)
      push('配置文件', true, configFile(config.stateRoot))
      push('DeepSeek key', key !== undefined, maskSecret(key))
      const diaries = listEventIds(config.memoryRoot).length
      push('日记数量', diaries > 0, `${diaries} 篇（${path.join(config.memoryRoot, 'events')}）`)
      const doc = readSchema(config)
      push('AGENTS.md', true, `${config.agentsFile}（风格 ${doc.style.length} / 信念 ${doc.belief.length} / 价值观 ${doc.value.length}）`)
      push('配置校验', validateConfig(config).length === 0, validateConfig(config).join('；') || '通过')
      if (key !== undefined) {
        try {
          const client: ChatClient = new DeepseekClient(config.deepseek, key, logger)
          await client.chat([
            { role: 'system', content: '只回答 JSON。' },
            { role: 'user', content: '{"ping":true} 原样返回。' },
          ])
          push('DeepSeek 连通性', true, 'HTTP OK')
        } catch (error) {
          push('DeepSeek 连通性', false, error instanceof Error ? error.message : String(error))
        }
      }
      if (bool(args, 'json')) {
        process.stdout.write(`${JSON.stringify({ checks }, null, 2)}\n`)
      } else {
        process.stdout.write(
          [
            `AutoSchema doctor — ${config.stateRoot}`,
            ...checks.map((check) => `  ${check.ok ? '✓' : '✗'} ${check.name}：${check.detail}`),
            '',
            checks.every((check) => check.ok) ? '全部通过。' : '存在问题，见上。',
          ].join('\n') + '\n',
        )
      }
      return checks.every((check) => check.ok) ? 0 : 1
    }

    default:
      process.stderr.write(`未知命令：${args.command}\n\n`)
      help()
      return 2
  }
}

main()
  .then((code) => {
    process.exitCode = code
  })
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`)
    process.exitCode = 1
  })
