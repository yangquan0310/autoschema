#!/usr/bin/env node
/** 从构建产物生成 docs/piaget-guide.md，保证与 src/prompt.ts 不漂移。 */
import fs from 'node:fs'

const { ANALYSIS_GUIDE, RESPONSE_CONTRACT } = await import('../dist/index.js')
const doc = `# 皮亚杰式自我图式分析指导语（人读版）

> 由 \`src/prompt.ts\` 的 \`ANALYSIS_GUIDE\` / \`RESPONSE_CONTRACT\` 生成。
> 重新生成：\`pnpm run build && node scripts/gen-guide.mjs\`。

## 它在流水线里的位置

\`\`\`
AGENTS.md（当前图式：风格/信念/价值观）
      + AutoBioMemory 最近 N 篇日记（经验）
      ↓ system = ANALYSIS_GUIDE + RESPONSE_CONTRACT
      ↓ user   = 图式现状 + 日记正文
DeepSeek → { equilibriumScore, disequilibrium[], assimilation[], accommodation[], notes }
      ↓ 校验：target 必须能在现有条目里定位，否则丢弃
AGENTS.md（新版本）+ ~/.autoschema/history/ 快照
\`\`\`

## 指导语原文

\`\`\`text
${ANALYSIS_GUIDE}
\`\`\`

## 响应契约原文

\`\`\`text
${RESPONSE_CONTRACT}
\`\`\`
`
fs.writeFileSync(new URL('../docs/piaget-guide.md', import.meta.url), doc)
console.log(`docs/piaget-guide.md written (${doc.length} chars)`)
