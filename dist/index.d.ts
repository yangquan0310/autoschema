export { Config, PluginConfig, apply, default, inject, name } from './plugin.js';
import '@deepseek-ai/cordis';
import '@deepseek-ai/schemastery';

/**
 * AutoSchema — 共享类型契约。
 *
 * 皮亚杰式的自我图式演化：
 *   非平衡（disequilibrium）：日记里"我实际怎么做的"与 AGENTS.md 里"我以为我是谁"冲突
 *   同化（assimilation）    ：改现有要点，让旧图式容纳新经验
 *   顺应（accommodation）   ：加新要点，让图式本身被改写
 *   平衡（equilibration）   ：冲突被消化，图式与经验重新自洽
 */
/** AGENTS.md 的三个人格分区。 */
type Section = 'style' | 'belief' | 'value';
/** 分区中文名，用于提示词与报告。 */
declare const SECTION_LABELS: Record<Section, string>;
/** 解析后的 AGENTS.md。`preamble[section]` 保留 `> 说明：…` 这类非条目行。 */
interface SchemaDoc {
    style: string[];
    belief: string[];
    value: string[];
    preamble: Record<Section, string[]>;
    /** 未识别的原文行（保序），渲染时原样带回。 */
    extra: string[];
    raw: string;
}
/** 一篇日记（AutoBioMemory 的 events/<id>.md 正文 + 元信息）。 */
interface DiaryEntry {
    eventId: string;
    occurredAt: string;
    endedAt: string;
    title: string;
    status: string;
    tags: string[];
    people: string[];
    diary: string;
}
/** 指向一条日记证据。 */
interface Evidence {
    eventId: string;
    title: string;
    /** 日记里的原话片段。 */
    quote?: string;
}
/** 一条非平衡：图式与经验的具体冲突。 */
interface Disequilibrium {
    area: Section;
    /** 日记中观察到的行为/倾向。 */
    observed: string;
    /** 与哪条现有要点（或"缺失"）冲突。 */
    against: string;
    /** 冲突的性质：说明为什么这构成非平衡。 */
    conflict: string;
    severity: 'low' | 'medium' | 'high';
    evidence: Evidence[];
}
/**
 * 一条建议的操作类型。
 *
 * - `add`    增：在该节末尾新增一条要点（`value` 为新增文本）
 * - `remove` 删：删除某条现有要点（`target` 定位，`value` 省略）
 * - `modify` 改：改写某条现有要点（`target` + `value`）
 * - `reorder` 重排：给出该节的新顺序（`order`），**价值观的优先级只能靠它表达**
 */
type SuggestionOp = 'add' | 'remove' | 'modify' | 'reorder';
/** 这条建议在图式理论上属于哪一类变化（便于 agent 判断力度）。 */
type PiagetClass = 'assimilation' | 'accommodation';
/**
 * 一条建议 —— 只描述"如果要改，应该怎么改"，不执行。
 *
 * 是否采纳、采纳哪几条，由调用方（agent / 人）决定。
 */
