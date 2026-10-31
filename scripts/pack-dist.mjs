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

if (!fs.existsSync(path.join(distDir, 'index.js'))) {
  console.error('dist/index.js 不存在，先跑 pnpm run build')
  process.exit(1)
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
const out = execFileSync('pnpm', ['pack', '--pack-destination', distDir], { cwd: pkgDir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
const last = out.trim().split('\n').pop() ?? ''
const tarball = path.isAbsolute(last) ? last : path.join(distDir, last)
console.log(`dist/package ready: ${pkgDir}`)
console.log(`tarball: ${tarball}`)
