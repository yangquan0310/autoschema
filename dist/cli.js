#!/usr/bin/env node

// src/cli.ts
import path7 from "path";

// src/config.ts
import path3 from "path";

// src/constants.ts
import os from "os";
import path from "path";
var DEFAULT_AGENTS_FILE = path.join(os.homedir(), ".dsh", "AGENTS.md");
var DEFAULT_MEMORY_ROOT = path.join(os.homedir(), ".autobiomemory");
var DEFAULT_STATE_ROOT = path.join(os.homedir(), ".autoschema");

// src/util.ts
import fs from "fs";
import path2 from "path";
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}
function readTextFile(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return void 0;
  }
}
function writeTextAtomic(file, text) {
  ensureDir(path2.dirname(file));
  const tmp = path2.join(path2.dirname(file), `.${path2.basename(file)}.${process.pid}.${Date.now()}.tmp`);
  fs.writeFileSync(tmp, text, "utf8");
  fs.renameSync(tmp, file);
}
function readJsonFile(file) {
  const text = readTextFile(file);
  if (text === void 0) return void 0;
  try {
    return JSON.parse(text);
  } catch {
    return void 0;
  }
}
function writeJsonFile(file, value) {
  writeTextAtomic(file, `${JSON.stringify(value, null, 2)}
`);
}
function nowIso() {
  return (/* @__PURE__ */ new Date()).toISOString();
}
function timestampForFile(date = /* @__PURE__ */ new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${p(date.getMonth() + 1)}${p(date.getDate())}-${p(date.getHours())}${p(date.getMinutes())}${p(date.getSeconds())}`;
}
function truncate(text, max) {
  if (max <= 0) return "";
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1))}\u2026`;
}
function isRecord(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}
function parseDotEnv(text) {
  const out = {};
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim().replace(/^export\s+/u, "");
    let value = line.slice(eq + 1).trim();
    if (/^['"].*['"]$/u.test(value)) value = value.slice(1, -1);
    out[key] = value;
  }
  return out;
}
function resolveDeepseekKey(candidates) {
  const envValue = process.env.DEEPSEEK_API_KEY;
  if (envValue && envValue.trim() !== "") return envValue.trim();
  for (const file of candidates) {
    const text = readTextFile(file);
    if (text === void 0) continue;
    const value = parseDotEnv(text).DEEPSEEK_API_KEY;
    if (value && value.trim() !== "") return value.trim();
  }
  if (process.env.AUTOBIO_DEEPSEEK_API_KEY) return process.env.AUTOBIO_DEEPSEEK_API_KEY.trim();
  return void 0;
}
function maskSecret(value) {
  if (!value) return "(missing)";
  return value.length <= 8 ? `${value.slice(0, 2)}***` : `${value.slice(0, 4)}\u2026${value.slice(-4)}`;
}
var ORDER = { debug: 10, info: 20, warn: 30, error: 40 };
function createLogger(options = {}) {
  const threshold = ORDER[options.level ?? "info"];
  const emit = (level, message, args) => {
    if (ORDER[level] < threshold) return;
    const suffix = args.length > 0 ? ` ${args.map((a) => typeof a === "string" ? a : JSON.stringify(a)).join(" ")}` : "";
    process.stderr.write(`${nowIso()} ${level.toUpperCase().padEnd(5)} [autoschema] ${message}${suffix}
`);
  };
  return {
    debug: (m, ...a) => emit("debug", m, a),
    info: (m, ...a) => emit("info", m, a),
    warn: (m, ...a) => emit("warn", m, a),
    error: (m, ...a) => emit("error", m, a)
  };
}
function silentLogger() {
  const noop = () => {
  };
  return { debug: noop, info: noop, warn: noop, error: noop };
}

// src/config.ts
function defaultConfig() {
  return {
    version: 1,
    agentsFile: DEFAULT_AGENTS_FILE,
    memoryRoot: DEFAULT_MEMORY_ROOT,
    diaryLimit: 30,
    diaryChars: 1800,
    maxInputChars: 6e4,
    stateRoot: DEFAULT_STATE_ROOT,
    trigger: {
      modes: ["manual"],
      cooldownMs: 36e5,
      minNewDiaries: 5,
      applyMode: "propose",
      schedule: { intervalMinutes: 1440, skipIfOverdueMinutes: 720 },
      hook: { events: ["compaction/start"], cooldownMs: 18e5 }
    },
    digest: {
      limit: 30,
      onlyUndigested: true,
      diaryChars: 1800,
      maxInputChars: 6e4
    },
    deepseek: {
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      temperature: 0.3,
      maxTokens: 8e3,
      timeoutMs: 24e4,
      jsonMode: true,
      retries: 3
    }
  };
}
function merge(base, patch) {
  if (!patch) return structuredClone(base);
  const out = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (value === void 0) continue;
    const current = out[key];
    if (value !== null && typeof value === "object" && !Array.isArray(value) && current !== null && typeof current === "object" && !Array.isArray(current)) {
      out[key] = merge(current, value);
    } else {
      out[key] = value;
    }
  }
  return out;
}
function configFile(stateRoot) {
  return path3.join(stateRoot, "config.json");
}
function loadConfig(options = {}) {
  const base = defaultConfig();
  const patchRoot = options.patch?.stateRoot;
  const stateRoot = path3.resolve(
    options.stateRoot ?? (typeof patchRoot === "string" && patchRoot !== "" ? patchRoot : base.stateRoot)
  );
  const onDisk = readJsonFile(configFile(stateRoot));
  const merged = merge(merge(base, onDisk), options.patch);
  merged.stateRoot = stateRoot;
  merged.diaryChars = Math.round(clamp(merged.diaryChars, 200, 2e4));
  merged.maxInputChars = Math.round(clamp(merged.maxInputChars, 2e3, 4e5));
  merged.diaryLimit = Math.round(clamp(merged.diaryLimit, 1, 500));
  merged.deepseek.temperature = clamp(merged.deepseek.temperature, 0, 2);
  if (onDisk?.digest !== void 0) {
    merged.diaryLimit = merged.digest.limit;
    merged.diaryChars = merged.digest.diaryChars;
    merged.maxInputChars = merged.digest.maxInputChars;
  } else {
    merged.digest.limit = merged.diaryLimit;
    merged.digest.diaryChars = merged.diaryChars;
    merged.digest.maxInputChars = merged.maxInputChars;
  }
  merged.digest.limit = Math.round(clamp(merged.digest.limit, 1, 500));
  merged.digest.diaryChars = Math.round(clamp(merged.digest.diaryChars, 200, 2e4));
  merged.digest.maxInputChars = Math.round(clamp(merged.digest.maxInputChars, 2e3, 4e5));
  if (!Array.isArray(merged.trigger.modes) || merged.trigger.modes.length === 0) merged.trigger.modes = ["manual"];
  merged.trigger.cooldownMs = Math.max(0, merged.trigger.cooldownMs);
  merged.trigger.hook.cooldownMs = Math.max(0, merged.trigger.hook.cooldownMs);
  merged.trigger.minNewDiaries = Math.max(1, Math.round(merged.trigger.minNewDiaries));
  merged.trigger.schedule.intervalMinutes = Math.max(1, Math.round(merged.trigger.schedule.intervalMinutes));
  merged.agentsFile = path3.resolve(merged.agentsFile);
  merged.memoryRoot = path3.resolve(merged.memoryRoot);
  return merged;
}
function ensureConfigFile(config) {
  const file = configFile(config.stateRoot);
  ensureDir(config.stateRoot);
  if (readJsonFile(file) === void 0) {
    const { deepseek: _deepseek, ...persisted } = config;
    writeJsonFile(file, persisted);
  }
  return file;
}
function validateConfig(config) {
  const problems = [];
  if (!Number.isFinite(config.diaryLimit) || config.diaryLimit < 1) problems.push("diaryLimit \u5FC5\u987B \u2265 1");
  if (!/^https?:\/\//u.test(config.deepseek.baseUrl)) problems.push("deepseek.baseUrl \u5FC5\u987B\u662F http(s)");
  if (!config.deepseek.model) problems.push("deepseek.model \u4E0D\u80FD\u4E3A\u7A7A");
  const allowedModes = ["manual", "schedule", "hook"];
  if (!config.trigger.modes.every((mode) => allowedModes.includes(mode))) {
    problems.push("trigger.modes \u53EA\u80FD\u662F manual / schedule / hook");
  }
  if (config.trigger.modes.includes("schedule") && config.trigger.schedule.intervalMinutes < 1) {
    problems.push("trigger.schedule.intervalMinutes \u5FC5\u987B \u2265 1");
  }
  const allowedHooks = ["compaction/start", "agent/pre-step", "agent/idle", "session/start"];
  if (!config.trigger.hook.events.every((event) => allowedHooks.includes(event))) {
    problems.push("trigger.hook.events \u53EA\u80FD\u53D6 compaction/start\u3001agent/pre-step\u3001agent/idle\u3001session/start");
  }
  if (config.trigger.modes.includes("hook") && config.trigger.hook.events.length === 0) {
    problems.push('hook \u6A21\u5F0F\u4E0B trigger.hook.events \u4E0D\u80FD\u4E3A\u7A7A\uFF08\u8981\u6302"\u7279\u5B9A\u7684"\u751F\u547D\u5468\u671F\u70B9\uFF09');
  }
  if (config.trigger.applyMode !== "propose" && config.trigger.applyMode !== "apply") {
    problems.push("trigger.applyMode \u53EA\u80FD\u662F propose \u6216 apply");
  }
  return problems;
}
function resolveApiKey(config) {
  return resolveDeepseekKey([
    path3.join(config.stateRoot, ".env"),
    path3.join(process.env.HOME ?? "", ".dsh", ".env"),
    path3.join(config.memoryRoot, ".env")
  ]);
}

// src/deepseek.ts
var DeepseekError = class extends Error {
  status;
  body;
  constructor(message, options = {}) {
    super(message);
    this.name = "DeepseekError";
    this.status = options.status;
    this.body = options.body;
  }
};
var RETRYABLE = (status) => status === 429 || status >= 500;
var DeepseekClient = class {
  constructor(config, apiKey, logger = silentLogger()) {
    this.config = config;
    this.apiKey = apiKey;
    this.logger = logger;
  }
  config;
  apiKey;
  logger;
  endpoint() {
    return `${this.config.baseUrl.replace(/\/+$/u, "")}/chat/completions`;
  }
  async chat(messages) {
    const attempts = Math.max(0, this.config.retries) + 1;
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.config.timeoutMs);
      try {
        const response = await fetch(this.endpoint(), {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
          body: JSON.stringify({
            model: this.config.model,
            messages,
            temperature: this.config.temperature,
            max_tokens: this.config.maxTokens,
            stream: false,
            ...this.config.jsonMode ? { response_format: { type: "json_object" } } : {}
          }),
          signal: controller.signal
        });
        if (!response.ok) {
          const text = truncate(await response.text().catch(() => ""), 600);
          const error = new DeepseekError(`DeepSeek HTTP ${response.status}`, { status: response.status, body: text });
          if (!RETRYABLE(response.status) || attempt >= attempts) throw error;
          lastError = error;
        } else {
          const payload = await response.json();
          const content = payload.choices?.[0]?.message?.content;
          if (typeof content === "string" && content.trim() !== "") return content;
          const error = new DeepseekError("DeepSeek \u8FD4\u56DE\u7A7A\u5185\u5BB9");
          if (attempt >= attempts) throw error;
          lastError = error;
        }
      } catch (error) {
        if (error instanceof DeepseekError) {
          if (!error.status || !RETRYABLE(error.status) || attempt >= attempts) throw error;
          lastError = error;
        } else {
          const wrapped = new DeepseekError(`DeepSeek \u8BF7\u6C42\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`);
          if (attempt >= attempts) throw wrapped;
          lastError = wrapped;
        }
      } finally {
        clearTimeout(timer);
      }
      const delay = 250 * 2 ** (attempt - 1);
      this.logger.warn(`DeepSeek \u5931\u8D25\uFF0C${delay}ms \u540E\u91CD\u8BD5\uFF08\u7B2C ${attempt}/${attempts} \u6B21\uFF09`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
    throw lastError ?? new DeepseekError("DeepSeek \u8C03\u7528\u5931\u8D25");
  }
};

// src/diaries.ts
import fs2 from "fs";
import path4 from "path";
function eventsDir(memoryRoot) {
  return path4.join(memoryRoot, "events");
}
function listEventIds(memoryRoot) {
  const dir = eventsDir(memoryRoot);
  let names = [];
  try {
    names = fs2.readdirSync(dir);
  } catch {
    return [];
  }
  return names.filter((name) => name.endsWith(".json") && !name.startsWith("_")).map((name) => name.slice(0, -".json".length));
}
function readDiary(memoryRoot, eventId) {
  const json = readJsonFile(path4.join(eventsDir(memoryRoot), `${eventId}.json`));
  if (json === void 0) return void 0;
  const md = readTextFile(path4.join(eventsDir(memoryRoot), `${eventId}.md`));
  const diary = (md ?? json.diary ?? "").trim();
  if (diary === "") return void 0;
  const structured = json.structured ?? {};
  return {
    eventId: json.id ?? eventId,
    occurredAt: structured.startedAt ?? "",
    endedAt: structured.endedAt ?? "",
    title: structured.title ?? "(\u65E0\u6807\u9898)",
    status: structured.outcome?.status ?? "ongoing",
    tags: Array.isArray(structured.tags) ? structured.tags.filter((t) => typeof t === "string") : [],
    people: Array.isArray(structured.people) ? structured.people.map((p) => p?.name ?? "").filter((name) => name !== "") : [],
    diary
  };
}
function collectDiaries(memoryRoot, query) {
  const entries = [];
  for (const id of listEventIds(memoryRoot)) {
    const entry = readDiary(memoryRoot, id);
    if (entry !== void 0) entries.push(entry);
  }
  const timeOf = (entry) => {
    const parsed = Date.parse(entry.occurredAt);
    if (!Number.isNaN(parsed)) return parsed;
    const fromId = /^ev_(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})/u.exec(entry.eventId);
    if (fromId !== null) {
      const [, y, mo, d, h, mi, s] = fromId;
      return Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h) - 8, Number(mi), Number(s));
    }
    return 0;
  };
  const sinceMs = query.since === void 0 ? void 0 : Date.parse(query.since);
  const sorted = entries.filter((entry) => sinceMs === void 0 || Number.isNaN(sinceMs) ? true : timeOf(entry) >= sinceMs).sort((a, b) => timeOf(b) - timeOf(a));
  const selected = [];
  let budget = query.maxChars;
  for (const entry of sorted) {
    if (selected.length >= query.limit) break;
    if (budget <= 0) break;
    const body = truncate(entry.diary, query.diaryChars);
    selected.push({ ...entry, diary: body });
    budget -= body.length + 200;
  }
  return selected;
}
function renderDiaries(entries) {
  return entries.map((entry) => {
    const head = `### ${entry.occurredAt || "(\u65E0\u65F6\u95F4)"} \xB7 ${entry.title} \xB7 ${entry.status}`;
    const meta = [`\u4E8B\u4EF6 ID\uFF1A${entry.eventId}`];
    if (entry.tags.length > 0) meta.push(`\u6807\u7B7E\uFF1A${entry.tags.join("\u3001")}`);
    if (entry.people.length > 0) meta.push(`\u4EBA\u7269\uFF1A${entry.people.join("\u3001")}`);
    return [head, meta.join("\u3000|\u3000"), "", entry.diary].join("\n");
  }).join("\n\n---\n\n");
}

