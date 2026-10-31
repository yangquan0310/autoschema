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
/** 一条同化：修订已有要点。 */
interface AssimilationItem {
    area: Section;
    /** 现有要点原文（用于定位）。 */
    target: string;
    /** 修订后的要点。 */
    revised: string;
    why: string;
    evidence: Evidence[];
}
/** 一条顺应：新增要点。 */
interface AccommodationItem {
    area: Section;
    text: string;
    why: string;
    evidence: Evidence[];
}
/** DeepSeek 返回的分析结果。 */
interface Analysis {
    /** 0~1，越高表示图式与经验越自洽。 */
    equilibriumScore: number;
    summary: string;
    disequilibrium: Disequilibrium[];
    assimilation: AssimilationItem[];
    accommodation: AccommodationItem[];
    notes: string;
}
/** 应用变更后的结果。 */
interface ApplyResult {
    changed: boolean;
    doc: SchemaDoc;
    rendered: string;
    applied: {
        assimilation: number;
        accommodation: number;
    };
    skipped: string[];
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
    /** 自动模式下的写回策略：propose=只出建议（默认），apply=直接写回。 */
    applyMode: 'propose' | 'apply';
    schedule: ScheduleTriggerConfig;
    hook: HookTriggerConfig;
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
    /** AutoBioMemory 数据根（默认 ~/.autobiomemory）。 */
    memoryRoot: string;
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
declare const VERSION = "0.2.0";

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
interface MergeOptions {
    /** 同化时允许的最大"就近匹配"阈值；找不到目标则跳过。 */
    minMatch?: number;
}
/**
 * 应用同化与顺应。
 *
 * - 同化：定位 `target` 现有条目并替换为 `revised`；定位不到时记入 `skipped`（不凭空新增，
 *   避免把"改写"退化成"追加"而污染图式）。
 * - 顺应：同一节内按文本去重后追加到末尾。
 */
declare function applyChanges(doc: SchemaDoc, assimilation: AssimilationItem[], accommodation: AccommodationItem[], options?: MergeOptions): {
    doc: SchemaDoc;
    applied: {
        assimilation: number;
        accommodation: number;
    };
    skipped: string[];
};

/**
 * AutoSchema — 从 AutoBioMemory 的数据根读取日记。
 *
 * 只依赖磁盘格式（`events/<id>.json` + `<id>.md`），不 import AutoBioMemory 包：
 * 两个项目独立演进，日记格式是它们之间的契约。
 */

declare function eventsDir(memoryRoot: string): string;
/** 列出所有事件的 id（不做排序）。 */
declare function listEventIds(memoryRoot: string): string[];
/** 读一篇日记；正文优先取 `.md`（那才是记忆本体），缺失时回落到 JSON。 */
declare function readDiary(memoryRoot: string, eventId: string): DiaryEntry | undefined;
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
declare function collectDiaries(memoryRoot: string, query: DiaryQuery): DiaryEntry[];
/** 渲染成提示词里的日记块。 */
declare function renderDiaries(entries: DiaryEntry[]): string;

/**
 * AutoSchema — 皮亚杰式自我图式分析：指导语、响应契约、解析。
 *
 * 送进去三样东西：当前图式（AGENTS.md 的风格/信念/价值观）、一段时间的日记、编码要求。
 * 拿回来：非平衡（冲突）、同化（改要点）、顺应（加要点）与平衡度。
 */

/** 事件编码指导语（皮亚杰版）。 */
declare const ANALYSIS_GUIDE: string;
/** 响应契约（字段与语义）。 */
declare const RESPONSE_CONTRACT = "## \u54CD\u5E94\u5951\u7EA6\n\n{\n  \"equilibriumScore\": 0.42,\n  \"summary\": \"\u4E00\u53E5\u8BDD\uFF1A\u5F53\u524D\u56FE\u5F0F\u4E0E\u8FD9\u6BB5\u65F6\u95F4\u7684\u7ECF\u9A8C\u4E4B\u95F4\uFF0C\u6700\u4E3B\u8981\u7684\u5F20\u529B\u662F\u4EC0\u4E48\",\n  \"disequilibrium\": [\n    {\n      \"area\": \"style | belief | value\",\n      \"observed\": \"\u65E5\u8BB0\u91CC\u6211\u5B9E\u9645\u7684\u884C\u4E3A\uFF08\u5177\u4F53\u60C5\u5883\uFF09\",\n      \"against\": \"\u4E0E\u56FE\u5F0F\u91CC\u7684\u54EA\u6761\u8981\u70B9\u51B2\u7A81\uFF1B\u8BE5\u8282\u4E3A\u7A7A\u65F6\u5199\u300C\uFF08\u8BE5\u8282\u4E3A\u7A7A\uFF09\u300D\",\n      \"conflict\": \"\u4E3A\u4EC0\u4E48\u8FD9\u6784\u6210\u975E\u5E73\u8861\",\n      \"severity\": \"low | medium | high\",\n      \"evidence\": [{ \"eventId\": \"ev_...\", \"title\": \"\u4E8B\u4EF6\u6807\u9898\", \"quote\": \"\u65E5\u8BB0\u91CC\u7684\u539F\u8BDD\u7247\u6BB5\" }]\n    }\n  ],\n  \"assimilation\": [\n    {\n      \"area\": \"style | belief | value\",\n      \"target\": \"\u8981\u4FEE\u8BA2\u7684\u73B0\u6709\u8981\u70B9\u539F\u6587\uFF08\u5FC5\u987B\u80FD\u5728\u8BE5\u8282\u91CC\u627E\u5230\uFF0C\u5426\u5219\u6B64\u6761\u4F1A\u88AB\u4E22\u5F03\uFF09\",\n      \"revised\": \"\u4FEE\u8BA2\u540E\u7684\u4E00\u53E5\u8BDD\uFF0C\u7B2C\u4E00\u4EBA\u79F0\u3001\u53EF\u89C2\u5BDF\u3001\u53EF\u6267\u884C\",\n      \"why\": \"\u4E3A\u4EC0\u4E48\u8FD9\u6837\u6539\u800C\u4E0D\u662F\u65B0\u589E\",\n      \"evidence\": [{ \"eventId\": \"ev_...\", \"title\": \"...\", \"quote\": \"...\" }]\n    }\n  ],\n  \"accommodation\": [\n    {\n      \"area\": \"style | belief | value\",\n      \"text\": \"\u65B0\u589E\u7684\u4E00\u53E5\u8BDD\u8981\u70B9\",\n      \"why\": \"\u73B0\u6709\u56FE\u5F0F\u7F3A\u4E86\u54EA\u4E00\u7EF4\",\n      \"evidence\": [{ \"eventId\": \"ev_...\", \"title\": \"...\", \"quote\": \"...\" }]\n    }\n  ],\n  \"notes\": \"\u7591\u8651\u3001\u8BC1\u636E\u4E0D\u8DB3\u5904\u3001\u4E00\u6B21\u6027\u5076\u53D1\u4E8B\u4EF6\uFF08\u4E0D\u8FDB\u56FE\u5F0F\uFF09\"\n}\n\n\u7EA6\u675F\uFF1A\n- area \u53EA\u7528 style / belief / value \u4E09\u4E2A\u503C\u3002\n- assimilation.target \u5FC5\u987B\u9010\u5B57\u53D6\u81EA\u8BE5\u8282\u73B0\u6709\u6761\u76EE\uFF0C\u5426\u5219\u8FD9\u6761\u4F1A\u88AB\u7CFB\u7EDF\u4E22\u5F03\u3002\n- \u6CA1\u6709\u628A\u63E1\u7684\u6761\u76EE\u5B81\u53EF\u653E\u5728 notes \u91CC\uFF0C\u4E5F\u4E0D\u8981\u7F16\u9020\u3002\n- \u53EA\u8F93\u51FA JSON\u3002";
declare class AnalysisError extends Error {
    readonly detail: string;
    constructor(message: string, detail?: string);
}
/** 结构化校验：不符合契约的条目丢弃而不是让整次分析失败。 */
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
    /** 本次实际消化（喂进去）的日记 id。 */
    digestedIds: string[];
    /** 因已消化被跳过的篇数。 */
    skippedDigested: number;
    /** 变更前的图式。 */
    before: SchemaDoc;
    /** 变更后的图式（dryRun 时等于 before 加变更的草案，不落盘）。 */
    after: SchemaDoc;
    applied: {
        assimilation: number;
        accommodation: number;
    };
    skipped: string[];
    diaries: DiaryEntry[];
    rendered: string;
    /** 写回成功后的快照路径。 */
    snapshot?: string;
    wrote: boolean;
    /** 建议已存为待落盘（供 `apply` 直接消费，不必再调模型）。 */
    pendingSaved: boolean;
}
/** 读取当前图式；文件不存在时返回空图式（而不是报错）。 */
declare function readSchema(config: AutoSchemaConfig): SchemaDoc;
/** 采集日记。 */
declare function gatherDiaries(config: AutoSchemaConfig, limit?: number, since?: string): DiaryEntry[];
/** 快照旧版本，保留历史（不依赖 git）。 */
declare function snapshotSchema(config: AutoSchemaConfig, raw: string): string;
/**
 * 一次分析（不写回）。
 *
 * 传 `dryRun: false` 时才把结果写进 AGENTS.md（先快照）。
 */