interface Suggestion {
    /** 稳定短 id，便于 `apply --ids s1,s3` 精确采纳。 */
    id: string;
    area: Section;
    op: SuggestionOp;
    /** remove / modify / reorder 必填：现有条目原文（应用时会做就近匹配定位）。 */
    target?: string;
    /** add / modify 必填：建议写入的文本。 */
    value?: string;
    /** reorder 必填：该节重新排序后的条目原文列表，顺序即优先级。 */
    order?: string[];
    /** reorder/add 之外的"改前"原文，便于 diff 展示。 */
    before?: string;
    /** 应用后的预期结果（reorder 时是排序后的完整列表）。 */
    after?: string;
    /** 皮亚杰分类：同化（改措辞）还是顺应（结构变化：增/删/重排）。 */
    piaget: PiagetClass;
    /** 为什么这么改：非平衡在哪儿、证据指向什么。 */
    reason: string;
    evidence: Evidence[];
    /** 0~1，模型对这条建议的把握。 */
    confidence: number;
    severity: 'low' | 'medium' | 'high';
    /** 写回后可能的副作用（让人/agent 有心理准备）。 */
    risk?: string;
}
/** 一条观察到的非平衡（冲突本身，不是改法）。 */
interface Observation {
    area: Section;
    /** 日记里我实际的行为（具体情境）。 */
    observed: string;
    /** 与哪条现有要点冲突；该节为空时写「（该节为空）」。 */
    against: string;
    /** 为什么这构成张力。 */
    conflict: string;
    severity: 'low' | 'medium' | 'high';
    evidence: Evidence[];
}
/** DeepSeek 返回的分析结果：观察 + 建议（建议不落地）。 */
interface Analysis {
    /** 0~1，越高表示图式与经验越自洽。 */
    equilibriumScore: number;
    summary: string;
    observations: Observation[];
    suggestions: Suggestion[];
    notes: string;
}
/** 采纳建议后的结果（只由显式的 apply 产生）。 */
interface ApplyResult {
    changed: boolean;
    doc: SchemaDoc;
    rendered: string;
    applied: {
        add: number;
        remove: number;
        modify: number;
        reorder: number;
    };
    /** 未被采纳或无法定位的建议及原因。 */
    rejected: string[];
    snapshot?: string;
}
interface DeepseekConfig {
    baseUrl: string;
    model: string;
    temperature: number;
    maxTokens: number;
    timeoutMs: number;
    jsonMode: boolean;
    retries: number;
}
/** 触发方式：manual=只手动；schedule=定时（外部 cron/timer 或内置 daemon）；hook=挂 dsh 生命周期。 */
type TriggerMode = 'manual' | 'schedule' | 'hook';
/** hook 允许挂在哪些 dsh 生命周期点（"特定的"挂点，不是任意事件）。 */
type HookEvent = 'compaction/start' | 'agent/pre-step' | 'agent/idle' | 'session/start';
interface ScheduleTriggerConfig {
    /** 最小间隔（分钟）；到点且满足 minNewDiaries 才跑。 */
    intervalMinutes: number;
    /** 可选：每天固定时刻跑（HH:MM，本地时区），设置后优先于 intervalMinutes。 */
    atTime?: string;
    /** 错过时间窗太久的任务是否跳过（避免开机时补跑一堆）。 */
    skipIfOverdueMinutes: number;
}
interface HookTriggerConfig {
    /** 挂点集合；默认只有 compaction/start——特定、可控。 */
    events: HookEvent[];
    /** hook 触发的冷却（毫秒），避免每步都跑。 */
    cooldownMs: number;
}
interface TriggerConfig {
    /** 可同时开多种；manual 始终可用（CLI）。 */
    modes: TriggerMode[];
    /** 任何触发方式共用的最小间隔（毫秒）。 */
    cooldownMs: number;
    /** 至少有多少篇"未消化"日记才值得跑。 */
    minNewDiaries: number;
    /**
     * 自动触发（schedule / hook）永远只产出建议，不写 AGENTS.md——
     * 决定权在 agent。这里只控制建议里允许出现多少条删除/新增（防止一次提一堆）。
     */
    maxRemovals: number;
    maxAdditions: number;
    schedule: ScheduleTriggerConfig;
    hook: HookTriggerConfig;
}
/** 日记来源：可直接指向一个或多个"事件目录"（不必是 AutoBioMemory 的数据根）。 */
interface DiariesConfig {
    /** 事件目录列表；支持 `~` 与相对路径（相对 cwd）。为空时回落到 `<memoryRoot>/events`。 */
    dirs: string[];
    /** 认为哪些文件是一个事件（默认 *.json + 同名 .md）。 */
    includeGlobs: string[];
    /** 只读这些目录，不在别处找（默认 false：还会回落 memoryRoot/events）。 */
    strict: boolean;
}
interface DigestConfig {
    /** 单次最多喂多少篇。 */
    limit: number;
    /** 只喂未消化过的日记（默认 true）。 */
    onlyUndigested: boolean;
    /** 单篇截断长度。 */
    diaryChars: number;
    /** 总输入预算（字符）。 */
    maxInputChars: number;
}
/** 消化游标：哪些日记已经被"吸收"进图式。 */
interface DigestCursor {
    version: number;
    /** eventId → 已吸收进图式的时间与批次。 */
    digested: Record<string, {
        at: string;
        runId: string;
    }>;
    /** eventId → 已分析出建议、但还没落盘的时间与批次（避免定时反复烧 token）。 */
    proposed: Record<string, {
        at: string;
        runId: string;
    }>;
    lastRunAt?: string;
    lastRunId?: string;
    /** 连续跳过次数（用于 daemon 日志）。 */
    skippedRuns?: number;
}
/** 待落盘的建议（`analyze` 产出、`apply` 消费，避免二次调用模型）。 */
interface PendingProposal {
    at: string;
    runId: string;
    analysis: Analysis;
    eventIds: string[];
}
interface AutoSchemaConfig {
    version: number;
    /** AGENTS.md 路径（默认 ~/.dsh/AGENTS.md）。 */
    agentsFile: string;
    /** AutoBioMemory 数据根（默认 ~/.autobiomemory）；`diaries.dirs` 为空时用它下面的 events/。 */
    memoryRoot: string;
    /** 日记位置（可多个目录，显式配置）。 */
    diaries: DiariesConfig;
    /** 总结时取多少篇最近日记。 */
    diaryLimit: number;
    /** 只取该时间点之后的日记（ISO，可空）。 */
    since?: string;
    /** 单篇日记进提示词的最大字符数。 */
    diaryChars: number;
    /** 总输入预算（字符）。 */
    maxInputChars: number;
    /** 自身状态根（快照与变更历史）。 */
    stateRoot: string;
    trigger: TriggerConfig;
    digest: DigestConfig;
    deepseek: DeepseekConfig;
}
interface Logger {
    debug(message: string, ...args: unknown[]): void;
    info(message: string, ...args: unknown[]): void;
    warn(message: string, ...args: unknown[]): void;
    error(message: string, ...args: unknown[]): void;
}
/** 可注入的 DeepSeek 传输层，测试用假实现。 */
interface ChatClient {
    chat(messages: Array<{
        role: 'system' | 'user';
        content: string;
    }>): Promise<string>;
}

/** AutoSchema — 常量与默认值。 */
declare const VERSION = "0.3.3";

/** AutoSchema — 配置：默认值、加载、校验。 */

type DeepPartial<T> = {
    [K in keyof T]?: T[K] extends object ? (T[K] extends unknown[] ? T[K] : DeepPartial<T[K]>) : T[K];
};
declare function defaultConfig(): AutoSchemaConfig;
/** 配置文件：`<stateRoot>/config.json`（可选）。 */
declare function configFile(stateRoot: string): string;
declare function loadConfig(options?: {
    stateRoot?: string;
    patch?: DeepPartial<AutoSchemaConfig>;
}): AutoSchemaConfig;
declare function ensureConfigFile(config: AutoSchemaConfig): string;
declare function validateConfig(config: AutoSchemaConfig): string[];
/** DeepSeek 密钥：状态根 .env → ~/.dsh/.env → memory 根 .env。 */
declare function resolveApiKey(config: AutoSchemaConfig): string | undefined;

/**
 * AutoSchema — AGENTS.md 的解析、渲染与合并。
 *
 * 只认三节：`# 风格` / `# 信念` / `# 价值观`（也接受英文与 `##` 形式）。
 * 其余内容一律原样保留：`> 说明：…` 引用行放 preamble，无法归类的行放 extra，
 * 渲染时按原顺序拼回，保证"只改要点、不动框架"。
 */

/**
 * 解析 AGENTS.md。
 *
 * 没有三节标题时返回空条目集合，但 `raw` 与 `extra` 完整保留，渲染时可原样还原。
 */
