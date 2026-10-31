/** AutoSchema — 常量与默认值。 */

import os from 'node:os'
import path from 'node:path'

export const VERSION = '0.3.0'

export const DEFAULT_AGENTS_FILE = path.join(os.homedir(), '.dsh', 'AGENTS.md')
export const DEFAULT_MEMORY_ROOT = path.join(os.homedir(), '.autobiomemory')
export const DEFAULT_STATE_ROOT = path.join(os.homedir(), '.autoschema')
