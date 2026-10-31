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

import fs from 'node:fs'
import path from 'node:path'

import { loadConfig, ensureConfigFile, validateConfig, resolveApiKey, configFile } from './config.js'
import { DeepseekError } from './deepseek.js'
import { listEventIds, resolveDiaryDirs } from './diaries.js'
import { DeepseekClient } from './deepseek.js'
import {
  applyPending,
  applySelected,
  clearPending,
  listHistory,
  loadPending,
  propose,
  readSchema,
  renderReport,
  run,
} from './reconcile.js'
import { checkDue, cronLine } from './schedule.js'
import { loadCursor, pendingEventIds, resetCursor } from './cursor.js'
import { tick } from './tick.js'
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
  process.stdout.write(`AutoSchema 0.3.3 — 让自我图式随日记演化（皮亚杰：非平衡 → 同化/顺应 → 平衡）

用法：autoschema <command> [options]

命令：
  propose      产出建议（默认只读，不改 AGENTS.md）；--limit N --since ISO --all --json
  apply        采纳建议写回 AGENTS.md（需先 propose）：--ids s1,s3 精确采纳；缺省全采纳
  tick         供 cron/timer 调用：按闸门判断该不该跑，该跑才跑
  daemon       内置循环：每 N 秒检查一次闸门（默认 60s）
  cron         打印建议的 crontab 行
  due          只检查"现在该不该跑"，不执行
  pending      查看待落盘建议的摘要
  reset-cursor 清空消化游标（让所有日记重新参与分析）
  show         打印当前图式（风格/信念/价值观）
  history      列出历次快照
  init         创建状态目录与默认 config.json
  doctor       自检：密钥、日记、图式、DeepSeek 连通性

通用：
  --agents <file>   AGENTS.md 路径（默认 ~/.dsh/AGENTS.md）
  --memory <dir>    AutoBioMemory 数据根（默认 ~/.autobiomemory）
  --diaries <dirs>  日记目录，逗号分隔（覆盖 config.diaries.dirs）
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
    process.stdout.write('AutoSchema 0.3.3\n')
    return 0
  }

  const config = loadConfig({
    ...(str(args, 'state') === undefined ? {} : { stateRoot: str(args, 'state') }),
    patch: {
      ...(str(args, 'agents') === undefined ? {} : { agentsFile: path.resolve(str(args, 'agents') as string) }),
      ...(str(args, 'memory') === undefined ? {} : { memoryRoot: path.resolve(str(args, 'memory') as string) }),
      ...(str(args, 'diaries') === undefined
        ? {}
        : {
            diaries: {
              dirs: (str(args, 'diaries') as string)
                .split(',')
                .map((entry) => entry.trim())
                .filter((entry) => entry !== ''),
            } as never,
          }),
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
    case 'propose': {
      const problems = validateConfig(config)
      if (problems.length > 0) {
        process.stderr.write(`配置有问题：\n${problems.map((p) => `  - ${p}`).join('\n')}\n`)
        return 2
      }
      const result = await propose({
        config,
        logger,
        onlyUndigested: bool(args, 'all') ? false : undefined,
        ...(num(args, 'limit') === undefined ? {} : { limit: num(args, 'limit') as number }),
        ...(str(args, 'since') === undefined ? {} : { since: str(args, 'since') as string }),
      })
      if (bool(args, 'json')) process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
      else process.stdout.write(`${renderReport(result)}\n`)
      return 0
    }

    case 'apply': {
      // 只做"采纳"，不做分析；分析请先运行 propose。
      const ids = str(args, 'ids')
        ?.split(',')
        .map((s) => s.trim())
        .filter((s) => s !== '')
      const pending = loadPending(config)
      if (pending === undefined) {
        process.stderr.write('没有待审建议。先运行 `autoschema propose`。\n')
        return 2
      }
      const suggestions = pending.analysis.suggestions
      if (ids !== undefined) {
        const unknown = ids.filter((id) => !suggestions.some((s) => s.id === id))
        if (unknown.length > 0) {
          process.stderr.write(`未知建议 id：${unknown.join(', ')}（可选：${suggestions.map((s) => s.id).join(', ')}）\n`)
          return 2
        }
      }
      const result = applySelected(config, suggestions, ids === undefined ? {} : { ids })
      process.stdout.write(
        [
          `采纳：增 ${result.applied.add} · 删 ${result.applied.remove} · 改 ${result.applied.modify} · 重排 ${result.applied.reorder}`,
          ...result.rejected.map((reason: string) => `  拒绝：${reason}`),
          result.changed ? `已写回：${config.agentsFile}` : '无实际变更（未写文件）',
          result.snapshot === undefined ? '' : `快照：${result.snapshot}`,
        ]
          .filter((line) => line !== '')
          .join('\n') + '\n',
      )
      if (result.changed && bool(args, 'clear')) clearPending(config)
      return 0
    }

    case 'due': {
      const due = checkDue(config)
      process.stdout.write(
        `${due.due ? '该跑' : '不该跑'}：${due.reason}｜未消化 ${due.undigested} 篇` +
          (due.waitMs > 0 && due.waitMs !== Number.POSITIVE_INFINITY
            ? `｜还需 ${Math.ceil(due.waitMs / 60_000)} 分钟`
            : '') +
          '\n',
      )
      return 0
    }

    case 'tick': {
      const outcome = await tick({ config, origin: 'schedule', logger })
      process.stdout.write(`${outcome.ran ? '已运行' : '已跳过'}：${outcome.message}\n`)
      return 0
    }

    case 'daemon': {
      const intervalSec = Math.max(5, num(args, 'interval') ?? 60)
      process.stdout.write(`AutoSchema daemon 启动：每 ${intervalSec}s 检查一次闸门（Ctrl-C 退出）\n`)
      let stopping = false
      process.on('SIGINT', () => {
        stopping = true
        process.stdout.write('\n收到 SIGINT，退出。\n')
      })
      while (!stopping) {
        const due = checkDue(config)
        if (due.due) {
          try {
            const outcome = await tick({ config, origin: 'schedule', logger })
            process.stdout.write(`${new Date().toISOString()} 运行：${outcome.mode} ${outcome.message}\n`)
          } catch (error) {
            process.stderr.write(`${new Date().toISOString()} 运行失败：${error instanceof Error ? error.message : String(error)}\n`)
          }
        } else {
          process.stdout.write(`${new Date().toISOString()} 跳过：${due.reason}\n`)
        }
        await new Promise((resolve) => setTimeout(resolve, intervalSec * 1000))
      }
      return 0
    }

    case 'cron': {
      process.stdout.write(
        [
          '# 把下面一行加到 crontab -e（tick 自带闸门，重复调用安全）：',
          cronLine(config),
          '',
          '# 或者用 systemd timer 调 tick；也可以 `autoschema daemon --interval 300` 常驻。',
        ].join('\n') + '\n',
      )
      return 0
    }

    case 'pending': {
      const pending = loadPending(config)
      if (pending === undefined) {
        process.stdout.write('没有待落盘建议。\n')
        return 0
      }
      process.stdout.write(
        [
          `待落盘建议：${pending.at}（批次 ${pending.runId}）`,
          `  非平衡 ${pending.analysis.observations.length} · 建议 ${pending.analysis.suggestions.length}（增/删/改/重排：${pending.analysis.suggestions.map((s) => s.op).join(',') || '无'}）`,
          `  涉及日记 ${pending.eventIds.length} 篇`,
          `  逐条采纳：autoschema apply --ids <id,...>`,
          `  全部采纳：autoschema apply --clear`,
          `  丢弃建议：autoschema pending --discard`,
        ].join('\n') + '\n',
      )
      if (bool(args, 'discard')) {
        clearPending(config)
        process.stdout.write('已丢弃待落盘建议。\n')
      }
      return 0
    }

    case 'reset-cursor': {
      resetCursor(config.stateRoot)
      clearPending(config)
      process.stdout.write(`已清空消化游标与待落盘建议（${config.stateRoot}/state/）。\n`)
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
      const dirsUsed = resolveDiaryDirs(config)
      const diaries = listEventIds(dirsUsed).length
      push(
        '日记目录',
        dirsUsed.length > 0 && dirsUsed.every((dir) => fs.existsSync(dir)),
        dirsUsed.join('、') || '(未配置)',
      )
      push('日记数量', diaries > 0, `${diaries} 篇`)
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