declare function parseSchemaDoc(raw: string): SchemaDoc;
declare function readSchemaDoc(file: string): SchemaDoc;
/** 三节的条目总数。 */
declare function itemCount(doc: SchemaDoc): number;
/**
 * 渲染回 Markdown：标题与说明沿用原文，条目按当前数组输出。
 * `extra` 里出现过标题行，这里用 section 归属重新组织，避免重复。
 */
declare function renderSchemaDoc(doc: SchemaDoc): string;
declare function writeSchemaDoc(file: string, doc: SchemaDoc): string;
/** 在一节里找最接近的条目下标；找不到返回 -1。 */
declare function findClosestIndex(items: string[], target: string): number;
interface ApplyOptions {
    /** 只采纳这些 id；缺省表示全部采纳。 */
    ids?: string[];
    /** 单次最多删几条（默认 2）。 */
    maxRemovals?: number;
    /** 单次最多新增几条（默认 4）。 */
    maxAdditions?: number;
}
interface ApplyOutcome {
    doc: SchemaDoc;
    rendered: string;
    applied: {
        add: number;
        remove: number;
        modify: number;
        reorder: number;
    };
    /** 未采纳 / 无法定位的建议及原因。 */
    rejected: string[];
}
/**
 * 采纳建议（**只由显式调用触发**，默认流程从不执行它）。
 *
 * 建议本身只描述"怎么改"，这里负责定位与落地：
 * - `modify`：就近匹配 `target` → 替换为 `value`
 * - `add`：同节去重后追加
 * - `remove`：就近匹配 `target` → 删除（不删空该节、受 maxRemovals 限制）
 * - `reorder`：按 `order` 重排（未提及的条目按原相对顺序排在末尾，不丢弃）
 *
 * 定位不到就进 `rejected`，**绝不**把"改"悄悄变成"增"。
 */
declare function applySuggestions(doc: SchemaDoc, suggestions: Suggestion[], options?: ApplyOptions): ApplyOutcome;

/**
 * AutoSchema — 从 AutoBioMemory 的数据根读取日记。
 *
 * 只依赖磁盘格式（`events/<id>.json` + `<id>.md`），不 import AutoBioMemory 包：
 * 两个项目独立演进，日记格式是它们之间的契约。
 */

declare function eventsDir(memoryRoot: string): string;
/**
 * 解析实际要扫描的日记目录。
 *
 * 优先用 `config.diaries.dirs`（可在 config.json 里配多个目录）；
 * 为空且 `strict=false` 时回落到 `<memoryRoot>/events`。
 */
declare function resolveDiaryDirs(config: {
    memoryRoot: string;
    diaries?: {
        dirs?: string[];
        strict?: boolean;
    };
}): string[];
/**
 * 列出所有事件的 id（多目录合并去重，不做排序）。
 *
 * 传字符串时把它当作**事件目录本身**（与 `readDiary` / `collectDiaries` 一致）；
 * 从 AutoBioMemory 数据根找时用 `resolveDiaryDirs(config)` 或 `eventsDir(root)`。
 */
declare function listEventIds(eventsDirOrDirs: string | string[]): string[];
/** 读一篇日记；正文优先取 `.md`（那才是记忆本体），缺失时回落到 JSON。 */
declare function readDiary(eventsDirOrDirs: string | string[], eventId: string): DiaryEntry | undefined;
interface DiaryQuery {
    limit: number;
    /** ISO 时间下界（含）。 */
    since?: string;
    /** 总字符预算；超出后停止收集。 */
    maxChars: number;
    /** 单篇截断长度。 */
    diaryChars: number;
}
/**
 * 取最近 `limit` 篇日记，按时间倒序。
 *
 * 时间取 `structured.startedAt`，无法解析时按事件 id 里的时间戳排序（id 里带了北京时间）。
 */
declare function collectDiaries(eventsDirOrDirs: string | string[], query: DiaryQuery): DiaryEntry[];
/** 渲染成提示词里的日记块。 */
declare function renderDiaries(entries: DiaryEntry[]): string;

/**
 * AutoSchema — 皮亚杰式自我图式分析：指导语、响应契约、解析。
 *
 * 送进去三样东西：当前图式（AGENTS.md 的风格/信念/价值观）、一段时间的日记、编码要求。
 * 拿回来：非平衡（冲突）、同化（改要点）、顺应（加要点）与平衡度。
 */