// src/reconcile.ts
import fs3 from "fs";
import path6 from "path";

// src/types.ts
var SECTION_LABELS = {
  style: "\u98CE\u683C",
  belief: "\u4FE1\u5FF5",
  value: "\u4EF7\u503C\u89C2"
};

// src/agents-md.ts
var HEADING_PATTERNS = [
  { section: "style", pattern: /^#{1,3}\s*风格/u },
  { section: "belief", pattern: /^#{1,3}\s*信念/u },
  { section: "value", pattern: /^#{1,3}\s*价值观/u },
  { section: "style", pattern: /^#{1,3}\s*style\b/iu },
  { section: "belief", pattern: /^#{1,3}\s*beliefs?\b/iu },
  { section: "value", pattern: /^#{1,3}\s*values?\b/iu }
];
var BULLET = /^[-*+]\s+(.*)$/u;
function sectionOfHeading(line) {
  for (const { section, pattern } of HEADING_PATTERNS) {
    if (pattern.test(line)) return section;
  }
  return void 0;
}
function emptyDoc(raw) {
  return { style: [], belief: [], value: [], preamble: { style: [], belief: [], value: [] }, extra: [], raw };
}
function parseSchemaDoc(raw) {
  const doc = emptyDoc(raw);
  let current;
  for (const line of raw.split(/\r?\n/u)) {
    const heading = sectionOfHeading(line);
    if (heading !== void 0) {
      current = heading;
      doc.extra.push(line);
      continue;
    }
    if (current === void 0) {
      if (line.trim() !== "") doc.extra.push(line);
      continue;
    }
    if (/^#{1,6}\s/u.test(line)) {
      current = void 0;
      doc.extra.push(line);
      continue;
    }
    const bullet = BULLET.exec(line);
    if (bullet !== null) {
      const item = (bullet[1] ?? "").trim();
      if (item !== "") doc[current].push(item);
      continue;
    }
    if (line.trim().startsWith(">")) {
      doc.preamble[current].push(line.trimEnd());
      continue;
    }
    if (line.trim() !== "") doc.preamble[current].push(line.trimEnd());
  }
  return doc;
}
function headingFor(section, raw) {
  const found = raw.split(/\r?\n/u).find((line) => sectionOfHeading(line) === section);
  return found ?? `# ${SECTION_LABELS[section]}`;
}
function renderSchemaDoc(doc) {
  const headings = new Set(doc.extra.filter((line) => sectionOfHeading(line) !== void 0));
  const sections = ["style", "belief", "value"];
  const hasHeadings = headings.size > 0;
  const lines = [];
  for (const line of doc.extra) {
    if (sectionOfHeading(line) !== void 0) break;
    lines.push(line);
  }
  if (!hasHeadings) {
    for (const section of sections) {
      const items = doc[section];
      if (items.length === 0 && doc.preamble[section].length === 0) continue;
      lines.push(headingFor(section, doc.raw), "");
      lines.push(...doc.preamble[section]);
      if (doc.preamble[section].length > 0) lines.push("");
      for (const item of items) lines.push(`- ${item}`);
      lines.push("");
    }
    return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}
`;
  }
  for (const section of sections) {
    const items = doc[section];
    const preamble = doc.preamble[section];
    if (items.length === 0 && preamble.length === 0) continue;
    lines.push(headingFor(section, doc.raw), "");
    lines.push(...preamble);
    if (preamble.length > 0) lines.push("");
    for (const item of items) lines.push(`- ${item}`);
    lines.push("");
  }
  const trailing = [];
  let seenSection = false;
  for (const line of doc.extra) {
    const heading = sectionOfHeading(line);
    if (heading !== void 0) {
      seenSection = true;
      continue;
    }
    if (seenSection) trailing.push(line);
  }
  if (trailing.length > 0) {
    lines.push(...trailing);
    lines.push("");
  }
  return `${lines.join("\n").replace(/\n{3,}/gu, "\n\n").trimEnd()}
`;
}
function writeSchemaDoc(file, doc) {
  const rendered = renderSchemaDoc(doc);
  writeTextAtomic(file, rendered);
  return rendered;
}
function normalise(text) {
  return text.replace(/\s+/gu, "").replace(/[。，、；：""''（）()]/gu, "").toLowerCase();
}
function findClosestIndex(items, target) {
  const wanted = normalise(target);
  if (wanted === "") return -1;
  let best = -1;
  let bestScore = 0;
  items.forEach((item, index) => {
    const candidate = normalise(item);
    let score = 0;
    if (candidate === wanted) score = 1;
    else if (candidate.includes(wanted) || wanted.includes(candidate)) {
      score = Math.min(candidate.length, wanted.length) / Math.max(candidate.length, wanted.length);
    } else {
      const chars = new Set(candidate);
      let shared = 0;
      for (const char of new Set(wanted)) if (chars.has(char)) shared += 1;
      score = shared / Math.max(1, Math.min(chars.size, new Set(wanted).size));
    }
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  return bestScore >= 0.5 ? best : -1;
}
function applyChanges(doc, assimilation, accommodation, options = {}) {
  const next = structuredClone(doc);
  const skipped = [];
  let appliedAssimilation = 0;
  let appliedAccommodation = 0;
  for (const item of assimilation) {
    const items = next[item.area];
    const revised = item.revised.trim();
    if (revised === "") {
      skipped.push(`\u540C\u5316\u6761\u76EE\u4E3A\u7A7A\uFF1A${item.target}`);
      continue;
    }
    let index = findClosestIndex(items, item.target);
    if (index < 0) index = findClosestIndex(items, item.revised);
    if (index < 0) {
      skipped.push(`\u540C\u5316\u627E\u4E0D\u5230\u76EE\u6807\uFF08${SECTION_LABELS[item.area]}\uFF09\uFF1A${item.target}`);
      continue;
    }
    const before = items[index] ?? "";
    if (normalise(before) === normalise(revised)) {
      skipped.push(`\u540C\u5316\u540E\u4E0E\u539F\u6761\u76EE\u76F8\u540C\uFF0C\u8DF3\u8FC7\uFF1A${before}`);
      continue;
    }
    items[index] = revised;
    appliedAssimilation += 1;
  }
  for (const item of accommodation) {
    const text = item.text.trim();
    if (text === "") {
      skipped.push("\u987A\u5E94\u6761\u76EE\u4E3A\u7A7A");
      continue;
    }
    const items = next[item.area];
    if (items.some((existing) => normalise(existing) === normalise(text))) {
      skipped.push(`\u987A\u5E94\u6761\u76EE\u5DF2\u5B58\u5728\uFF1A${text}`);
      continue;
    }
    items.push(text);
    appliedAccommodation += 1;
  }
  void options;
  return { doc: next, applied: { assimilation: appliedAssimilation, accommodation: appliedAccommodation }, skipped };
}

// src/cursor.ts
import path5 from "path";
var VERSION = 1;
function cursorFile(stateRoot) {
  return path5.join(stateRoot, "state", "cursor.json");
}
function emptyCursor() {
  return { version: VERSION, digested: {}, proposed: {} };
}
function loadCursor(stateRoot) {
  const raw = readJsonFile(cursorFile(stateRoot));
  if (raw === void 0 || typeof raw !== "object" || typeof raw.digested !== "object" || raw.digested === null) {
    return emptyCursor();
  }
  return {
    ...emptyCursor(),
    ...raw,
    version: VERSION,
    digested: raw.digested ?? {},
    proposed: raw.proposed ?? {}
  };
}
function saveCursor(stateRoot, cursor) {
  ensureDir(path5.join(stateRoot, "state"));
  writeJsonFile(cursorFile(stateRoot), { ...cursor, version: VERSION });
}
function isDigested(cursor, eventId) {
  return cursor.digested[eventId] !== void 0;
}
function isPending(cursor, eventId) {
  return cursor.proposed[eventId] !== void 0;
}
function isSettled(cursor, eventId) {
  return isDigested(cursor, eventId) || isPending(cursor, eventId);
}
function filterUndigested(cursor, entries) {
  return entries.filter((entry) => !isSettled(cursor, entry.eventId));
}
function countUndigested(cursor, eventIds) {
  return eventIds.reduce((sum, id) => isSettled(cursor, id) ? sum : sum + 1, 0);
}
function markDigested(cursor, eventIds, runId = nowIso()) {
  const digested = { ...cursor.digested };
  const proposed = { ...cursor.proposed };
  const at = nowIso();
  for (const eventId of eventIds) {
    digested[eventId] = { at, runId };
    delete proposed[eventId];
  }
  return { ...cursor, digested, proposed, lastRunAt: at, lastRunId: runId, skippedRuns: 0 };
}
function markProposed(cursor, eventIds, runId = nowIso()) {
  const proposed = { ...cursor.proposed };
  const at = nowIso();
  for (const eventId of eventIds) if (cursor.digested[eventId] === void 0) proposed[eventId] = { at, runId };
  return { ...cursor, proposed, lastRunAt: at, lastRunId: runId, skippedRuns: 0 };
}
function markRun(cursor, runId = nowIso()) {
  return { ...cursor, lastRunAt: nowIso(), lastRunId: runId };
}
function msSinceLastRun(cursor, now = Date.now()) {
  if (cursor.lastRunAt === void 0) return Number.POSITIVE_INFINITY;
  const parsed = Date.parse(cursor.lastRunAt);
  return Number.isNaN(parsed) ? Number.POSITIVE_INFINITY : now - parsed;
}
function resetCursor(stateRoot) {
  saveCursor(stateRoot, emptyCursor());
}

// src/prompt.ts
var ANALYSIS_GUIDE = `\u4F60\u662F\u6211\u7684\u300C\u81EA\u6211\u56FE\u5F0F\u300D\u5206\u6790\u5E08\u3002\u6211\u7528\u76AE\u4E9A\u6770\u7684\u53D1\u751F\u8BA4\u8BC6\u8BBA\u6765\u7EF4\u62A4\u81EA\u5DF1\u7684\u4EBA\u683C\u8BBE\u5B9A\uFF1A

- **\u56FE\u5F0F\uFF08schema\uFF09**\uFF1A\u6211\u7684 \`AGENTS.md\` \u91CC\u7684\u300C\u98CE\u683C / \u4FE1\u5FF5 / \u4EF7\u503C\u89C2\u300D\u4E09\u8282\uFF0C\u5C31\u662F\u6211\u7684\u81EA\u6211\u56FE\u5F0F\u3002
- **\u7ECF\u9A8C**\uFF1A\u6211\u7684\u65E5\u8BB0\uFF08AutoBioMemory \u8BB0\u4E0B\u7684\u3001\u6211\u5B9E\u9645\u600E\u4E48\u60F3\u600E\u4E48\u505A\u7684\u7B2C\u4E00\u4EBA\u79F0\u8BB0\u5F55\uFF09\u3002
- **\u975E\u5E73\u8861\uFF08disequilibrium\uFF09**\uFF1A\u65E5\u8BB0\u91CC"\u6211\u5B9E\u9645\u8FD9\u6837\u505A\u4E86"\u4E0E\u56FE\u5F0F\u91CC"\u6211\u4EE5\u4E3A\u6211\u662F\u8C01"\u4E0D\u4E00\u81F4\u6240\u5F15\u53D1\u7684\u5F20\u529B\u3002
- **\u540C\u5316\uFF08assimilation\uFF09**\uFF1A\u6539\u52A8\u5DF2\u6709\u8981\u70B9\uFF0C\u8BA9\u65E7\u56FE\u5F0F\u5BB9\u7EB3\u65B0\u7ECF\u9A8C\u2014\u2014\u56FE\u5F0F\u7ED3\u6784\u4E0D\u53D8\uFF0C\u63AA\u8F9E/\u8FB9\u754C\u88AB\u4FEE\u8BA2\u3002
- **\u987A\u5E94\uFF08accommodation\uFF09**\uFF1A\u65B0\u589E\u8981\u70B9\uFF08\u5FC5\u8981\u65F6\u8C03\u6574\u539F\u6709\u6761\u76EE\u7684\u8FB9\u754C\uFF09\uFF0C\u8BA9\u56FE\u5F0F\u672C\u8EAB\u88AB\u6539\u5199\u4EE5\u9002\u5E94\u7ECF\u9A8C\u3002
- **\u5E73\u8861\uFF08equilibration\uFF09**\uFF1A\u51B2\u7A81\u88AB\u6D88\u5316\u540E\uFF0C\u56FE\u5F0F\u4E0E\u7ECF\u9A8C\u91CD\u65B0\u81EA\u6D3D\u3002

## \u4F60\u8981\u505A\u7684\u5224\u65AD

1. **\u53EA\u4F9D\u636E\u65E5\u8BB0\u8BC1\u636E**\uFF1A\u6BCF\u6761\u7ED3\u8BBA\u90FD\u5FC5\u987B\u80FD\u6307\u5411\u5177\u4F53\u4E8B\u4EF6 ID \u4E0E\u65E5\u8BB0\u539F\u8BDD\u3002\u6CA1\u6709\u8BC1\u636E\u5C31\u4E0D\u8981\u63D0\u3002
2. **\u4E09\u8282\u5404\u7BA1\u4EC0\u4E48**\uFF08\u4E0D\u8981\u4E32\u5473\uFF09\uFF1A
   - \`${SECTION_LABELS.style}\`\uFF08style\uFF09\uFF1A\u600E\u4E48\u505A\u4E8B\uFF0C**\u5916\u5728\u884C\u4E3A\u53EF\u89C2\u5BDF**\u2014\u2014\u5148\u7ED9\u7ED3\u8BBA\u8FD8\u662F\u5148\u94FA\u80CC\u666F\u3001\u52A8\u624B\u524D\u662F\u5426\u590D\u8FF0\u9700\u6C42\u3001\u9047\u5230\u4E0D\u786E\u5B9A\u5148\u95EE\u8FD8\u662F\u5148\u731C\u3001\u62A5\u544A\u5BC6\u5EA6\u4E0E\u683C\u5F0F\u7B49\u3002
   - \`${SECTION_LABELS.belief}\`\uFF08belief\uFF09\uFF1A\u4FE1\u4EC0\u4E48\uFF0C**\u5185\u5728\u4EF7\u503C\u539F\u5219**\u2014\u2014\u5BF9"\u4E0D\u77E5\u9053"\u7684\u6001\u5EA6\u3001\u5BF9\u9A8C\u8BC1\u7684\u8981\u6C42\u3001\u5BF9\u98CE\u9669\u4E0E\u8BDA\u5B9E\u7684\u4E3B\u5F20\u7B49\u3002
   - \`${SECTION_LABELS.value}\`\uFF08value\uFF09\uFF1A\u51B2\u7A81\u65F6\u7684**\u6392\u5E8F**\u2014\u2014\u5F53\u4E24\u79CD\u597D\u5904\u4E0D\u53EF\u517C\u5F97\u65F6\u6211\u5148\u4FDD\u54EA\u4E2A\uFF08\u5982 \u5B89\u5168 > \u8FDB\u5EA6\u3001\u4E8B\u5B9E > \u9762\u5B50\u3001\u957F\u671F > \u77ED\u671F\uFF09\u3002
3. **\u533A\u5206"\u5076\u53D1"\u4E0E"\u6A21\u5F0F"**\uFF1A\u53EA\u628A**\u53CD\u590D\u51FA\u73B0**\uFF08\u22652 \u6B21\u6216\u6784\u6210\u660E\u663E\u4E00\u8D2F\u6027\uFF09\u7684\u884C\u4E3A\u4E0A\u5347\u4E3A\u56FE\u5F0F\u6539\u52A8\uFF1B\u4E00\u6B21\u6027\u7684\u5076\u7136\u5931\u8BEF\u6700\u591A\u5199\u8FDB notes\u3002
4. **\u540C\u5316\u4F18\u5148\uFF0C\u987A\u5E94\u514B\u5236**\uFF1A\u80FD\u7528\u73B0\u6709\u8981\u70B9\u7684\u4FEE\u8BA2\u89E3\u91CA\u8FC7\u53BB\u7684\uFF0C\u5C31\u4E0D\u8981\u65B0\u589E\uFF1B\u65B0\u589E\u53EA\u5728"\u73B0\u6709\u56FE\u5F0F\u786E\u5B9E\u6CA1\u6709\u8FD9\u4E00\u7EF4"\u65F6\u53D1\u751F\u3002\u65B0\u589E\u603B\u91CF\u5EFA\u8BAE \u2264 3 \u6761\u3002
5. **\u4E0D\u8981\u7F8E\u5316**\uFF1A\u65E5\u8BB0\u91CC\u7684\u5931\u8D25\u3001\u56DE\u907F\u3001\u62D6\u5EF6\u3001\u8FC7\u5EA6\u81EA\u4FE1\u90FD\u8981\u5982\u5B9E\u5BF9\u7167\u56FE\u5F0F\u3002\u5982\u679C\u56FE\u5F0F\u5199\u5F97\u5F88\u6F02\u4EAE\u4F46\u65E5\u8BB0\u91CC\u957F\u671F\u505A\u4E0D\u5230\uFF0C\u8FD9\u672C\u8EAB\u5C31\u662F\u6700\u5F3A\u7684\u975E\u5E73\u8861\u3002
6. **\u7A7A\u56FE\u5F0F\u7684\u60C5\u5F62**\uFF1A\u5982\u679C\u67D0\u4E00\u8282\u73B0\u5728\u6CA1\u6709\u4EFB\u4F55\u6761\u76EE\uFF0C\u90A3\u4E48\u65E5\u8BB0\u91CC\u53CD\u590D\u51FA\u73B0\u7684\u884C\u4E3A\u5C31\u662F**\u987A\u5E94**\u7684\u4E3B\u8981\u6765\u6E90\uFF0C\u6B64\u65F6\u975E\u5E73\u8861\u7684 \`against\` \u8BB0\u4E3A\u300C\uFF08\u8BE5\u8282\u4E3A\u7A7A\uFF09\u300D\u3002

## \u8F93\u51FA\u7684\u54C1\u5473

- \`observed\` \u8981\u5177\u4F53\u5230"\u6211\u5728\u4EC0\u4E48\u60C5\u5883\u4E0B\u505A\u4E86\u4EC0\u4E48"\uFF0C\u4E0D\u662F\u5F62\u5BB9\u8BCD\u3002
- \`against\` \u8981\u5F15\u7528\u56FE\u5F0F\u539F\u6587\uFF08\u6216\u6807\u51FA\u8BE5\u8282\u4E3A\u7A7A\uFF09\u3002
- \`conflict\` \u8981\u8BB2\u6E05\u4E3A\u4EC0\u4E48\u8FD9\u6784\u6210\u5F20\u529B\uFF0C\u800C\u4E0D\u662F\u91CD\u590D observed\u3002
- \u540C\u5316\u7684 \`revised\` \u8981\u662F\u53EF\u4EE5\u76F4\u63A5\u66FF\u6362\u8FDB AGENTS.md \u7684\u4E00\u53E5\u8BDD\uFF0C\u7B2C\u4E00\u4EBA\u79F0\u3001\u53EF\u89C2\u5BDF\u3001\u53EF\u6267\u884C\uFF1B\u4E0D\u8981\u5199\u6210\u53E3\u53F7\u3002
- \u987A\u5E94\u7684 \`text\` \u540C\u7406\uFF0C\u4E00\u53E5\u8BDD\uFF0C\u4E14\u4E0D\u8981\u548C\u5DF2\u6709\u6761\u76EE\u8BED\u4E49\u91CD\u590D\u3002

## \u53EA\u5728 JSON \u91CC\u56DE\u7B54

- \`equilibriumScore\`\uFF1A0~1\uFF0C\u8D8A\u9AD8\u8868\u793A\u56FE\u5F0F\u4E0E\u7ECF\u9A8C\u8D8A\u81EA\u6D3D\uFF08\u4E09\u8282\u90FD\u4E3A\u7A7A\u65F6\u5E94\u504F\u4F4E\uFF0C\u56E0\u4E3A\u5C1A\u672A\u786E\u7ACB\u81EA\u6211\u63CF\u8FF0\uFF09\u3002
- \u53EA\u8F93\u51FA JSON\uFF0C\u4E0D\u8981 markdown \u4EE3\u7801\u5757\uFF0C\u4E0D\u8981\u89E3\u91CA\u6587\u5B57\u3002`;
var RESPONSE_CONTRACT = `## \u54CD\u5E94\u5951\u7EA6

{
  "equilibriumScore": 0.42,
  "summary": "\u4E00\u53E5\u8BDD\uFF1A\u5F53\u524D\u56FE\u5F0F\u4E0E\u8FD9\u6BB5\u65F6\u95F4\u7684\u7ECF\u9A8C\u4E4B\u95F4\uFF0C\u6700\u4E3B\u8981\u7684\u5F20\u529B\u662F\u4EC0\u4E48",
  "disequilibrium": [
    {
      "area": "style | belief | value",
      "observed": "\u65E5\u8BB0\u91CC\u6211\u5B9E\u9645\u7684\u884C\u4E3A\uFF08\u5177\u4F53\u60C5\u5883\uFF09",
      "against": "\u4E0E\u56FE\u5F0F\u91CC\u7684\u54EA\u6761\u8981\u70B9\u51B2\u7A81\uFF1B\u8BE5\u8282\u4E3A\u7A7A\u65F6\u5199\u300C\uFF08\u8BE5\u8282\u4E3A\u7A7A\uFF09\u300D",
      "conflict": "\u4E3A\u4EC0\u4E48\u8FD9\u6784\u6210\u975E\u5E73\u8861",
      "severity": "low | medium | high",
      "evidence": [{ "eventId": "ev_...", "title": "\u4E8B\u4EF6\u6807\u9898", "quote": "\u65E5\u8BB0\u91CC\u7684\u539F\u8BDD\u7247\u6BB5" }]
    }
  ],
  "assimilation": [
    {
      "area": "style | belief | value",
      "target": "\u8981\u4FEE\u8BA2\u7684\u73B0\u6709\u8981\u70B9\u539F\u6587\uFF08\u5FC5\u987B\u80FD\u5728\u8BE5\u8282\u91CC\u627E\u5230\uFF0C\u5426\u5219\u6B64\u6761\u4F1A\u88AB\u4E22\u5F03\uFF09",
      "revised": "\u4FEE\u8BA2\u540E\u7684\u4E00\u53E5\u8BDD\uFF0C\u7B2C\u4E00\u4EBA\u79F0\u3001\u53EF\u89C2\u5BDF\u3001\u53EF\u6267\u884C",
      "why": "\u4E3A\u4EC0\u4E48\u8FD9\u6837\u6539\u800C\u4E0D\u662F\u65B0\u589E",
      "evidence": [{ "eventId": "ev_...", "title": "...", "quote": "..." }]
    }
  ],
  "accommodation": [
    {
      "area": "style | belief | value",
      "text": "\u65B0\u589E\u7684\u4E00\u53E5\u8BDD\u8981\u70B9",
      "why": "\u73B0\u6709\u56FE\u5F0F\u7F3A\u4E86\u54EA\u4E00\u7EF4",
      "evidence": [{ "eventId": "ev_...", "title": "...", "quote": "..." }]
    }
  ],
  "notes": "\u7591\u8651\u3001\u8BC1\u636E\u4E0D\u8DB3\u5904\u3001\u4E00\u6B21\u6027\u5076\u53D1\u4E8B\u4EF6\uFF08\u4E0D\u8FDB\u56FE\u5F0F\uFF09"
}

\u7EA6\u675F\uFF1A
- area \u53EA\u7528 style / belief / value \u4E09\u4E2A\u503C\u3002
- assimilation.target \u5FC5\u987B\u9010\u5B57\u53D6\u81EA\u8BE5\u8282\u73B0\u6709\u6761\u76EE\uFF0C\u5426\u5219\u8FD9\u6761\u4F1A\u88AB\u7CFB\u7EDF\u4E22\u5F03\u3002
- \u6CA1\u6709\u628A\u63E1\u7684\u6761\u76EE\u5B81\u53EF\u653E\u5728 notes \u91CC\uFF0C\u4E5F\u4E0D\u8981\u7F16\u9020\u3002
- \u53EA\u8F93\u51FA JSON\u3002`;
var AnalysisError = class extends Error {
  detail;
  constructor(message, detail = "") {
    super(message);
    this.name = "AnalysisError";
    this.detail = detail;
  }
};
function asString(value, fallback = "") {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed === "" ? fallback : trimmed;
}
function asSection(value) {
  const text = asString(value).toLowerCase();
  if (text === "style" || text === "belief" || text === "value") return text;
  if (text === "\u98CE\u683C") return "style";
  if (text === "\u4FE1\u5FF5") return "belief";
  if (text === "\u4EF7\u503C\u89C2" || text === "\u4EF7\u503C") return "value";
  return void 0;
}
function asEvidence(value) {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((item) => ({
    eventId: asString(item.eventId),
    title: asString(item.title),
    ...asString(item.quote) === "" ? {} : { quote: asString(item.quote) }
  })).filter((item) => item.eventId !== "");
}
function asSeverity(value) {
  const text = asString(value).toLowerCase();
  return text === "high" || text === "medium" ? text : "low";
}
function normalizeAnalysis(value) {
  if (!isRecord(value)) throw new AnalysisError("\u54CD\u5E94\u4E0D\u662F JSON \u5BF9\u8C61");
  const disequilibrium = [];
  for (const raw of Array.isArray(value.disequilibrium) ? value.disequilibrium : []) {
    if (!isRecord(raw)) continue;
    const area = asSection(raw.area);
    const observed = asString(raw.observed);
    if (area === void 0 || observed === "") continue;
    disequilibrium.push({
      area,
      observed,
      against: asString(raw.against, "\uFF08\u8BE5\u8282\u4E3A\u7A7A\uFF09"),
      conflict: asString(raw.conflict),
      severity: asSeverity(raw.severity),
      evidence: asEvidence(raw.evidence)
    });
  }
  const assimilation = [];
  for (const raw of Array.isArray(value.assimilation) ? value.assimilation : []) {
    if (!isRecord(raw)) continue;
    const area = asSection(raw.area);
    const target = asString(raw.target);
    const revised = asString(raw.revised);
    if (area === void 0 || target === "" || revised === "") continue;
    assimilation.push({ area, target, revised, why: asString(raw.why), evidence: asEvidence(raw.evidence) });
  }
  const accommodation = [];
  for (const raw of Array.isArray(value.accommodation) ? value.accommodation : []) {
    if (!isRecord(raw)) continue;
    const area = asSection(raw.area);
    const text = asString(raw.text);
    if (area === void 0 || text === "") continue;
    accommodation.push({ area, text, why: asString(raw.why), evidence: asEvidence(raw.evidence) });
  }
  if (disequilibrium.length === 0 && assimilation.length === 0 && accommodation.length === 0) {
    const summary = asString(value.summary);
    if (summary === "") throw new AnalysisError("\u54CD\u5E94\u91CC\u6CA1\u6709\u4EFB\u4F55\u53EF\u7528\u6761\u76EE");
  }
  return {
    equilibriumScore: clamp(Number(value.equilibriumScore ?? 0) || 0, 0, 1),
    summary: asString(value.summary),
    disequilibrium,
    assimilation,
    accommodation,
    notes: asString(value.notes)
  };
}
function extractJsonObject(text) {
  const start = text.indexOf("{");
  if (start < 0) return void 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < text.length; i += 1) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return void 0;
}
function parseAnalysisResponse(text) {
  const body = text.replace(/^\uFEFF/u, "").trim();
  if (body === "") throw new AnalysisError("\u54CD\u5E94\u4E3A\u7A7A");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/u.exec(body);
  const candidate = extractJsonObject(fenced?.[1] ?? body) ?? (fenced?.[1] ?? body);
  let parsed;
  try {
    parsed = JSON.parse(candidate);
  } catch (error) {
    throw new AnalysisError(
      "\u54CD\u5E94\u4E0D\u662F\u5408\u6CD5 JSON",
      `${error instanceof Error ? error.message : String(error)} :: ${candidate.slice(0, 200)}`
    );
  }
  return normalizeAnalysis(parsed);
}
function renderSchema(doc) {
  const sections = ["style", "belief", "value"];
  return sections.map((section) => {
    const items = doc[section];
    const label = SECTION_LABELS[section];
    if (items.length === 0) return `## ${label}\uFF08${section}\uFF09
\uFF08\u5F53\u524D\u4E3A\u7A7A\uFF09`;
    return [`## ${label}\uFF08${section}\uFF09`, ...items.map((item, index) => `${index + 1}. ${item}`)].join("\n");
  }).join("\n\n");
}
function buildAnalysisRequest(request) {
  const system = [ANALYSIS_GUIDE, "", RESPONSE_CONTRACT].join("\n");
  const user = [
    "## \u6211\u7684\u5F53\u524D\u56FE\u5F0F\uFF08AGENTS.md\uFF09",
    renderSchema(request.doc),
    "",
    `## \u6211\u6700\u8FD1\u7684 ${request.diaries.length} \u7BC7\u65E5\u8BB0\uFF08\u6309\u65F6\u95F4\u5012\u5E8F\uFF09`,
    request.renderedDiaries,
    "",
    "\u8BF7\u5BF9\u7167\u4E0A\u8FF0\u65E5\u8BB0\uFF0C\u6307\u51FA\u975E\u5E73\u8861\uFF0C\u5E76\u7ED9\u51FA\u540C\u5316\uFF08\u6539\u8981\u70B9\uFF09\u4E0E\u987A\u5E94\uFF08\u65B0\u589E\u8981\u70B9\uFF09\u7684\u5177\u4F53\u5EFA\u8BAE\u3002\u53EA\u8F93\u51FA JSON\u3002"
  ].join("\n");
  return { system, user };
}

// src/reconcile.ts
function readSchema(config) {
  const raw = readTextFile(config.agentsFile) ?? "";
  return parseSchemaDoc(raw);
}
function gatherDiaries(config, limit, since) {
  return collectDiaries(config.memoryRoot, {
    limit: limit ?? config.diaryLimit,
    maxChars: config.maxInputChars,
    diaryChars: config.diaryChars,
    ...since ?? config.since ?? void 0 ? { since: since ?? config.since ?? void 0 } : {}
  });
}
function snapshotSchema(config, raw) {
  const historyDir = path6.join(config.stateRoot, "history");
  ensureDir(historyDir);
  const stamp = timestampForFile();
  let file = path6.join(historyDir, `AGENTS-${stamp}.md`);
  let counter = 1;
  while (fs3.existsSync(file)) {
    file = path6.join(historyDir, `AGENTS-${stamp}-${counter}.md`);
    counter += 1;
  }
  writeTextAtomic(file, raw);
  const logFile = path6.join(historyDir, "changelog.jsonl");
  const line = JSON.stringify({ at: nowIso(), file, chars: raw.length });
  fs3.appendFileSync(logFile, `${line}
`, "utf8");
  return file;
}
async function run(options) {
  const { config } = options;
  const logger = options.logger ?? createLogger();
  const dryRun = options.dryRun !== false;
  const before = readSchema(config);
  const onlyUndigested = options.onlyUndigested ?? config.digest.onlyUndigested;
  const cursor = loadCursor(config.stateRoot);
  const gathered = gatherDiaries(config, options.limit, options.since);
  const diaries = onlyUndigested ? filterUndigested(cursor, gathered) : gathered;
  const skippedDigested = gathered.length - diaries.length;
  if (diaries.length === 0) {
    throw new Error(
      gathered.length === 0 ? `\u6CA1\u6709\u53EF\u7528\u65E5\u8BB0\uFF1A${config.memoryRoot}/events \u4E3A\u7A7A\uFF0C\u6216 since/limit \u8FC7\u6EE4\u540E\u65E0\u5185\u5BB9\u3002\u5148\u8DD1\u4E00\u6B21 AutoBioMemory \u7684\u6574\u7406\u3002` : `\u6CA1\u6709"\u672A\u6D88\u5316"\u7684\u65E5\u8BB0\uFF08\u6700\u8FD1 ${gathered.length} \u7BC7\u90FD\u5DF2\u5438\u6536\uFF09\u3002\u7528 --all \u6216 digest.onlyUndigested=false \u91CD\u65B0\u5206\u6790\u5168\u90E8\u3002`
    );
  }
  logger.info(`\u56FE\u5F0F\uFF1A\u98CE\u683C ${before.style.length} / \u4FE1\u5FF5 ${before.belief.length} / \u4EF7\u503C\u89C2 ${before.value.length} \u6761\uFF1B\u65E5\u8BB0 ${diaries.length} \u7BC7`);
  const client = options.client ?? new DeepseekClient(config.deepseek, requireApiKey(config), logger);
  const renderedDiaries = renderDiaries(diaries);
  const { system, user } = buildAnalysisRequest({ doc: before, diaries, renderedDiaries });
  const raw = await client.chat([
    { role: "system", content: system },
    { role: "user", content: user }
  ]);
  const analysis = parseAnalysisResponse(raw);
  const merged = applyChanges(before, analysis.assimilation, analysis.accommodation);
  const rendered = renderSchemaDoc(merged.doc);
  let snapshot;
  let wrote = false;
  if (!dryRun && (merged.applied.assimilation > 0 || merged.applied.accommodation > 0)) {
    const original = readTextFile(config.agentsFile) ?? "";
    snapshot = snapshotSchema(config, original);
    writeSchemaDoc(config.agentsFile, merged.doc);
    wrote = true;
    logger.info(`\u5DF2\u5199\u56DE ${config.agentsFile}\uFF08\u5FEB\u7167\uFF1A${snapshot}\uFF09`);
  }
  const runId = options.runId ?? nowIso();
  const ids = diaries.map((entry) => entry.eventId);
  const proposedCount = analysis.assimilation.length + analysis.accommodation.length;
  let pendingSaved = false;
  if (options.markDigested !== false) {
    const next = wrote ? markDigested(cursor, ids, runId) : proposedCount > 0 ? markProposed(cursor, ids, runId) : markRun(cursor, runId);
    saveCursor(config.stateRoot, next);
    if (!wrote && proposedCount > 0) {
      writeJsonFile(pendingFile(config.stateRoot), { at: nowIso(), runId, analysis, eventIds: ids });
      pendingSaved = true;
    }
  }
  const result = {
    analysis,
    digestedIds: diaries.map((entry) => entry.eventId),
    skippedDigested,
    before,
    after: merged.doc,
    applied: merged.applied,
    skipped: merged.skipped,
    diaries,
    rendered,
    wrote,
    pendingSaved,
    ...snapshot === void 0 ? {} : { snapshot }
  };
  writeJsonFile(path6.join(config.stateRoot, "last-run.json"), {
    at: nowIso(),
    dryRun,
    equilibriumScore: analysis.equilibriumScore,
    diarised: diaries.length,
    applied: merged.applied,
    skipped: merged.skipped,
    wrote
  });
  return result;
}
function requireApiKey(config) {
  const key = resolveApiKey(config);
  if (key === void 0 || key === "") {
    throw new Error(
      "\u7F3A\u5C11 DEEPSEEK_API_KEY\uFF1A\u8BF7\u5199\u5165 ~/.dsh/.env\u3001~/.autobiomemory/.env \u6216 ~/.autoschema/.env\uFF0C\u6216\u7528\u73AF\u5883\u53D8\u91CF\u63D0\u4F9B\u3002"
    );
  }
  return key;
}
function pendingFile(stateRoot) {
  return path6.join(stateRoot, "state", "pending.json");
}
function loadPending(config) {
  return readJsonFile(pendingFile(config.stateRoot));
}
function clearPending(config) {
  try {
    fs3.rmSync(pendingFile(config.stateRoot));
  } catch {
  }
}
function applyProposal(config, proposal, options = {}) {
  const before = readSchema(config);
  const merged = applyChanges(before, proposal.analysis.assimilation, proposal.analysis.accommodation);
  const rendered = renderSchemaDoc(merged.doc);
  let snapshot;
  if (merged.applied.assimilation + merged.applied.accommodation > 0) {
    snapshot = snapshotSchema(config, readTextFile(config.agentsFile) ?? "");
    writeSchemaDoc(config.agentsFile, merged.doc);
  }
  const cursor = loadCursor(config.stateRoot);
  saveCursor(config.stateRoot, markDigested(cursor, proposal.eventIds, options.runId ?? proposal.runId));
  clearPending(config);
  return {
    after: merged.doc,
    applied: merged.applied,
    skipped: merged.skipped,
    rendered,
    ...snapshot === void 0 ? {} : { snapshot }
  };
}
function renderReport(result) {
  const { analysis, applied, skipped } = result;
  const lines = [];
  const pct = Math.round(analysis.equilibriumScore * 100);
  lines.push(`\u5E73\u8861\u5EA6\uFF1A${pct}%\uFF080=\u5B8C\u5168\u51B2\u7A81\uFF0C100=\u5B8C\u5168\u81EA\u6D3D\uFF09`);
  if (analysis.summary !== "") lines.push(`\u603B\u89C8\uFF1A${analysis.summary}`);
  lines.push("");
  lines.push(`\u975E\u5E73\u8861 ${analysis.disequilibrium.length} \u6761`);
  for (const item of analysis.disequilibrium) {
    lines.push(`  \xB7 [${SECTION_LABELS[item.area]}\xB7${item.severity}] ${item.observed}`);
    lines.push(`    \u51B2\u7A81\u5BF9\u8C61\uFF1A${item.against}`);
    if (item.conflict !== "") lines.push(`    \u5F20\u529B\uFF1A${item.conflict}`);
    for (const evidence of item.evidence.slice(0, 3)) {
      lines.push(`    \u8BC1\u636E\uFF1A${evidence.eventId}${evidence.quote === void 0 ? "" : ` \u300C${evidence.quote}\u300D`}`);
    }
  }
  lines.push("");
  lines.push(`\u540C\u5316 ${analysis.assimilation.length} \u6761\uFF08\u5B9E\u9645\u5E94\u7528 ${applied.assimilation}\uFF09`);
  for (const item of analysis.assimilation) {
    lines.push(`  \xB7 [${SECTION_LABELS[item.area]}] ${item.target}`);
    lines.push(`    \u2192 ${item.revised}`);
    if (item.why !== "") lines.push(`    \u7406\u7531\uFF1A${item.why}`);
  }
  lines.push("");
  lines.push(`\u987A\u5E94 ${analysis.accommodation.length} \u6761\uFF08\u5B9E\u9645\u5E94\u7528 ${applied.accommodation}\uFF09`);
  for (const item of analysis.accommodation) {
    lines.push(`  \xB7 [${SECTION_LABELS[item.area]}] ${item.text}`);
    if (item.why !== "") lines.push(`    \u7406\u7531\uFF1A${item.why}`);
  }
  if (skipped.length > 0) {
    lines.push("");
    lines.push(`\u5DF2\u8DF3\u8FC7\uFF1A`);
    for (const reason of skipped) lines.push(`  \xB7 ${reason}`);
  }
  if (analysis.notes !== "") {
    lines.push("");
    lines.push(`\u5907\u6CE8\uFF1A${analysis.notes}`);
  }
  lines.push("");
  lines.push(result.wrote ? `\u5DF2\u5199\u56DE\uFF1A${result.snapshot ?? "(\u65E0\u5FEB\u7167)"}` : "\u672A\u5199\u56DE\uFF08dry-run\uFF0C\u52A0 --apply \u624D\u843D\u76D8\uFF09");
  return lines.join("\n");
}
function listHistory(config) {
  const logFile = path6.join(config.stateRoot, "history", "changelog.jsonl");
  const text = readTextFile(logFile);
  if (text === void 0) return [];
  return text.split("\n").filter((line) => line.trim() !== "").map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return void 0;
    }
  }).filter((entry) => entry !== void 0);
}

// src/schedule.ts
function nextAtTime(now, atTime) {
  const match = /^(\d{1,2}):(\d{2})$/u.exec(atTime.trim());
  if (match === null) return void 0;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return void 0;
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime();
}
function checkDue(config, now = /* @__PURE__ */ new Date()) {
  if (!config.trigger.modes.includes("schedule")) {
    return { due: false, reason: "trigger.modes \u672A\u542F\u7528 schedule", waitMs: Number.POSITIVE_INFINITY, undigested: 0 };
  }
  const cursor = loadCursor(config.stateRoot);
  const undigested = countUndigested(cursor, listEventIds(config.memoryRoot));
  if (undigested < config.trigger.minNewDiaries) {
    return {
      due: false,
      reason: `\u672A\u6D88\u5316\u65E5\u8BB0\u4E0D\u8DB3\uFF08${undigested} < ${config.trigger.minNewDiaries}\uFF09`,
      waitMs: 0,
      undigested
    };
  }
  const sinceLast = msSinceLastRun(cursor, now.getTime());
  const cooldown = Math.max(config.trigger.cooldownMs, config.trigger.schedule.intervalMinutes * 6e4);
  if (sinceLast < cooldown) {
    const waitMs = cooldown - sinceLast;
    return {
      due: false,
      reason: `\u51B7\u5374\u4E2D\uFF08\u8FD8\u9700 ${Math.ceil(waitMs / 6e4)} \u5206\u949F\uFF1B\u95F4\u9694 ${Math.round(cooldown / 6e4)} \u5206\u949F\uFF09`,
      waitMs,
      undigested
    };
  }
  const atTime = config.trigger.schedule.atTime;
  if (atTime !== void 0) {
    const next = nextAtTime(now, atTime);
    if (next === void 0) {
      return { due: false, reason: `trigger.schedule.atTime \u683C\u5F0F\u65E0\u6548\uFF1A${atTime}\uFF08\u5E94\u4E3A HH:MM\uFF09`, waitMs: 0, undigested };
    }
    const todayTarget = new Date(now);
    const [h, m] = atTime.split(":").map(Number);
    todayTarget.setHours(h, m, 0, 0);
    const lastRun = cursor.lastRunAt === void 0 ? 0 : Date.parse(cursor.lastRunAt);
    const alreadyRanSinceTarget = !Number.isNaN(lastRun) && lastRun >= todayTarget.getTime();
    if (now.getTime() >= todayTarget.getTime() && !alreadyRanSinceTarget) {
      const overdueMs = now.getTime() - todayTarget.getTime();
      const skipAfter = config.trigger.schedule.skipIfOverdueMinutes * 6e4;
      if (skipAfter > 0 && overdueMs > skipAfter) {
        return {
          due: false,
          reason: `\u5DF2\u9519\u8FC7 ${atTime} \u7684\u7A97\u53E3 ${Math.round(overdueMs / 6e4)} \u5206\u949F\uFF08skipIfOverdueMinutes=${config.trigger.schedule.skipIfOverdueMinutes}\uFF09`,
          waitMs: next - now.getTime(),
          undigested
        };
      }
      return { due: true, reason: `\u5230\u8FBE\u6BCF\u65E5\u56FA\u5B9A\u65F6\u523B ${atTime}`, waitMs: 0, undigested };
    }
    return {
      due: false,
      reason: alreadyRanSinceTarget ? `\u4ECA\u65E5 ${atTime} \u5DF2\u8DD1\u8FC7` : `\u7B49\u5F85\u6BCF\u65E5\u56FA\u5B9A\u65F6\u523B ${atTime}`,
      waitMs: next - now.getTime(),
      undigested
    };
  }
  return { due: true, reason: `\u6EE1\u8DB3\u95F4\u9694 ${config.trigger.schedule.intervalMinutes} \u5206\u949F\u4E14\u65B0\u65E5\u8BB0 ${undigested} \u7BC7`, waitMs: 0, undigested };
}
function checkHookDue(config, now = /* @__PURE__ */ new Date()) {
  if (!config.trigger.modes.includes("hook")) {
    return { due: false, reason: "trigger.modes \u672A\u542F\u7528 hook", waitMs: Number.POSITIVE_INFINITY, undigested: 0 };
  }
  const events = config.trigger.hook.events;
  if (events.length === 0) {
    return { due: false, reason: "trigger.hook.events \u4E3A\u7A7A\uFF08\u672A\u9009\u62E9\u6302\u70B9\uFF09", waitMs: Number.POSITIVE_INFINITY, undigested: 0 };
  }
  const cursor = loadCursor(config.stateRoot);
  const undigested = countUndigested(cursor, listEventIds(config.memoryRoot));
  if (undigested < config.trigger.minNewDiaries) {
    return {
      due: false,
      reason: `\u672A\u6D88\u5316\u65E5\u8BB0\u4E0D\u8DB3\uFF08${undigested} < ${config.trigger.minNewDiaries}\uFF09`,
      waitMs: 0,
      undigested
    };
  }
  const cooldown = Math.max(0, config.trigger.hook.cooldownMs);
  const sinceLast = msSinceLastRun(cursor, now.getTime());
  if (sinceLast < cooldown) {
    const waitMs = cooldown - sinceLast;
    return {
      due: false,
      reason: `hook \u51B7\u5374\u4E2D\uFF08\u8FD8\u9700 ${Math.ceil(waitMs / 6e4)} \u5206\u949F\uFF1BcooldownMs=${cooldown}\uFF09`,
      waitMs,
      undigested
    };
  }
  return {
    due: true,
    reason: `hook \u95F8\u95E8\u901A\u8FC7\uFF08\u6302\u70B9 ${events.join("\u3001")}\uFF0C\u672A\u6D88\u5316 ${undigested} \u7BC7\uFF09`,
    waitMs: 0,
    undigested
  };
}
function recordSkip(config) {
  const cursor = loadCursor(config.stateRoot);
  saveCursor(config.stateRoot, { ...cursor, lastRunAt: nowIso(), skippedRuns: (cursor.skippedRuns ?? 0) + 1 });
}
function cronLine(config, cliPath = "autoschema") {
  const minutes = config.trigger.schedule.intervalMinutes;
  if (config.trigger.schedule.atTime !== void 0) {
    const [h, m] = config.trigger.schedule.atTime.split(":");
    return `${Number(m)} ${Number(h)} * * * ${cliPath} tick --state ${config.stateRoot} >> ${config.stateRoot}/logs/tick.log 2>&1`;
  }
  if (minutes % 60 === 0) {
    return `0 */${Math.max(1, minutes / 60)} * * * ${cliPath} tick --state ${config.stateRoot} >> ${config.stateRoot}/logs/tick.log 2>&1`;
  }
  return `*/${minutes} * * * * ${cliPath} tick --state ${config.stateRoot} >> ${config.stateRoot}/logs/tick.log 2>&1`;
}

// src/tick.ts
function describe(result) {
  const parts = [
    `\u5E73\u8861\u5EA6 ${Math.round(result.analysis.equilibriumScore * 100)}%`,
    `\u975E\u5E73\u8861 ${result.analysis.disequilibrium.length}`,
    `\u540C\u5316 ${result.applied.assimilation}/${result.analysis.assimilation.length}`,
    `\u987A\u5E94 ${result.applied.accommodation}/${result.analysis.accommodation.length}`
  ];
  const sections = ["style", "belief", "value"].map((section) => `${SECTION_LABELS[section]}${result.after[section].length}`).join(" ");
  return `${parts.join(" \xB7 ")}\uFF08\u56FE\u5F0F\uFF1A${sections}\uFF09`;
}
async function tick(options) {
  const logger = options.logger ?? createLogger();
  const { config } = options;
  if (options.origin !== "manual") {
    const due = options.origin === "hook" ? checkHookDue(config) : checkDue(config);
    if (!due.due) {
      if (!options.dryCheck) recordSkip(config);
      logger.debug(`\u8DF3\u8FC7\uFF1A${due.reason}`);
      return { ran: false, due, mode: "skipped", message: due.reason };
    }
  } else if (options.dryCheck) {
    return { ran: false, due: checkDue(config), mode: "skipped", message: "manual dry-check" };
  }
  const applyNow = options.origin === "manual" ? false : config.trigger.applyMode === "apply";
  const result = await run({
    config,
    logger,
    dryRun: !applyNow,
    ...options.client === void 0 ? {} : { client: options.client },
    runId: nowIso()
  });
  const mode = result.wrote ? "applied" : "proposed";
  const message = describe(result);
  if (result.wrote) logger.info(`\u5DF2\u5199\u56DE AGENTS.md\uFF1A${message}`);
  else logger.info(`\u5EFA\u8BAE\u5DF2\u5C31\u7EEA\uFF08\u5F85\u843D\u76D8\uFF09\uFF1A${message}`);
  return { ran: true, result, mode, message };
}

// src/cli.ts
function parseArgs(argv) {
  const flags = /* @__PURE__ */ new Map();
  const positional = [];
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token.startsWith("--")) {
      const [key, inline] = token.slice(2).split("=");
      if (inline !== void 0) flags.set(key ?? "", inline);
      else {
        const next = argv[i + 1];
        if (next !== void 0 && !next.startsWith("--")) {
          flags.set(key ?? "", next);
          i += 1;
        } else flags.set(key ?? "", true);
      }
    } else positional.push(token);
  }
  return { command: positional.shift() ?? "help", flags };
}
var str = (args, key) => {
  const value = args.flags.get(key);
  return typeof value === "string" ? value : void 0;
};
var num = (args, key) => {
  const raw = str(args, key);
  if (raw === void 0) return void 0;
  const value = Number(raw);
  return Number.isFinite(value) ? value : void 0;
};
var bool = (args, key) => args.flags.has(key);
function help() {
  process.stdout.write(`AutoSchema 0.2.0 \u2014 \u8BA9\u81EA\u6211\u56FE\u5F0F\u968F\u65E5\u8BB0\u6F14\u5316\uFF08\u76AE\u4E9A\u6770\uFF1A\u975E\u5E73\u8861 \u2192 \u540C\u5316/\u987A\u5E94 \u2192 \u5E73\u8861\uFF09

\u7528\u6CD5\uFF1Aautoschema <command> [options]

\u547D\u4EE4\uFF1A
  analyze      \u5206\u6790\u5E76\u6253\u5370\u5EFA\u8BAE\uFF08\u4E0D\u5199\u56DE\uFF09\uFF1B--limit N --since ISO --all --json
  apply        \u843D\u76D8\u5F85\u5BA1\u5EFA\u8BAE\uFF08\u82E5\u6709 pending \u5219\u4E0D\u518D\u8C03\u6A21\u578B\uFF09\uFF1B--re-analyze \u5F3A\u5236\u91CD\u7B97
  tick         \u4F9B cron/timer \u8C03\u7528\uFF1A\u6309\u95F8\u95E8\u5224\u65AD\u8BE5\u4E0D\u8BE5\u8DD1\uFF0C\u8BE5\u8DD1\u624D\u8DD1
  daemon       \u5185\u7F6E\u5FAA\u73AF\uFF1A\u6BCF N \u79D2\u68C0\u67E5\u4E00\u6B21\u95F8\u95E8\uFF08\u9ED8\u8BA4 60s\uFF09
  cron         \u6253\u5370\u5EFA\u8BAE\u7684 crontab \u884C
  due          \u53EA\u68C0\u67E5"\u73B0\u5728\u8BE5\u4E0D\u8BE5\u8DD1"\uFF0C\u4E0D\u6267\u884C
  pending      \u67E5\u770B\u5F85\u843D\u76D8\u5EFA\u8BAE\u7684\u6458\u8981
  reset-cursor \u6E05\u7A7A\u6D88\u5316\u6E38\u6807\uFF08\u8BA9\u6240\u6709\u65E5\u8BB0\u91CD\u65B0\u53C2\u4E0E\u5206\u6790\uFF09
  show         \u6253\u5370\u5F53\u524D\u56FE\u5F0F\uFF08\u98CE\u683C/\u4FE1\u5FF5/\u4EF7\u503C\u89C2\uFF09
  history      \u5217\u51FA\u5386\u6B21\u5FEB\u7167
  init         \u521B\u5EFA\u72B6\u6001\u76EE\u5F55\u4E0E\u9ED8\u8BA4 config.json
  doctor       \u81EA\u68C0\uFF1A\u5BC6\u94A5\u3001\u65E5\u8BB0\u3001\u56FE\u5F0F\u3001DeepSeek \u8FDE\u901A\u6027

\u901A\u7528\uFF1A
  --agents <file>   AGENTS.md \u8DEF\u5F84\uFF08\u9ED8\u8BA4 ~/.dsh/AGENTS.md\uFF09
  --memory <dir>    AutoBioMemory \u6570\u636E\u6839\uFF08\u9ED8\u8BA4 ~/.autobiomemory\uFF09
  --state <dir>     \u672C\u5DE5\u5177\u72B6\u6001\u6839\uFF08\u9ED8\u8BA4 ~/.autoschema\uFF09
  --verbose         \u8C03\u8BD5\u65E5\u5FD7
`);
}
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const logger = createLogger({ level: bool(args, "verbose") ? "debug" : "warn" });
  if (args.command === "help" || args.command === "--help" || args.command === "-h") {
    help();
    return 0;
  }
  if (args.command === "--version" || args.command === "version") {
    process.stdout.write("AutoSchema 0.2.0\n");
    return 0;
  }
  const config = loadConfig({
    ...str(args, "state") === void 0 ? {} : { stateRoot: str(args, "state") },
    patch: {
      ...str(args, "agents") === void 0 ? {} : { agentsFile: path7.resolve(str(args, "agents")) },
      ...str(args, "memory") === void 0 ? {} : { memoryRoot: path7.resolve(str(args, "memory")) }
    }
  });
  switch (args.command) {
    case "init": {
      ensureDir(config.stateRoot);
      const file = ensureConfigFile(config);
      process.stdout.write(
        [
          `\u72B6\u6001\u76EE\u5F55\uFF1A${config.stateRoot}`,
          `\u914D\u7F6E\u6587\u4EF6\uFF1A${file}`,
          `AGENTS.md\uFF1A${config.agentsFile}`,
          `\u65E5\u8BB0\u76EE\u5F55\uFF1A${path7.join(config.memoryRoot, "events")}`,
          `DeepSeek key\uFF1A${maskSecret(resolveApiKey(config))}`,
          "",
          "\u4E0B\u4E00\u6B65\uFF1Aautoschema doctor\uFF0C\u7136\u540E autoschema analyze"
        ].join("\n") + "\n"
      );
      return 0;
    }
    case "show": {
      const doc = readSchema(config);
      process.stdout.write(`${renderSchemaDoc(doc)}
`);
      const sections = ["style", "belief", "value"];
      process.stdout.write(
        sections.map((s) => `${SECTION_LABELS[s]}\uFF1A${doc[s].length} \u6761`).join(" \xB7 ") + "\n"
      );
      return 0;
    }
    case "history": {
      const entries = listHistory(config);
      if (entries.length === 0) {
        process.stdout.write("\u8FD8\u6CA1\u6709\u5FEB\u7167\uFF08apply \u65F6\u624D\u4F1A\u751F\u6210\uFF09\u3002\n");
        return 0;
      }
      for (const entry of entries) process.stdout.write(`${entry.at}  ${entry.file}  ${entry.chars} \u5B57\u7B26
`);
      return 0;
    }
    case "analyze": {
      const problems = validateConfig(config);
      if (problems.length > 0) {
        process.stderr.write(`\u914D\u7F6E\u6709\u95EE\u9898\uFF1A
${problems.map((p) => `  - ${p}`).join("\n")}
`);
        return 2;
      }
      const result = await run({
        config,
        logger,
        dryRun: true,
        onlyUndigested: bool(args, "all") ? false : void 0,
        ...num(args, "limit") === void 0 ? {} : { limit: num(args, "limit") },
        ...str(args, "since") === void 0 ? {} : { since: str(args, "since") }
      });
      if (bool(args, "json")) process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
      else process.stdout.write(`${renderReport(result)}
`);
      return 0;
    }
    case "apply": {
      const problems = validateConfig(config);
      if (problems.length > 0) {
        process.stderr.write(`\u914D\u7F6E\u6709\u95EE\u9898\uFF1A
${problems.map((p) => `  - ${p}`).join("\n")}
`);
        return 2;
      }
      const pending = loadPending(config);
      if (pending !== void 0 && !bool(args, "re-analyze")) {
        const applied = applyProposal(config, pending);
        process.stdout.write(
          [
            `\u5DF2\u843D\u76D8 pending \u5EFA\u8BAE\uFF08${pending.at}\uFF09\uFF1A\u540C\u5316 ${applied.applied.assimilation} \xB7 \u987A\u5E94 ${applied.applied.accommodation}`,
            ...applied.skipped.map((reason) => `  \u8DF3\u8FC7\uFF1A${reason}`),
            applied.snapshot === void 0 ? "\uFF08\u65E0\u53D8\u66F4\uFF0C\u672A\u5199\u6587\u4EF6\uFF09" : `\u5FEB\u7167\uFF1A${applied.snapshot}`,
            `\u5DF2\u5199\u56DE\uFF1A${config.agentsFile}`
          ].join("\n") + "\n"
        );
        return 0;
      }
      const result = await run({
        config,
        logger,
        dryRun: false,
        ...num(args, "limit") === void 0 ? {} : { limit: num(args, "limit") },
        ...str(args, "since") === void 0 ? {} : { since: str(args, "since") }
      });
      if (bool(args, "json")) process.stdout.write(`${JSON.stringify(result, null, 2)}
`);
      else process.stdout.write(`${renderReport(result)}
`);
      return 0;
    }
    case "due": {
      const due = checkDue(config);
      process.stdout.write(
        `${due.due ? "\u8BE5\u8DD1" : "\u4E0D\u8BE5\u8DD1"}\uFF1A${due.reason}\uFF5C\u672A\u6D88\u5316 ${due.undigested} \u7BC7` + (due.waitMs > 0 && due.waitMs !== Number.POSITIVE_INFINITY ? `\uFF5C\u8FD8\u9700 ${Math.ceil(due.waitMs / 6e4)} \u5206\u949F` : "") + "\n"
      );
      return 0;
    }
    case "tick": {
      const outcome = await tick({ config, origin: "schedule", logger });
      process.stdout.write(`${outcome.ran ? "\u5DF2\u8FD0\u884C" : "\u5DF2\u8DF3\u8FC7"}\uFF1A${outcome.message}
`);
      return 0;
    }
    case "daemon": {
      const intervalSec = Math.max(5, num(args, "interval") ?? 60);
      process.stdout.write(`AutoSchema daemon \u542F\u52A8\uFF1A\u6BCF ${intervalSec}s \u68C0\u67E5\u4E00\u6B21\u95F8\u95E8\uFF08Ctrl-C \u9000\u51FA\uFF09
`);
      let stopping = false;
      process.on("SIGINT", () => {
        stopping = true;
        process.stdout.write("\n\u6536\u5230 SIGINT\uFF0C\u9000\u51FA\u3002\n");
      });
      while (!stopping) {
        const due = checkDue(config);
        if (due.due) {
          try {
            const outcome = await tick({ config, origin: "schedule", logger });
            process.stdout.write(`${(/* @__PURE__ */ new Date()).toISOString()} \u8FD0\u884C\uFF1A${outcome.mode} ${outcome.message}
`);
          } catch (error) {
            process.stderr.write(`${(/* @__PURE__ */ new Date()).toISOString()} \u8FD0\u884C\u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}
`);
          }
        } else {
          process.stdout.write(`${(/* @__PURE__ */ new Date()).toISOString()} \u8DF3\u8FC7\uFF1A${due.reason}
`);
        }
        await new Promise((resolve) => setTimeout(resolve, intervalSec * 1e3));
      }
      return 0;
    }
    case "cron": {
      process.stdout.write(
        [
          "# \u628A\u4E0B\u9762\u4E00\u884C\u52A0\u5230 crontab -e\uFF08tick \u81EA\u5E26\u95F8\u95E8\uFF0C\u91CD\u590D\u8C03\u7528\u5B89\u5168\uFF09\uFF1A",
          cronLine(config),
          "",
          "# \u6216\u8005\u7528 systemd timer \u8C03 tick\uFF1B\u4E5F\u53EF\u4EE5 `autoschema daemon --interval 300` \u5E38\u9A7B\u3002"
        ].join("\n") + "\n"
      );
      return 0;
    }
    case "pending": {
      const pending = loadPending(config);
      if (pending === void 0) {
        process.stdout.write("\u6CA1\u6709\u5F85\u843D\u76D8\u5EFA\u8BAE\u3002\n");
        return 0;
      }
      process.stdout.write(
        [
          `\u5F85\u843D\u76D8\u5EFA\u8BAE\uFF1A${pending.at}\uFF08\u6279\u6B21 ${pending.runId}\uFF09`,
          `  \u975E\u5E73\u8861 ${pending.analysis.disequilibrium.length} \xB7 \u540C\u5316 ${pending.analysis.assimilation.length} \xB7 \u987A\u5E94 ${pending.analysis.accommodation.length}`,
          `  \u6D89\u53CA\u65E5\u8BB0 ${pending.eventIds.length} \u7BC7`,
          `  \u843D\u76D8\uFF1Aautoschema apply`,
          `  \u4E22\u5F03\uFF1Aautoschema apply --discard`
        ].join("\n") + "\n"
      );
      if (bool(args, "discard")) {
        clearPending(config);
        process.stdout.write("\u5DF2\u4E22\u5F03\u5F85\u843D\u76D8\u5EFA\u8BAE\u3002\n");
      }
      return 0;
    }
    case "reset-cursor": {
      resetCursor(config.stateRoot);
      clearPending(config);
      process.stdout.write(`\u5DF2\u6E05\u7A7A\u6D88\u5316\u6E38\u6807\u4E0E\u5F85\u843D\u76D8\u5EFA\u8BAE\uFF08${config.stateRoot}/state/\uFF09\u3002
`);
      return 0;
    }
    case "doctor": {
      const checks = [];
      const push = (name, ok, detail) => {
        checks.push({ name, ok, detail });
      };
      const key = resolveApiKey(config);
      push("\u72B6\u6001\u76EE\u5F55", true, config.stateRoot);
      push("\u914D\u7F6E\u6587\u4EF6", true, configFile(config.stateRoot));
      push("DeepSeek key", key !== void 0, maskSecret(key));
      const diaries = listEventIds(config.memoryRoot).length;
      push("\u65E5\u8BB0\u6570\u91CF", diaries > 0, `${diaries} \u7BC7\uFF08${path7.join(config.memoryRoot, "events")}\uFF09`);
      const doc = readSchema(config);
      push("AGENTS.md", true, `${config.agentsFile}\uFF08\u98CE\u683C ${doc.style.length} / \u4FE1\u5FF5 ${doc.belief.length} / \u4EF7\u503C\u89C2 ${doc.value.length}\uFF09`);
      push("\u914D\u7F6E\u6821\u9A8C", validateConfig(config).length === 0, validateConfig(config).join("\uFF1B") || "\u901A\u8FC7");
      if (key !== void 0) {
        try {
          const client = new DeepseekClient(config.deepseek, key, logger);
          await client.chat([
            { role: "system", content: "\u53EA\u56DE\u7B54 JSON\u3002" },
            { role: "user", content: '{"ping":true} \u539F\u6837\u8FD4\u56DE\u3002' }
          ]);
          push("DeepSeek \u8FDE\u901A\u6027", true, "HTTP OK");
        } catch (error) {
          push("DeepSeek \u8FDE\u901A\u6027", false, error instanceof Error ? error.message : String(error));
        }
      }
      if (bool(args, "json")) {
        process.stdout.write(`${JSON.stringify({ checks }, null, 2)}
`);
      } else {
        process.stdout.write(
          [
            `AutoSchema doctor \u2014 ${config.stateRoot}`,
            ...checks.map((check) => `  ${check.ok ? "\u2713" : "\u2717"} ${check.name}\uFF1A${check.detail}`),
            "",
            checks.every((check) => check.ok) ? "\u5168\u90E8\u901A\u8FC7\u3002" : "\u5B58\u5728\u95EE\u9898\uFF0C\u89C1\u4E0A\u3002"
          ].join("\n") + "\n"
        );
      }
      return checks.every((check) => check.ok) ? 0 : 1;
    }
    default:
      process.stderr.write(`\u672A\u77E5\u547D\u4EE4\uFF1A${args.command}

`);
      help();
      return 2;
  }
}
main().then((code) => {
  process.exitCode = code;
}).catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}
`);
  process.exitCode = 1;
});
//# sourceMappingURL=cli.js.map