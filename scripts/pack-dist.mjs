#!/usr/bin/env node
/** 打包：dist/package（可安装目录）+ dist/*.tgz */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..')
const distDir = path.join(repo, 'dist')
const pkgDir = path.join(distDir, 'package')
const rootPkg = JSON.parse(fs.readFileSync(path.join(repo, 'package.json'), 'utf8'))

// Windows 上 pnpm 是 .cmd shim，Node 无法直接 execFileSync('pnpm', ...)（spawnSync pnpm ENOENT），
// 必须交给 cmd.exe 解析；Unix 下仍直接 exec pnpm。
function packWithPnpm() {
  const options = { cwd: pkgDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
  const args = ['pack', '--pack-destination', distDir]
  if (process.platform !== 'win32') return execFileSync('pnpm', args, options)
  const quoted = args.map((arg) => (arg.includes(' ') ? `"${arg}"` : arg)).join(' ')
  return execFileSync(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', `pnpm ${quoted}`], options)
}

if (!fs.existsSync(path.join(distDir, 'index.js'))) {
  console.error('dist/index.js 不存在，先跑 pnpm run build')
  process.exit(1)
}
// dist/ 会提交，dist/cli.js 是 bin 入口；CRLF 的 shebang 会让 Unix 安装失败。
for (const file of ['index.js', 'cli.js']) {
  const target = path.join(distDir, file)
  if (!fs.existsSync(target)) continue
  if (fs.readFileSync(target, 'utf8').includes('\r\n')) {
    console.error(`dist/${file} 含 CRLF 换行；先用 LF 重新检出再打包`)
    process.exit(1)
  }
}
fs.mkdirSync(pkgDir, { recursive: true })
const copy = (name) => {
  const src = path.join(distDir, name)
  if (!fs.existsSync(src)) return
  const dst = path.join(pkgDir, name)
  fs.mkdirSync(path.dirname(dst), { recursive: true })
  fs.cpSync(src, dst)
}
for (const entry of fs.readdirSync(distDir)) {
  if (/^(index|cli|plugin|chunk-[\w-]+)\.(js|d\.ts)$/u.test(entry)) copy(entry)
}
for (const entry of ['README.md', 'LICENSE', 'cordis.patch.yml']) {
  const src = path.join(repo, entry)
  if (fs.existsSync(src)) fs.cpSync(src, path.join(pkgDir, entry))
}
fs.writeFileSync(
  path.join(pkgDir, 'package.json'),
  `${JSON.stringify(
    {
      name: rootPkg.name,
      version: rootPkg.version,
      description: rootPkg.description,
      type: 'module',
      main: 'index.js',
      types: 'index.d.ts',
      exports: {
        '.': { types: './index.d.ts', default: './index.js' },
        './cli': { types: './cli.d.ts', default: './cli.js' },
        './plugin': { types: './plugin.d.ts', default: './plugin.js' },
      },
      dependencies: rootPkg.dependencies ?? {},
      peerDependencies: rootPkg.peerDependencies ?? {},
      bin: { autoschema: './cli.js' },
      files: [
        'index.js',
        'index.d.ts',
        'cli.js',
        'cli.d.ts',
        'plugin.js',
        'plugin.d.ts',
        'chunk-*.js',
        'cordis.patch.yml',
        'README.md',
        'LICENSE',
      ],
      // 没有这一段，dsh plugin add 只会当普通依赖装，注册不成 bundle 层（hook 挂不上）
      dsh: { bundle: { patch: './cordis.patch.yml' } },
      license: rootPkg.license,
      engines: rootPkg.engines,
    },
    null,
    2,
  )}\n`,
)
const out = packWithPnpm()
const last = out.trim().split('\n').pop() ?? ''
const tarball = path.isAbsolute(last) ? last : path.join(distDir, last)
console.log(`dist/package ready: ${pkgDir}`)
console.log(`tarball: ${tarball}`)