/** 分析指导语（皮亚杰版）。注意：只产出建议，绝不改文件。 */
declare const ANALYSIS_GUIDE = "\u4F60\u662F\u6211\u7684\u300C\u81EA\u6211\u56FE\u5F0F\u300D\u5206\u6790\u5E08\u3002\u6211\u7528\u76AE\u4E9A\u6770\u7684\u53D1\u751F\u8BA4\u8BC6\u8BBA\u7EF4\u62A4\u4EBA\u683C\u8BBE\u5B9A\uFF1A\n\n- **\u56FE\u5F0F\uFF08schema\uFF09**\uFF1A`AGENTS.md` \u7684\u4E09\u8282\u2014\u2014\u98CE\u683C / \u4FE1\u5FF5 / \u4EF7\u503C\u89C2\u3002\n- **\u7ECF\u9A8C**\uFF1A\u6211\u7684\u65E5\u8BB0\uFF08AutoBioMemory \u8BB0\u4E0B\u7684\u7B2C\u4E00\u4EBA\u79F0\u4E8B\u4EF6\uFF09\u3002\n- **\u975E\u5E73\u8861**\uFF1A\u65E5\u8BB0\u91CC\"\u6211\u5B9E\u9645\u8FD9\u6837\u505A\u4E86\"\u4E0E\u56FE\u5F0F\u91CC\"\u6211\u4EE5\u4E3A\u6211\u662F\u8C01\"\u4E0D\u4E00\u81F4\u4EA7\u751F\u7684\u5F20\u529B\u3002\n- **\u540C\u5316\uFF08assimilation\uFF09**\uFF1A\u6539\u5DF2\u6709\u8981\u70B9\u7684\u63AA\u8F9E\uFF0C\u8BA9\u65E7\u7ED3\u6784\u5BB9\u7EB3\u65B0\u7ECF\u9A8C\u3002\n- **\u987A\u5E94\uFF08accommodation\uFF09**\uFF1A\u6539\u53D8\u56FE\u5F0F\u7684**\u7ED3\u6784**\u2014\u2014\u65B0\u589E\u4E00\u6761\u3001\u5220\u9664\u4E00\u6761\u3001\u6216\u8C03\u6574\u987A\u5E8F\u3002\n- **\u5E73\u8861**\uFF1A\u51B2\u7A81\u88AB\u6D88\u5316\u540E\uFF0C\u56FE\u5F0F\u4E0E\u7ECF\u9A8C\u91CD\u65B0\u81EA\u6D3D\u3002\n\n## \u4F60\u53EA\u4EA7\u51FA\u5EFA\u8BAE\uFF0C\u4E0D\u6539\u6587\u4EF6\n\n\u4F60**\u4E0D\u4F1A\u4E5F\u4E0D\u5E94\u8BE5**\u76F4\u63A5\u4FEE\u6539 AGENTS.md\u3002\u4F60\u8F93\u51FA\u7684\u662F**\u4E00\u7EC4\u5EFA\u8BAE**\uFF0C\u7531\u6211\u5728\u770B\u5230\u4E4B\u540E\u51B3\u5B9A\u91C7\u7EB3\u54EA\u4E00\u6761\u3002\n\u6240\u4EE5\u6BCF\u6761\u5EFA\u8BAE\u90FD\u5FC5\u987B\u80FD\u72EC\u7ACB\u8BFB\u61C2\u3001\u72EC\u7ACB\u6267\u884C\uFF1A\u6211\u60F3\u91C7\u7EB3\u7B2C 2 \u6761\u5C31\u80FD\u76F4\u63A5\u7167\u505A\uFF0C\u4E0D\u4F9D\u8D56\u522B\u7684\u6761\u76EE\u3002\n\n## \u6BCF\u6761\u5EFA\u8BAE\u5FC5\u987B\u5199\u660E\"\u600E\u4E48\u6539\"\n\n`op` \u53EA\u80FD\u662F\u4E0B\u9762\u56DB\u79CD\u4E4B\u4E00\uFF0C\u542B\u4E49\u56FA\u5B9A\uFF1A\n\n| op | \u542B\u4E49 | \u5FC5\u586B\u5B57\u6BB5 |\n| --- | --- | --- |\n| `add` | **\u589E**\uFF1A\u5728\u8BE5\u8282\u672B\u5C3E\u65B0\u589E\u4E00\u6761\u8981\u70B9 | `value` |\n| `remove` | **\u5220**\uFF1A\u5220\u9664\u67D0\u6761\u73B0\u6709\u8981\u70B9 | `target` |\n| `modify` | **\u6539**\uFF1A\u6539\u5199\u67D0\u6761\u73B0\u6709\u8981\u70B9\u7684\u63AA\u8F9E | `target` + `value` |\n| `reorder` | **\u91CD\u6392**\uFF1A\u7ED9\u51FA\u8BE5\u8282\u7684\u65B0\u987A\u5E8F | `order`\uFF08\u5B8C\u6574\u5217\u8868\uFF0C\u987A\u5E8F\u5373\u4F18\u5148\u7EA7\uFF09 |\n\n\u8865\u5145\u89C4\u5219\uFF1A\n\n1. **\u4EF7\u503C\u89C2\u7684\u672C\u8D28\u662F\u6392\u5E8F**\uFF1A\u4F18\u5148\u7EA7\u53D8\u5316\u5FC5\u987B\u7528 `reorder` \u8868\u8FBE\uFF0C\u4E0D\u8981\u7528 `modify` \u5077\u5077\u6539\u5B57\u5E8F\u3002\n   `order` \u8981\u7ED9\u51FA\u8BE5\u8282**\u5168\u90E8**\u6761\u76EE\u7684\u65B0\u987A\u5E8F\uFF08\u53EF\u65B0\u589E/\u5220\u9664\u540E\u518D\u6392\uFF09\u3002\u53EA\u6709\u771F\u7684\u6539\u53D8\u4E86\u76F8\u5BF9\u4F18\u5148\u7EA7\u624D\u63D0 reorder\u3002\n2. **\u5220\u9664\u4E5F\u662F\u987A\u5E94**\uFF1A`remove` \u7528\u6765\u5220\u6389\"\u5DF2\u88AB\u7ECF\u9A8C\u8BC1\u4F2A\u3001\u4E14\u6CA1\u6709\u66F4\u8D34\u5207\u66FF\u4EE3\"\u7684\u6761\u76EE\u3002\n   \u8BF7\u6CE8\u610F\uFF1A\u5220\u4E00\u6761\u901A\u5E38\u6BD4\u6539\u4E00\u6761\u66F4\u91CD\uFF0C`remove` \u5FC5\u987B\u7ED9\u51FA\u8DB3\u591F\u8BC1\u636E\u4E0E `risk`\u3002\n3. `target` \u5FC5\u987B**\u9010\u5B57\u53D6\u81EA**\u8BE5\u8282\u73B0\u6709\u6761\u76EE\uFF08\u6211\u4F1A\u505A\u5C31\u8FD1\u5339\u914D\uFF0C\u4F46\u9010\u5B57\u6700\u7A33\uFF09\uFF1B\u5B9A\u4F4D\u4E0D\u5230\u7684\u5EFA\u8BAE\u4F1A\u88AB\u4E22\u5F03\u3002\n4. `piaget`\uFF1A`modify` \u4E00\u5F8B `assimilation`\uFF1B`add` / `remove` / `reorder` \u4E00\u5F8B `accommodation`\u3002\n\n## \u5224\u65AD\u6807\u51C6\n\n1. **\u53EA\u4F9D\u636E\u65E5\u8BB0\u8BC1\u636E**\uFF1A\u6BCF\u6761\u5EFA\u8BAE\u7684 `evidence` \u8981\u6307\u5411\u5177\u4F53\u4E8B\u4EF6 ID \u4E0E\u65E5\u8BB0\u539F\u8BDD\u3002\u6CA1\u8BC1\u636E\u5C31\u522B\u63D0\u3002\n2. **\u4E09\u8282\u5404\u7BA1\u4EC0\u4E48**\uFF08\u4E0D\u8981\u4E32\u5473\uFF09\uFF1A\n   - `\u98CE\u683C`\uFF08style\uFF09\uFF1A\u600E\u4E48\u505A\u4E8B\uFF0C**\u5916\u5728\u884C\u4E3A\u53EF\u89C2\u5BDF**\u2014\u2014\u5148\u7ED9\u7ED3\u8BBA\u8FD8\u662F\u5148\u94FA\u80CC\u666F\u3001\u52A8\u624B\u524D\u662F\u5426\u590D\u8FF0\u9700\u6C42\u3001\u9047\u4E0D\u786E\u5B9A\u5148\u95EE\u8FD8\u662F\u5148\u731C\u3002\n   - `\u4FE1\u5FF5`\uFF08belief\uFF09\uFF1A\u4FE1\u4EC0\u4E48\uFF0C**\u5185\u5728\u4EF7\u503C\u539F\u5219**\u2014\u2014\u5BF9\"\u4E0D\u77E5\u9053\"\u7684\u6001\u5EA6\u3001\u5BF9\u9A8C\u8BC1\u7684\u8981\u6C42\u3001\u5BF9\u98CE\u9669\u7684\u7ACB\u573A\u3002\n   - `\u4EF7\u503C\u89C2`\uFF08value\uFF09\uFF1A\u51B2\u7A81\u65F6\u7684**\u6392\u5E8F**\u2014\u2014\u4E24\u79CD\u597D\u5904\u4E0D\u53EF\u517C\u5F97\u65F6\u5148\u4FDD\u54EA\u4E2A\uFF08\u5B89\u5168 > \u8FDB\u5EA6\u3001\u4E8B\u5B9E > \u9762\u5B50\u3001\u957F\u671F > \u77ED\u671F\uFF09\u3002\n3. **\u533A\u5206\"\u5076\u53D1\"\u4E0E\"\u6A21\u5F0F\"**\uFF1A\u53EA\u628A\u53CD\u590D\u51FA\u73B0\uFF08\u22652 \u6B21\u6216\u660E\u663E\u4E00\u8D2F\uFF09\u7684\u884C\u4E3A\u4E0A\u5347\u4E3A\u5EFA\u8BAE\uFF1B\u4E00\u6B21\u6027\u5931\u8BEF\u5199\u8FDB observations \u6216 notes\u3002\n4. **\u6539\u4F18\u4E8E\u589E\uFF0C\u589E\u4F18\u4E8E\u5220**\uFF1A\u80FD\u7528 `modify` \u89E3\u51B3\u7684\u4E0D\u8981 `add`\uFF1B\u80FD `add` \u7684\u4E0D\u8981 `remove`\u3002\n   \u5355\u6B21\u5EFA\u8BAE\u91CC `remove` \u4E0D\u8D85\u8FC7 2 \u6761\u3001`add` \u4E0D\u8D85\u8FC7 4 \u6761\u3002\n5. **\u4E0D\u8981\u7F8E\u5316**\uFF1A\u65E5\u8BB0\u91CC\u7684\u5931\u8D25\u3001\u56DE\u907F\u3001\u62D6\u5EF6\u3001\u8FC7\u5EA6\u81EA\u4FE1\u90FD\u8981\u5982\u5B9E\u5BF9\u7167\u3002\u56FE\u5F0F\u5199\u5F97\u5F88\u6F02\u4EAE\u4F46\u957F\u671F\u505A\u4E0D\u5230\uFF0C\u672C\u8EAB\u5C31\u662F\u6700\u5F3A\u7684\u975E\u5E73\u8861\u3002\n6. **\u7A7A\u56FE\u5F0F**\uFF1A\u67D0\u8282\u4E3A\u7A7A\u65F6\uFF0C\u53CD\u590D\u51FA\u73B0\u7684\u884C\u4E3A\u5C31\u662F `add` \u7684\u4E3B\u8981\u6765\u6E90\uFF1B\u6B64\u65F6 observation \u7684 `against` \u5199\u300C\uFF08\u8BE5\u8282\u4E3A\u7A7A\uFF09\u300D\u3002\n\n## \u8F93\u51FA\u54C1\u5473\n\n- `value` \u8981\u80FD\u76F4\u63A5\u5199\u8FDB AGENTS.md\uFF1A\u7B2C\u4E00\u4EBA\u79F0\u3001\u53EF\u89C2\u5BDF\u3001\u53EF\u6267\u884C\uFF0C**\u4E0D\u662F\u53E3\u53F7**\u3002\n- `reason` \u8BB2\u6E05\"\u54EA\u6761\u975E\u5E73\u8861 + \u8BC1\u636E\u6307\u5411\u4EC0\u4E48\"\uFF0C\u4E0D\u8981\u590D\u8FF0 `value`\u3002\n- `risk` \u5199\u6E05\u91C7\u7EB3\u540E\u7684\u526F\u4F5C\u7528\uFF08\u4F8B\u5982\"\u53EF\u80FD\u8BA9\u6C47\u62A5\u53D8\u957F\"\uFF09\u3002\n- `confidence` \u7ED9 0~1\uFF1B\u6CA1\u628A\u63E1\u7684\u5EFA\u8BAE\u5B81\u53EF\u653E\u8FDB notes\u3002\n- \u6BCF\u6761 suggestion \u7684 `id` \u7528 `s1`\u3001`s2`\u2026 \u987A\u5E8F\u7F16\u53F7\u3002\n\n## \u53EA\u8F93\u51FA JSON\n\n\u4E0D\u8981 markdown \u4EE3\u7801\u5757\uFF0C\u4E0D\u8981\u89E3\u91CA\u6587\u5B57\u3002";
/** 响应契约。 */
declare const RESPONSE_CONTRACT = "## \u54CD\u5E94\u5951\u7EA6\n\n{\n  \"equilibriumScore\": 0.42,\n  \"summary\": \"\u4E00\u53E5\u8BDD\uFF1A\u5F53\u524D\u56FE\u5F0F\u4E0E\u8FD9\u6BB5\u65F6\u95F4\u7ECF\u9A8C\u4E4B\u95F4\u6700\u4E3B\u8981\u7684\u5F20\u529B\",\n  \"observations\": [\n    {\n      \"area\": \"style | belief | value\",\n      \"observed\": \"\u65E5\u8BB0\u91CC\u6211\u5B9E\u9645\u7684\u884C\u4E3A\uFF08\u5177\u4F53\u60C5\u5883\uFF09\",\n      \"against\": \"\u4E0E\u56FE\u5F0F\u54EA\u6761\u51B2\u7A81\uFF1B\u8BE5\u8282\u4E3A\u7A7A\u65F6\u5199\u300C\uFF08\u8BE5\u8282\u4E3A\u7A7A\uFF09\u300D\",\n      \"conflict\": \"\u4E3A\u4EC0\u4E48\u6784\u6210\u975E\u5E73\u8861\",\n      \"severity\": \"low | medium | high\",\n      \"evidence\": [{ \"eventId\": \"ev_...\", \"title\": \"\u4E8B\u4EF6\u6807\u9898\", \"quote\": \"\u65E5\u8BB0\u539F\u8BDD\" }]\n    }\n  ],\n  \"suggestions\": [\n    {\n      \"id\": \"s1\",\n      \"area\": \"style | belief | value\",\n      \"op\": \"add | remove | modify | reorder\",\n      \"target\": \"\uFF08remove/modify \u5FC5\u586B\uFF09\u73B0\u6709\u6761\u76EE\u539F\u6587\uFF1Breorder \u53EF\u7701\u7565\u5355\u6761 target\",\n      \"value\": \"\uFF08add/modify \u5FC5\u586B\uFF09\u5EFA\u8BAE\u5199\u5165\u7684\u4E00\u53E5\u8BDD\",\n      \"order\": [\"\uFF08\u4EC5 reorder\uFF09\u8BE5\u8282\u5B8C\u6574\u7684\u65B0\u987A\u5E8F\uFF0C\u987A\u5E8F\u5373\u4F18\u5148\u7EA7\"],\n      \"before\": \"\uFF08\u53EF\u9009\uFF09\u6539\u524D\u539F\u6587\",\n      \"after\": \"\uFF08\u53EF\u9009\uFF09\u6539\u540E\u9884\u671F\u7ED3\u679C\uFF1Breorder \u65F6\u7ED9\u6392\u5E8F\u540E\u7684\u5B8C\u6574\u5217\u8868\",\n      \"piaget\": \"assimilation | accommodation\",\n      \"reason\": \"\u54EA\u6761\u975E\u5E73\u8861 + \u8BC1\u636E\u6307\u5411\u4EC0\u4E48\",\n      \"evidence\": [{ \"eventId\": \"ev_...\", \"title\": \"...\", \"quote\": \"...\" }],\n      \"confidence\": 0.0,\n      \"severity\": \"low | medium | high\",\n      \"risk\": \"\uFF08\u53EF\u9009\uFF09\u91C7\u7EB3\u540E\u7684\u526F\u4F5C\u7528\"\n    }\n  ],\n  \"notes\": \"\u7591\u8651\u3001\u8BC1\u636E\u4E0D\u8DB3\u5904\u3001\u4E00\u6B21\u6027\u5076\u53D1\u4E8B\u4EF6\uFF08\u4E0D\u8FDB\u5EFA\u8BAE\uFF09\"\n}\n\n\u786C\u7EA6\u675F\uFF1A\n- suggestions[].op \u53EA\u80FD\u662F add / remove / modify / reorder\u3002\n- add: value \u5FC5\u586B\uFF1Bremove: target \u5FC5\u586B\uFF1Bmodify: target + value \u5FC5\u586B\uFF1Breorder: order \u4E14\u81F3\u5C11 2 \u6761\u3002\n- area \u53EA\u7528 style / belief / value\u3002\n- \u4F60\u4E0D\u4FEE\u6539\u4EFB\u4F55\u6587\u4EF6\uFF0C\u53EA\u8F93\u51FA\u5EFA\u8BAE\u3002\n- \u53EA\u8F93\u51FA JSON\u3002";
declare class AnalysisError extends Error {
    readonly detail: string;
    constructor(message: string, detail?: string);
}
/**
 * 结构化校验：不符合契约的建议丢弃而不是让整次分析失败。
 *
 * 关键约束：`op` 决定必填字段——add 要 value，remove 要 target，modify 要 target+value，
 * reorder 要 order（≥2 条）。缺字段的建议直接丢，不做"猜测性降级"。
 */
