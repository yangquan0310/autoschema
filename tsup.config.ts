import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts', cli: 'src/cli.ts', plugin: 'src/plugin.ts' },
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: 'dist',
  splitting: false,
  // 由 dsh 运行时提供，不打进产物
  external: ['@deepseek-ai/cordis', '@deepseek-ai/schemastery'],
})
