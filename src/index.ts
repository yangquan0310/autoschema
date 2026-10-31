/**
 * AutoSchema — 包入口。
 *
 * 注意：`cordis.patch.yml` 用 `name: autoschema` 指向**包的 main**，所以这里必须
 * 把插件面（`name` / `inject` / `Config` / `apply` / default）重新导出，
 * 否则 dsh 加载时会报 `invalid plugin, expect function or object with an "apply" method`。
 */

export * from './types.js'
export { VERSION } from './constants.js'

export {
  defaultConfig,
  ensureConfigFile,
  loadConfig,
  resolveApiKey,
  validateConfig,
  configFile,
} from './config.js'

export {
  applySuggestions,
  findClosestIndex,
  itemCount,
  parseSchemaDoc,
  readSchemaDoc,
  renderSchemaDoc,
  writeSchemaDoc,
} from './agents-md.js'

export { collectDiaries, eventsDir, listEventIds, readDiary, renderDiaries } from './diaries.js'

export {
  ANALYSIS_GUIDE,
  AnalysisError,
  RESPONSE_CONTRACT,
  buildAnalysisRequest,
  extractJsonObject,
  normalizeAnalysis,
  parseAnalysisResponse,
  renderSchema,
} from './prompt.js'

export { DeepseekClient, DeepseekError } from './deepseek.js'

export { gatherDiaries, listHistory, readSchema, renderReport, run, snapshotSchema } from './reconcile.js'
export type { RunOptions, RunResult } from './reconcile.js'

export {
  applyPending,
  applySelected,
  clearPending,
  loadPending,
  pendingFile,
  propose,
} from './reconcile.js'
export type { ApplySelectionOptions } from './reconcile.js'

export {
  checkDue,
  checkHookDue,
  cronLine,
  nextAtTime,
  recordSkip,
} from './schedule.js'
export type { DueCheck } from './schedule.js'

export {
  clearProposed,
  countUndigested,
  cursorFile,
  emptyCursor,
  filterUndigested,
  isDigested,
  isPending,
  isSettled,
  loadCursor,
  markDigested,
  markProposed,
  markRun,
  msSinceLastRun,
  pendingEventIds,
  resetCursor,
  saveCursor,
} from './cursor.js'

export { tick, touchRun } from './tick.js'
export type { TickOptions, TickResult } from './tick.js'

export { createLogger, silentLogger } from './util.js'

export { resolveDiaryDirs } from './diaries.js'

/* ------------------------------------------------------------------ *
 * dsh 插件面（供 cordis.patch.yml 的 `name: autoschema` 使用）
 * ------------------------------------------------------------------ */
export { name, inject, Config, apply, default } from './plugin.js'
export type { PluginConfig } from './plugin.js'