declare function normalizeAnalysis(value: unknown): Analysis;
/** 提取第一个平衡的 JSON 对象（容忍代码块与前后散文）。 */
declare function extractJsonObject(text: string): string | undefined;
declare function parseAnalysisResponse(text: string): Analysis;
/** 渲染图式现状（供提示词使用）。 */
declare function renderSchema(doc: SchemaDoc): string;
interface AnalysisRequest {
    doc: SchemaDoc;
    diaries: DiaryEntry[];
    renderedDiaries: string;
}
/** 组装 system + user 两条消息。 */
declare function buildAnalysisRequest(request: AnalysisRequest): {
    system: string;
    user: string;
};

/** AutoSchema — DeepSeek Chat 客户端（JSON 模式 + 重试 + 超时）。 */

declare class DeepseekError extends Error {
    readonly status?: number;
    readonly body?: string;
    constructor(message: string, options?: {
        status?: number;
        body?: string;
    });
}
declare class DeepseekClient implements ChatClient {
    private readonly config;
    private readonly apiKey;
    private readonly logger;
    constructor(config: DeepseekConfig, apiKey: string, logger?: Logger);
    private endpoint;
    chat(messages: Array<{
        role: 'system' | 'user';
        content: string;
    }>): Promise<string>;
}

/**
 * AutoSchema — 编排：读图式与日记，交给 DeepSeek 做皮亚杰式分析，按需写回 AGENTS.md。
 *
 * 一次完整的平衡化循环：
 *   1. 读 `~/.dsh/AGENTS.md`（当前图式）
 *   2. 读最近若干篇日记（经验）
 *   3. 让 DeepSeek 给出非平衡 / 同化 / 顺应
 *   4. 校验并应用（可选）→ 快照旧版本 → 写回
 */