declare function run(options: RunOptions): Promise<RunResult>;
/** 待落盘建议的位置。 */
declare function pendingFile(stateRoot: string): string;
/** 读取待落盘建议。 */
declare function loadPending(config: AutoSchemaConfig): PendingProposal | undefined;
declare function clearPending(config: AutoSchemaConfig): void;
/**
 * 直接落盘一份已算好的建议（`analyze` 之后 `apply`，不再调模型）。
 */
declare function applyProposal(config: AutoSchemaConfig, proposal: PendingProposal, options?: {
    runId?: string;
}): {
    after: SchemaDoc;
    applied: {
        assimilation: number;
        accommodation: number;
    };
    skipped: string[];
    snapshot?: string;
    rendered: string;
};
/** 人类可读报告（CLI 与测试共用）。 */
declare function renderReport(result: RunResult): string;
/** 图式变更历史。 */
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
    /** 落盘还是仅出建议。 */
    mode: 'applied' | 'proposed' | 'skipped';
    message: string;
}
/** 跑一次（受闸门约束，除非 origin=manual）。 */
declare function tick(options: TickOptions): Promise<TickResult>;
/** 供 hook 使用：把最近的运行时间写进游标，避免同一生命周期点连跑。 */
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

export { ANALYSIS_GUIDE, type AccommodationItem, type Analysis, AnalysisError, type ApplyResult, type AssimilationItem, type AutoSchemaConfig, type ChatClient, DeepseekClient, type DeepseekConfig, DeepseekError, type DiaryEntry, type DigestConfig, type DigestCursor, type Disequilibrium, type DueCheck, type Evidence, type HookEvent, type HookTriggerConfig, type Logger, type PendingProposal, RESPONSE_CONTRACT, type RunOptions, type RunResult, SECTION_LABELS, type ScheduleTriggerConfig, type SchemaDoc, type Section, type TickOptions, type TickResult, type TriggerConfig, type TriggerMode, VERSION, applyChanges, applyProposal, buildAnalysisRequest, checkDue, checkHookDue, clearPending, clearProposed, collectDiaries, configFile, countUndigested, createLogger, cronLine, cursorFile, defaultConfig, emptyCursor, ensureConfigFile, eventsDir, extractJsonObject, filterUndigested, findClosestIndex, gatherDiaries, isDigested, isPending, isSettled, itemCount, listEventIds, listHistory, loadConfig, loadCursor, loadPending, markDigested, markProposed, markRun, msSinceLastRun, nextAtTime, normalizeAnalysis, parseAnalysisResponse, parseSchemaDoc, pendingEventIds, pendingFile, readDiary, readSchema, readSchemaDoc, recordSkip, renderDiaries, renderReport, renderSchema, renderSchemaDoc, resetCursor, resolveApiKey, run, saveCursor, silentLogger, snapshotSchema, tick, touchRun, validateConfig, writeSchemaDoc };
