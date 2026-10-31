/** AutoSchema — 包入口。 */

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
  applyChanges,
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

export { createLogger, silentLogger } from './util.js'