interface RunOptions {
    config: AutoSchemaConfig;
    /** 注入传输层（测试用）；缺省走真实 DeepSeek。 */
    client?: ChatClient;
    logger?: Logger;
    /** 只分析不写回（默认 true）。 */
    dryRun?: boolean;
    /** 覆盖：只取最近 N 篇日记。 */
    limit?: number;
    /** 覆盖：时间下界。 */
    since?: string;
    /** 覆盖：是否只喂未消化的日记（默认取 config.digest.onlyUndigested）。 */
    onlyUndigested?: boolean;
    /** 覆盖：跑完是否标记消化（默认 true；失败/异常不标记）。 */
    markDigested?: boolean;
    /** 运行批次 id（测试可注入）。 */
    runId?: string;
}
interface RunResult {
    analysis: Analysis;
    /** 本次实际喂进去的日记 id。 */
    digestedIds: string[];
    /** 因"已处理过"被跳过的篇数。 */
    skippedDigested: number;
    diaries: DiaryEntry[];
    /** 当前图式渲染（未改动）。 */
    rendered: string;
    /** 建议已存为待审（供 apply --from-pending 消费）。 */
    pendingSaved: boolean;
}
/** 读取当前图式；文件不存在时返回空图式（而不是报错）。 */
declare function readSchema(config: AutoSchemaConfig): SchemaDoc;
/** 采集日记。 */
declare function gatherDiaries(config: AutoSchemaConfig, limit?: number, since?: string): DiaryEntry[];
/** 快照旧版本，保留历史（不依赖 git）。 */
declare function snapshotSchema(config: AutoSchemaConfig, raw: string): string;
/**
 * 一次分析 —— **只产出建议，绝不改 AGENTS.md**。
 *
 * 建议同时写入 `state/pending.json`（供 agent 之后挑选采纳）与 `state/last-run.json`（摘要）。
 */
declare function propose(options: RunOptions): Promise<RunResult>;
/** 兼容旧名字（`run` 现在等同于"只出建议"）。 */
declare const run: typeof propose;
/** 待审建议文件位置。 */
declare function pendingFile(stateRoot: string): string;
/** 读取待审建议。 */
declare function loadPending(config: AutoSchemaConfig): PendingProposal | undefined;
declare function clearPending(config: AutoSchemaConfig): void;
interface ApplySelectionOptions {
    /** 只采纳这些建议 id；缺省=全部。 */
    ids?: string[];
    /** 运行批次（写进快照历史）。 */
    runId?: string;
}
/**
 * 采纳建议并写回 —— **只由显式调用触发**（`autoschema apply --ids s1,s3`）。
 *
 * 写前先快照；定位不到的建议进 `rejected`，不做猜测性降级。
 */
declare function applySelected(config: AutoSchemaConfig, suggestions: Suggestion[], options?: ApplySelectionOptions): ApplyResult;
/** 采纳待审建议（`autoschema apply --from-pending`）。 */
declare function applyPending(config: AutoSchemaConfig, options?: ApplySelectionOptions): {
    result: ApplyResult;
    cursorMarked: number;
};
/** 人类可读报告（CLI 与测试共用）。**只讲建议，不讲"已写回"**。 */
declare function renderReport(result: RunResult): string;
declare function listHistory(config: AutoSchemaConfig): Array<{
    at: string;
    file: string;
    chars: number;
}>;

/**
 * AutoSchema — 定时触发。
 *
 * 两种用法，都不依赖守护进程常驻也都能常驻：
 *   1. 外部调度：`autoschema tick`（幂等）交给 cron / systemd timer，到点才真正干活；
 *   2. 内置循环：`autoschema daemon --interval 60` 自己按分钟检查。
 *
 * 是否"该跑"由三道闸门决定：cooldown、minNewDiaries、可选固定时刻。
 */

interface DueCheck {
    due: boolean;
    reason: string;
    /** 距离下次可跑还有多少毫秒（due=true 时为 0）。 */
    waitMs: number;
    undigested: number;
}
/** 解析 `HH:MM` 到今天（或明天）的时间点。 */
declare function nextAtTime(now: Date, atTime: string): number | undefined;
/**
 * 判断现在是否该跑。
 *
 * 闸门顺序：模式允许 → 冷却 → 最小新日记数 → 固定时刻（若配置）。
 */
declare function checkDue(config: AutoSchemaConfig, now?: Date): DueCheck;
/**
 * hook 触发的闸门：只看 hook 自己的冷却与未消化数量。
 *
 * 与 schedule 闸门分开，是因为 hook 的时机由生命周期点决定（例如压缩开始时**必须**看一眼），
 * 不该被"每日一次"这类间隔拦住；它用的是 `trigger.hook.cooldownMs`。
 */
declare function checkHookDue(config: AutoSchemaConfig, now?: Date): DueCheck;
/** 记录一次"看过但没有可做"的跳过（用于冷却，避免 daemon 每秒重算）。 */
declare function recordSkip(config: AutoSchemaConfig): void;
/** 建议的 cron 行（用户粘到自己机器的 crontab）。 */
declare function cronLine(config: AutoSchemaConfig, cliPath?: string): string;

/**
 * AutoSchema — 消化游标：记住"哪些日记已经被吸收进图式"。
 *
 * 为什么要它：
 *   - 定时触发若每次都取"最近 N 篇"，会把同一批日记反复分析（重复烧 token、重复提同样的建议）。
 *   - 只喂**未消化**的日记，非平衡才真正对应"新经验"。
 *
 * 游标存在 `<stateRoot>/state/cursor.json`，`apply`（或自动模式的 propose 成功）后标记消化；
 * 失败不标记，下次重试同一批。
 */

declare function cursorFile(stateRoot: string): string;
declare function emptyCursor(): DigestCursor;
declare function loadCursor(stateRoot: string): DigestCursor;
declare function saveCursor(stateRoot: string, cursor: DigestCursor): void;
declare function isDigested(cursor: DigestCursor, eventId: string): boolean;
declare function isPending(cursor: DigestCursor, eventId: string): boolean;
/** 已吸收或已提出建议——两种都不该再喂一次。 */
declare function isSettled(cursor: DigestCursor, eventId: string): boolean;
/** 只保留未消化过的日记（保持传入顺序）。 */
declare function filterUndigested(cursor: DigestCursor, entries: DiaryEntry[]): DiaryEntry[];
/** 统计未消化数量（不读正文，只看 id）。 */
declare function countUndigested(cursor: DigestCursor, eventIds: string[]): number;
/** 标记消化；返回新的游标（不落盘）。 */
/** 标记"已吸收"（真正写回了图式）。 */
declare function markDigested(cursor: DigestCursor, eventIds: string[], runId?: string): DigestCursor;
/** 标记"已提出建议、待人工落盘"。 */
declare function markProposed(cursor: DigestCursor, eventIds: string[], runId?: string): DigestCursor;
/** 待落盘的事件 id。 */
declare function pendingEventIds(cursor: DigestCursor): string[];
/** 清空待落盘标记（拒绝建议时用）。 */
declare function clearProposed(cursor: DigestCursor): DigestCursor;
/** 只记录"跑过但没消化"（证据不足/空结果时也算把这一批看过一遍）。 */
declare function markRun(cursor: DigestCursor, runId?: string): DigestCursor;
/** 最近一次运行距今多久（毫秒）；没跑过返回 Infinity。 */
declare function msSinceLastRun(cursor: DigestCursor, now?: number): number;
/** 清空消化记录（配合 --reset-cursor）。 */
declare function resetCursor(stateRoot: string): void;

/**
 * AutoSchema — 触发执行器：把"该不该跑"与"跑什么"接起来。
 *
 * 供 tick / daemon / hook 三条路径共用，保证三种触发方式的语义完全一致：
 *   闸门（冷却 + 未消化数量）→ 取未消化日记 → 分析 → 按 applyMode 落盘或存为待审。
 */

interface TickOptions {
    config: AutoSchemaConfig;
    client?: ChatClient;
    logger?: Logger;
    /** manual=强制跑（忽略闸门）；schedule/hook=按闸门判断。 */
    origin: 'manual' | 'schedule' | 'hook';
    /** 仅检查不执行。 */
    dryCheck?: boolean;
}
interface TickResult {
    ran: boolean;
    due?: DueCheck;
    result?: RunResult;
    /** 只出建议（proposed）｜无建议（clean）｜被闸门跳过（skipped）。 */
    mode: 'proposed' | 'clean' | 'skipped';
    message: string;
}
/** 跑一次（受闸门约束，除非 origin=manual）。**产出建议，从不改 AGENTS.md。** */
declare function tick(options: TickOptions): Promise<TickResult>;
/** 供 hook 使用：把最近运行时间写进游标，避免同一生命周期点连跑。 */
declare function touchRun(config: AutoSchemaConfig): void;

interface LogLevel {
    level?: 'debug' | 'info' | 'warn' | 'error';
}
declare function createLogger(options?: LogLevel): {
    debug: (m: string, ...a: unknown[]) => void;
    info: (m: string, ...a: unknown[]) => void;
    warn: (m: string, ...a: unknown[]) => void;
    error: (m: string, ...a: unknown[]) => void;
};
declare function silentLogger(): {
    debug: () => void;
    info: () => void;
    warn: () => void;
    error: () => void;
};

export { ANALYSIS_GUIDE, type Analysis, AnalysisError, type ApplyResult, type ApplySelectionOptions, type AutoSchemaConfig, type ChatClient, DeepseekClient, type DeepseekConfig, DeepseekError, type DiariesConfig, type DiaryEntry, type DigestConfig, type DigestCursor, type Disequilibrium, type DueCheck, type Evidence, type HookEvent, type HookTriggerConfig, type Logger, type Observation, type PendingProposal, type PiagetClass, RESPONSE_CONTRACT, type RunOptions, type RunResult, SECTION_LABELS, type ScheduleTriggerConfig, type SchemaDoc, type Section, type Suggestion, type SuggestionOp, type TickOptions, type TickResult, type TriggerConfig, type TriggerMode, VERSION, applyPending, applySelected, applySuggestions, buildAnalysisRequest, checkDue, checkHookDue, clearPending, clearProposed, collectDiaries, configFile, countUndigested, createLogger, cronLine, cursorFile, defaultConfig, emptyCursor, ensureConfigFile, eventsDir, extractJsonObject, filterUndigested, findClosestIndex, gatherDiaries, isDigested, isPending, isSettled, itemCount, listEventIds, listHistory, loadConfig, loadCursor, loadPending, markDigested, markProposed, markRun, msSinceLastRun, nextAtTime, normalizeAnalysis, parseAnalysisResponse, parseSchemaDoc, pendingEventIds, pendingFile, propose, readDiary, readSchema, readSchemaDoc, recordSkip, renderDiaries, renderReport, renderSchema, renderSchemaDoc, resetCursor, resolveApiKey, resolveDiaryDirs, run, saveCursor, silentLogger, snapshotSchema, tick, touchRun, validateConfig, writeSchemaDoc };
