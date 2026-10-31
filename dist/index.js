// src/types.ts
var SECTION_LABELS = {
  style: "\u98CE\u683C",
  belief: "\u4FE1\u5FF5",
  value: "\u4EF7\u503C\u89C2"
};

// src/constants.ts
import os from "os";
import path from "path";
var VERSION = "0.3.3";
var DEFAULT_AGENTS_FILE = path.join(os.homedir(), ".dsh", "AGENTS.md");
var DEFAULT_MEMORY_ROOT = path.join(os.homedir(), ".autobiomemory");
var DEFAULT_STATE_ROOT = path.join(os.homedir(), ".autoschema");

// src/config.ts
import path3 from "path";
import os2 from "os";

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
    diaries: { dirs: [], includeGlobs: ["*.json"], strict: false },
    diaryLimit: 30,
    diaryChars: 1800,
    maxInputChars: 6e4,
    stateRoot: DEFAULT_STATE_ROOT,
    trigger: {
      modes: ["manual"],
      cooldownMs: 36e5,
      minNewDiaries: 5,
      maxRemovals: 2,
      maxAdditions: 4,
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
  merged.trigger.maxRemovals = Math.max(0, Math.round(merged.trigger.maxRemovals ?? 2));
  merged.trigger.maxAdditions = Math.max(1, Math.round(merged.trigger.maxAdditions ?? 4));
  merged.trigger.schedule.intervalMinutes = Math.max(1, Math.round(merged.trigger.schedule.intervalMinutes));
  const expand = (entry) => {
    const trimmed = entry.trim();
    if (trimmed === "") return "";
    const withHome = trimmed === "~" ? os2.homedir() : trimmed.startsWith("~/") ? path3.join(os2.homedir(), trimmed.slice(2)) : trimmed;
    return path3.resolve(withHome);
  };
  const dirs = Array.isArray(merged.diaries?.dirs) ? merged.diaries.dirs : [];
  merged.diaries = {
    dirs: [...new Set(dirs.map(expand).filter((entry) => entry !== ""))],
    includeGlobs: Array.isArray(merged.diaries?.includeGlobs) && merged.diaries.includeGlobs.length > 0 ? merged.diaries.includeGlobs : ["*.json"],
    strict: merged.diaries?.strict === true
  };
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
  if (config.diaries.dirs.some((dir) => !path3.isAbsolute(dir))) {
    problems.push("diaries.dirs \u5FC5\u987B\u662F\u7EDD\u5BF9\u8DEF\u5F84\uFF08\u652F\u6301 ~ \u5C55\u5F00\uFF09");
  }
  if (typeof config.trigger.maxRemovals === "number" && config.trigger.maxRemovals < 0) {
    problems.push("trigger.maxRemovals \u4E0D\u80FD\u4E3A\u8D1F");
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
function readSchemaDoc(file) {
  return parseSchemaDoc(readTextFile(file) ?? "");
}
function itemCount(doc) {
  return doc.style.length + doc.belief.length + doc.value.length;
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
function describe(area, op, what) {
  return `[${SECTION_LABELS[area]}\xB7${op}] ${what}`;
}
function applySuggestions(doc, suggestions, options = {}) {
  const next = structuredClone(doc);
  const rejected = [];
  const applied = { add: 0, remove: 0, modify: 0, reorder: 0 };
  const maxRemovals = options.maxRemovals ?? 2;
  const maxAdditions = options.maxAdditions ?? 4;
  const wanted = options.ids === void 0 ? void 0 : new Set(options.ids);
  let added = 0;
  let removed = 0;
  for (const suggestion of suggestions) {
    if (wanted !== void 0 && !wanted.has(suggestion.id)) continue;
    const items = next[suggestion.area];
    const label = SECTION_LABELS[suggestion.area];
    if (suggestion.op === "modify") {
      const revised = (suggestion.value ?? "").trim();
      const target = (suggestion.target ?? "").trim();
      if (revised === "" || target === "") {
        rejected.push(describe(suggestion.area, "modify", `\u7F3A\u5C11 target \u6216 value\uFF1A${suggestion.id}`));
        continue;
      }
      let index = findClosestIndex(items, target);
      if (index < 0) index = findClosestIndex(items, revised);
      if (index < 0) {
        rejected.push(describe(suggestion.area, "modify", `\u5B9A\u4F4D\u4E0D\u5230\u6761\u76EE\uFF1A${target}`));
        continue;
      }
      if (normalise(items[index] ?? "") === normalise(revised)) {
        rejected.push(describe(suggestion.area, "modify", `\u6539\u540E\u4E0E\u539F\u6761\u76EE\u76F8\u540C\uFF1A${target}`));
        continue;
      }
      items[index] = revised;
      applied.modify += 1;
      continue;
    }
    if (suggestion.op === "add") {
      const text = (suggestion.value ?? "").trim();
      if (text === "") {
        rejected.push(describe(suggestion.area, "add", `\u7F3A\u5C11 value\uFF1A${suggestion.id}`));
        continue;
      }
      if (added >= maxAdditions) {
        rejected.push(describe(suggestion.area, "add", `\u8D85\u8FC7\u5355\u6B21\u65B0\u589E\u4E0A\u9650 ${maxAdditions}\uFF1A${text}`));
        continue;
      }
      if (items.some((existing) => normalise(existing) === normalise(text))) {
        rejected.push(describe(suggestion.area, "add", `\u6761\u76EE\u5DF2\u5B58\u5728\uFF1A${text}`));
        continue;
      }
      items.push(text);
      added += 1;
      applied.add += 1;
      continue;
    }
    if (suggestion.op === "remove") {
      const target = (suggestion.target ?? "").trim();
      if (target === "") {
        rejected.push(describe(suggestion.area, "remove", `\u7F3A\u5C11 target\uFF1A${suggestion.id}`));
        continue;
      }
      const index = findClosestIndex(items, target);
      if (index < 0) {
        rejected.push(describe(suggestion.area, "remove", `\u5B9A\u4F4D\u4E0D\u5230\u6761\u76EE\uFF1A${target}`));
        continue;
      }
      if (removed >= maxRemovals) {
        rejected.push(describe(suggestion.area, "remove", `\u8D85\u8FC7\u5355\u6B21\u5220\u9664\u4E0A\u9650 ${maxRemovals}\uFF1A${target}`));
        continue;
      }
      if (items.length <= 1) {
        rejected.push(describe(suggestion.area, "remove", `\u62D2\u7EDD\u5220\u7A7A\u8BE5\u8282\uFF1A${target}`));
        continue;
      }
      items.splice(index, 1);
      removed += 1;
      applied.remove += 1;
      continue;
    }
    const order = Array.isArray(suggestion.order) ? suggestion.order.map((entry) => String(entry).trim()).filter((entry) => entry !== "") : [];
    if (order.length < 2) {
      rejected.push(describe(suggestion.area, "reorder", `order \u81F3\u5C11\u9700\u8981 2 \u6761\uFF1A${suggestion.id}`));
      continue;
    }
    const taken = /* @__PURE__ */ new Set();
    const head = [];
    for (const entry of order) {
      const index = findClosestIndex(items, entry);
      if (index < 0 || taken.has(index)) {
        rejected.push(describe(suggestion.area, "reorder", `\u5B9A\u4F4D\u4E0D\u5230\u6761\u76EE\uFF1A${entry}`));
        continue;
      }
      taken.add(index);
      head.push(items[index]);
    }
    if (taken.size < 2) {
      rejected.push(describe(suggestion.area, "reorder", "\u53EF\u5339\u914D\u6761\u76EE\u4E0D\u8DB3 2 \u6761\uFF0C\u653E\u5F03\u91CD\u6392"));
      continue;
    }
    const rest = items.filter((_, index) => !taken.has(index));
    const before = items.join("\0");
    next[suggestion.area] = [...head, ...rest];
    if (next[suggestion.area].join("\0") === before) {
      rejected.push(describe(suggestion.area, "reorder", "\u987A\u5E8F\u672A\u53D8\u5316"));
      continue;
    }
    applied.reorder += 1;
  }
  return { doc: next, rendered: renderSchemaDoc(next), applied, rejected };
}

// src/diaries.ts
import fs2 from "fs";
import path4 from "path";
function eventsDir(memoryRoot) {
  return path4.join(memoryRoot, "events");
}
function resolveDiaryDirs(config) {
  const configured = (config.diaries?.dirs ?? []).filter((dir) => typeof dir === "string" && dir.trim() !== "");
  if (configured.length > 0) return configured;
  if (config.diaries?.strict === true) return [];
  return [eventsDir(config.memoryRoot)];
}
function findEventFile(dirs, name2) {
  for (const dir of dirs) {
    const file = path4.join(dir, name2);
    if (fs2.existsSync(file)) return file;
  }
  return void 0;
}
function listEventIds(eventsDirOrDirs) {
  const dirs = Array.isArray(eventsDirOrDirs) ? eventsDirOrDirs : [eventsDirOrDirs];
  const ids = /* @__PURE__ */ new Set();
  for (const dir of dirs) {
    let names = [];
    try {
      names = fs2.readdirSync(dir);
    } catch {
      continue;
    }
    for (const name2 of names) {
      if (!name2.endsWith(".json") || name2.startsWith("_")) continue;
      ids.add(name2.slice(0, -".json".length));
    }
  }
  return [...ids];
}
function readDiary(eventsDirOrDirs, eventId) {
  const dirs = Array.isArray(eventsDirOrDirs) ? eventsDirOrDirs : [eventsDirOrDirs];
  const jsonFile = findEventFile(dirs, `${eventId}.json`);
  if (jsonFile === void 0) return void 0;
  const json = readJsonFile(jsonFile);
  if (json === void 0) return void 0;
  const md = readTextFile(path4.join(path4.dirname(jsonFile), `${eventId}.md`));
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
    people: Array.isArray(structured.people) ? structured.people.map((p) => p?.name ?? "").filter((name2) => name2 !== "") : [],
    diary
  };
}
function collectDiaries(eventsDirOrDirs, query) {
  const entries = [];
  for (const id of listEventIds(eventsDirOrDirs)) {
    const entry = readDiary(eventsDirOrDirs, id);
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

// src/prompt.ts
var ANALYSIS_GUIDE = `\u4F60\u662F\u6211\u7684\u300C\u81EA\u6211\u56FE\u5F0F\u300D\u5206\u6790\u5E08\u3002\u6211\u7528\u76AE\u4E9A\u6770\u7684\u53D1\u751F\u8BA4\u8BC6\u8BBA\u7EF4\u62A4\u4EBA\u683C\u8BBE\u5B9A\uFF1A

- **\u56FE\u5F0F\uFF08schema\uFF09**\uFF1A\`AGENTS.md\` \u7684\u4E09\u8282\u2014\u2014\u98CE\u683C / \u4FE1\u5FF5 / \u4EF7\u503C\u89C2\u3002
- **\u7ECF\u9A8C**\uFF1A\u6211\u7684\u65E5\u8BB0\uFF08AutoBioMemory \u8BB0\u4E0B\u7684\u7B2C\u4E00\u4EBA\u79F0\u4E8B\u4EF6\uFF09\u3002
- **\u975E\u5E73\u8861**\uFF1A\u65E5\u8BB0\u91CC"\u6211\u5B9E\u9645\u8FD9\u6837\u505A\u4E86"\u4E0E\u56FE\u5F0F\u91CC"\u6211\u4EE5\u4E3A\u6211\u662F\u8C01"\u4E0D\u4E00\u81F4\u4EA7\u751F\u7684\u5F20\u529B\u3002
- **\u540C\u5316\uFF08assimilation\uFF09**\uFF1A\u6539\u5DF2\u6709\u8981\u70B9\u7684\u63AA\u8F9E\uFF0C\u8BA9\u65E7\u7ED3\u6784\u5BB9\u7EB3\u65B0\u7ECF\u9A8C\u3002
- **\u987A\u5E94\uFF08accommodation\uFF09**\uFF1A\u6539\u53D8\u56FE\u5F0F\u7684**\u7ED3\u6784**\u2014\u2014\u65B0\u589E\u4E00\u6761\u3001\u5220\u9664\u4E00\u6761\u3001\u6216\u8C03\u6574\u987A\u5E8F\u3002
- **\u5E73\u8861**\uFF1A\u51B2\u7A81\u88AB\u6D88\u5316\u540E\uFF0C\u56FE\u5F0F\u4E0E\u7ECF\u9A8C\u91CD\u65B0\u81EA\u6D3D\u3002

## \u4F60\u53EA\u4EA7\u51FA\u5EFA\u8BAE\uFF0C\u4E0D\u6539\u6587\u4EF6

\u4F60**\u4E0D\u4F1A\u4E5F\u4E0D\u5E94\u8BE5**\u76F4\u63A5\u4FEE\u6539 AGENTS.md\u3002\u4F60\u8F93\u51FA\u7684\u662F**\u4E00\u7EC4\u5EFA\u8BAE**\uFF0C\u7531\u6211\u5728\u770B\u5230\u4E4B\u540E\u51B3\u5B9A\u91C7\u7EB3\u54EA\u4E00\u6761\u3002
\u6240\u4EE5\u6BCF\u6761\u5EFA\u8BAE\u90FD\u5FC5\u987B\u80FD\u72EC\u7ACB\u8BFB\u61C2\u3001\u72EC\u7ACB\u6267\u884C\uFF1A\u6211\u60F3\u91C7\u7EB3\u7B2C 2 \u6761\u5C31\u80FD\u76F4\u63A5\u7167\u505A\uFF0C\u4E0D\u4F9D\u8D56\u522B\u7684\u6761\u76EE\u3002

## \u6BCF\u6761\u5EFA\u8BAE\u5FC5\u987B\u5199\u660E"\u600E\u4E48\u6539"

\`op\` \u53EA\u80FD\u662F\u4E0B\u9762\u56DB\u79CD\u4E4B\u4E00\uFF0C\u542B\u4E49\u56FA\u5B9A\uFF1A

| op | \u542B\u4E49 | \u5FC5\u586B\u5B57\u6BB5 |
| --- | --- | --- |
| \`add\` | **\u589E**\uFF1A\u5728\u8BE5\u8282\u672B\u5C3E\u65B0\u589E\u4E00\u6761\u8981\u70B9 | \`value\` |
| \`remove\` | **\u5220**\uFF1A\u5220\u9664\u67D0\u6761\u73B0\u6709\u8981\u70B9 | \`target\` |
| \`modify\` | **\u6539**\uFF1A\u6539\u5199\u67D0\u6761\u73B0\u6709\u8981\u70B9\u7684\u63AA\u8F9E | \`target\` + \`value\` |
| \`reorder\` | **\u91CD\u6392**\uFF1A\u7ED9\u51FA\u8BE5\u8282\u7684\u65B0\u987A\u5E8F | \`order\`\uFF08\u5B8C\u6574\u5217\u8868\uFF0C\u987A\u5E8F\u5373\u4F18\u5148\u7EA7\uFF09 |

\u8865\u5145\u89C4\u5219\uFF1A

1. **\u4EF7\u503C\u89C2\u7684\u672C\u8D28\u662F\u6392\u5E8F**\uFF1A\u4F18\u5148\u7EA7\u53D8\u5316\u5FC5\u987B\u7528 \`reorder\` \u8868\u8FBE\uFF0C\u4E0D\u8981\u7528 \`modify\` \u5077\u5077\u6539\u5B57\u5E8F\u3002
   \`order\` \u8981\u7ED9\u51FA\u8BE5\u8282**\u5168\u90E8**\u6761\u76EE\u7684\u65B0\u987A\u5E8F\uFF08\u53EF\u65B0\u589E/\u5220\u9664\u540E\u518D\u6392\uFF09\u3002\u53EA\u6709\u771F\u7684\u6539\u53D8\u4E86\u76F8\u5BF9\u4F18\u5148\u7EA7\u624D\u63D0 reorder\u3002
2. **\u5220\u9664\u4E5F\u662F\u987A\u5E94**\uFF1A\`remove\` \u7528\u6765\u5220\u6389"\u5DF2\u88AB\u7ECF\u9A8C\u8BC1\u4F2A\u3001\u4E14\u6CA1\u6709\u66F4\u8D34\u5207\u66FF\u4EE3"\u7684\u6761\u76EE\u3002
   \u8BF7\u6CE8\u610F\uFF1A\u5220\u4E00\u6761\u901A\u5E38\u6BD4\u6539\u4E00\u6761\u66F4\u91CD\uFF0C\`remove\` \u5FC5\u987B\u7ED9\u51FA\u8DB3\u591F\u8BC1\u636E\u4E0E \`risk\`\u3002
3. \`target\` \u5FC5\u987B**\u9010\u5B57\u53D6\u81EA**\u8BE5\u8282\u73B0\u6709\u6761\u76EE\uFF08\u6211\u4F1A\u505A\u5C31\u8FD1\u5339\u914D\uFF0C\u4F46\u9010\u5B57\u6700\u7A33\uFF09\uFF1B\u5B9A\u4F4D\u4E0D\u5230\u7684\u5EFA\u8BAE\u4F1A\u88AB\u4E22\u5F03\u3002
4. \`piaget\`\uFF1A\`modify\` \u4E00\u5F8B \`assimilation\`\uFF1B\`add\` / \`remove\` / \`reorder\` \u4E00\u5F8B \`accommodation\`\u3002

## \u5224\u65AD\u6807\u51C6

1. **\u53EA\u4F9D\u636E\u65E5\u8BB0\u8BC1\u636E**\uFF1A\u6BCF\u6761\u5EFA\u8BAE\u7684 \`evidence\` \u8981\u6307\u5411\u5177\u4F53\u4E8B\u4EF6 ID \u4E0E\u65E5\u8BB0\u539F\u8BDD\u3002\u6CA1\u8BC1\u636E\u5C31\u522B\u63D0\u3002
2. **\u4E09\u8282\u5404\u7BA1\u4EC0\u4E48**\uFF08\u4E0D\u8981\u4E32\u5473\uFF09\uFF1A
   - \`\u98CE\u683C\`\uFF08style\uFF09\uFF1A\u600E\u4E48\u505A\u4E8B\uFF0C**\u5916\u5728\u884C\u4E3A\u53EF\u89C2\u5BDF**\u2014\u2014\u5148\u7ED9\u7ED3\u8BBA\u8FD8\u662F\u5148\u94FA\u80CC\u666F\u3001\u52A8\u624B\u524D\u662F\u5426\u590D\u8FF0\u9700\u6C42\u3001\u9047\u4E0D\u786E\u5B9A\u5148\u95EE\u8FD8\u662F\u5148\u731C\u3002
   - \`\u4FE1\u5FF5\`\uFF08belief\uFF09\uFF1A\u4FE1\u4EC0\u4E48\uFF0C**\u5185\u5728\u4EF7\u503C\u539F\u5219**\u2014\u2014\u5BF9"\u4E0D\u77E5\u9053"\u7684\u6001\u5EA6\u3001\u5BF9\u9A8C\u8BC1\u7684\u8981\u6C42\u3001\u5BF9\u98CE\u9669\u7684\u7ACB\u573A\u3002
   - \`\u4EF7\u503C\u89C2\`\uFF08value\uFF09\uFF1A\u51B2\u7A81\u65F6\u7684**\u6392\u5E8F**\u2014\u2014\u4E24\u79CD\u597D\u5904\u4E0D\u53EF\u517C\u5F97\u65F6\u5148\u4FDD\u54EA\u4E2A\uFF08\u5B89\u5168 > \u8FDB\u5EA6\u3001\u4E8B\u5B9E > \u9762\u5B50\u3001\u957F\u671F > \u77ED\u671F\uFF09\u3002
3. **\u533A\u5206"\u5076\u53D1"\u4E0E"\u6A21\u5F0F"**\uFF1A\u53EA\u628A\u53CD\u590D\u51FA\u73B0\uFF08\u22652 \u6B21\u6216\u660E\u663E\u4E00\u8D2F\uFF09\u7684\u884C\u4E3A\u4E0A\u5347\u4E3A\u5EFA\u8BAE\uFF1B\u4E00\u6B21\u6027\u5931\u8BEF\u5199\u8FDB observations \u6216 notes\u3002
4. **\u6539\u4F18\u4E8E\u589E\uFF0C\u589E\u4F18\u4E8E\u5220**\uFF1A\u80FD\u7528 \`modify\` \u89E3\u51B3\u7684\u4E0D\u8981 \`add\`\uFF1B\u80FD \`add\` \u7684\u4E0D\u8981 \`remove\`\u3002
   \u5355\u6B21\u5EFA\u8BAE\u91CC \`remove\` \u4E0D\u8D85\u8FC7 2 \u6761\u3001\`add\` \u4E0D\u8D85\u8FC7 4 \u6761\u3002
5. **\u4E0D\u8981\u7F8E\u5316**\uFF1A\u65E5\u8BB0\u91CC\u7684\u5931\u8D25\u3001\u56DE\u907F\u3001\u62D6\u5EF6\u3001\u8FC7\u5EA6\u81EA\u4FE1\u90FD\u8981\u5982\u5B9E\u5BF9\u7167\u3002\u56FE\u5F0F\u5199\u5F97\u5F88\u6F02\u4EAE\u4F46\u957F\u671F\u505A\u4E0D\u5230\uFF0C\u672C\u8EAB\u5C31\u662F\u6700\u5F3A\u7684\u975E\u5E73\u8861\u3002
6. **\u7A7A\u56FE\u5F0F**\uFF1A\u67D0\u8282\u4E3A\u7A7A\u65F6\uFF0C\u53CD\u590D\u51FA\u73B0\u7684\u884C\u4E3A\u5C31\u662F \`add\` \u7684\u4E3B\u8981\u6765\u6E90\uFF1B\u6B64\u65F6 observation \u7684 \`against\` \u5199\u300C\uFF08\u8BE5\u8282\u4E3A\u7A7A\uFF09\u300D\u3002

## \u8F93\u51FA\u54C1\u5473

- \`value\` \u8981\u80FD\u76F4\u63A5\u5199\u8FDB AGENTS.md\uFF1A\u7B2C\u4E00\u4EBA\u79F0\u3001\u53EF\u89C2\u5BDF\u3001\u53EF\u6267\u884C\uFF0C**\u4E0D\u662F\u53E3\u53F7**\u3002
- \`reason\` \u8BB2\u6E05"\u54EA\u6761\u975E\u5E73\u8861 + \u8BC1\u636E\u6307\u5411\u4EC0\u4E48"\uFF0C\u4E0D\u8981\u590D\u8FF0 \`value\`\u3002
- \`risk\` \u5199\u6E05\u91C7\u7EB3\u540E\u7684\u526F\u4F5C\u7528\uFF08\u4F8B\u5982"\u53EF\u80FD\u8BA9\u6C47\u62A5\u53D8\u957F"\uFF09\u3002
- \`confidence\` \u7ED9 0~1\uFF1B\u6CA1\u628A\u63E1\u7684\u5EFA\u8BAE\u5B81\u53EF\u653E\u8FDB notes\u3002
- \u6BCF\u6761 suggestion \u7684 \`id\` \u7528 \`s1\`\u3001\`s2\`\u2026 \u987A\u5E8F\u7F16\u53F7\u3002

## \u53EA\u8F93\u51FA JSON

\u4E0D\u8981 markdown \u4EE3\u7801\u5757\uFF0C\u4E0D\u8981\u89E3\u91CA\u6587\u5B57\u3002`;
var RESPONSE_CONTRACT = `## \u54CD\u5E94\u5951\u7EA6

{
  "equilibriumScore": 0.42,
  "summary": "\u4E00\u53E5\u8BDD\uFF1A\u5F53\u524D\u56FE\u5F0F\u4E0E\u8FD9\u6BB5\u65F6\u95F4\u7ECF\u9A8C\u4E4B\u95F4\u6700\u4E3B\u8981\u7684\u5F20\u529B",
  "observations": [
    {
      "area": "style | belief | value",
      "observed": "\u65E5\u8BB0\u91CC\u6211\u5B9E\u9645\u7684\u884C\u4E3A\uFF08\u5177\u4F53\u60C5\u5883\uFF09",
      "against": "\u4E0E\u56FE\u5F0F\u54EA\u6761\u51B2\u7A81\uFF1B\u8BE5\u8282\u4E3A\u7A7A\u65F6\u5199\u300C\uFF08\u8BE5\u8282\u4E3A\u7A7A\uFF09\u300D",
      "conflict": "\u4E3A\u4EC0\u4E48\u6784\u6210\u975E\u5E73\u8861",
      "severity": "low | medium | high",
      "evidence": [{ "eventId": "ev_...", "title": "\u4E8B\u4EF6\u6807\u9898", "quote": "\u65E5\u8BB0\u539F\u8BDD" }]
    }
  ],
  "suggestions": [
    {
      "id": "s1",
      "area": "style | belief | value",
      "op": "add | remove | modify | reorder",
      "target": "\uFF08remove/modify \u5FC5\u586B\uFF09\u73B0\u6709\u6761\u76EE\u539F\u6587\uFF1Breorder \u53EF\u7701\u7565\u5355\u6761 target",
      "value": "\uFF08add/modify \u5FC5\u586B\uFF09\u5EFA\u8BAE\u5199\u5165\u7684\u4E00\u53E5\u8BDD",
      "order": ["\uFF08\u4EC5 reorder\uFF09\u8BE5\u8282\u5B8C\u6574\u7684\u65B0\u987A\u5E8F\uFF0C\u987A\u5E8F\u5373\u4F18\u5148\u7EA7"],
      "before": "\uFF08\u53EF\u9009\uFF09\u6539\u524D\u539F\u6587",
      "after": "\uFF08\u53EF\u9009\uFF09\u6539\u540E\u9884\u671F\u7ED3\u679C\uFF1Breorder \u65F6\u7ED9\u6392\u5E8F\u540E\u7684\u5B8C\u6574\u5217\u8868",
      "piaget": "assimilation | accommodation",
      "reason": "\u54EA\u6761\u975E\u5E73\u8861 + \u8BC1\u636E\u6307\u5411\u4EC0\u4E48",
      "evidence": [{ "eventId": "ev_...", "title": "...", "quote": "..." }],
      "confidence": 0.0,
      "severity": "low | medium | high",
      "risk": "\uFF08\u53EF\u9009\uFF09\u91C7\u7EB3\u540E\u7684\u526F\u4F5C\u7528"
    }
  ],
  "notes": "\u7591\u8651\u3001\u8BC1\u636E\u4E0D\u8DB3\u5904\u3001\u4E00\u6B21\u6027\u5076\u53D1\u4E8B\u4EF6\uFF08\u4E0D\u8FDB\u5EFA\u8BAE\uFF09"
}

\u786C\u7EA6\u675F\uFF1A
- suggestions[].op \u53EA\u80FD\u662F add / remove / modify / reorder\u3002
- add: value \u5FC5\u586B\uFF1Bremove: target \u5FC5\u586B\uFF1Bmodify: target + value \u5FC5\u586B\uFF1Breorder: order \u4E14\u81F3\u5C11 2 \u6761\u3002
- area \u53EA\u7528 style / belief / value\u3002
- \u4F60\u4E0D\u4FEE\u6539\u4EFB\u4F55\u6587\u4EF6\uFF0C\u53EA\u8F93\u51FA\u5EFA\u8BAE\u3002
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
function asOp(value) {
  const text = asString(value).toLowerCase();
  if (text === "add" || text === "remove" || text === "modify" || text === "reorder") return text;
  if (text === "\u589E" || text === "\u65B0\u589E") return "add";
  if (text === "\u5220" || text === "\u5220\u9664") return "remove";
  if (text === "\u6539" || text === "\u4FEE\u6539" || text === "\u6539\u5199") return "modify";
  if (text === "\u91CD\u6392" || text === "\u6392\u5E8F" || text === "\u8C03\u5E8F") return "reorder";
  return void 0;
}
function asPiaget(op, value) {
  if (op === "modify") return "assimilation";
  const text = asString(value).toLowerCase();
  return text === "assimilation" ? "assimilation" : "accommodation";
}
function asNumbers(value, fallback) {
  const parsed = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(parsed) ? clamp(parsed, 0, 1) : fallback;
}
function normalizeAnalysis(value) {
  if (!isRecord(value)) throw new AnalysisError("\u54CD\u5E94\u4E0D\u662F JSON \u5BF9\u8C61");
  const observations = [];
  for (const raw of Array.isArray(value.observations) ? value.observations : []) {
    if (!isRecord(raw)) continue;
    const area = asSection(raw.area);
    const observed = asString(raw.observed);
    if (area === void 0 || observed === "") continue;
    observations.push({
      area,
      observed,
      against: asString(raw.against, "\uFF08\u8BE5\u8282\u4E3A\u7A7A\uFF09"),
      conflict: asString(raw.conflict),
      severity: asSeverity(raw.severity),
      evidence: asEvidence(raw.evidence)
    });
  }
  const suggestions = [];
  let autoId = 1;
  for (const raw of Array.isArray(value.suggestions) ? value.suggestions : []) {
    if (!isRecord(raw)) continue;
    const area = asSection(raw.area);
    const op = asOp(raw.op);
    if (area === void 0 || op === void 0) continue;
    const target = asString(raw.target);
    const text = asString(raw.value);
    const order = Array.isArray(raw.order) ? raw.order.map((entry) => asString(entry)).filter((entry) => entry !== "") : [];
    if (op === "add" && text === "") continue;
    if (op === "remove" && target === "") continue;
    if (op === "modify" && (target === "" || text === "")) continue;
    if (op === "reorder" && order.length < 2) continue;
    suggestions.push({
      id: asString(raw.id, `s${autoId}`),
      area,
      op,
      ...target === "" ? {} : { target },
      ...text === "" ? {} : { value: text },
      ...order.length === 0 ? {} : { order },
      ...asString(raw.before) === "" ? {} : { before: asString(raw.before) },
      ...asString(raw.after) === "" ? {} : { after: asString(raw.after) },
      piaget: asPiaget(op, raw.piaget),
      reason: asString(raw.reason),
      evidence: asEvidence(raw.evidence),
      confidence: asNumbers(raw.confidence, 0.5),
      severity: asSeverity(raw.severity),
      ...asString(raw.risk) === "" ? {} : { risk: asString(raw.risk) }
    });
    autoId += 1;
  }
  const summary = asString(value.summary);
  if (observations.length === 0 && suggestions.length === 0 && summary === "") {
    throw new AnalysisError("\u54CD\u5E94\u91CC\u6CA1\u6709\u4EFB\u4F55\u53EF\u7528\u6761\u76EE");
  }
  return {
    equilibriumScore: clamp(Number(value.equilibriumScore ?? 0) || 0, 0, 1),
    summary,
    observations,
    suggestions,
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

// src/reconcile.ts
import fs3 from "fs";
import path6 from "path";

// src/cursor.ts
import path5 from "path";
var VERSION2 = 1;
function cursorFile(stateRoot) {
  return path5.join(stateRoot, "state", "cursor.json");
}
function emptyCursor() {
  return { version: VERSION2, digested: {}, proposed: {} };
}
function loadCursor(stateRoot) {
  const raw = readJsonFile(cursorFile(stateRoot));
  if (raw === void 0 || typeof raw !== "object" || typeof raw.digested !== "object" || raw.digested === null) {
    return emptyCursor();
  }
  return {
    ...emptyCursor(),
    ...raw,
    version: VERSION2,
    digested: raw.digested ?? {},
    proposed: raw.proposed ?? {}
  };
}
function saveCursor(stateRoot, cursor) {
  ensureDir(path5.join(stateRoot, "state"));
  writeJsonFile(cursorFile(stateRoot), { ...cursor, version: VERSION2 });
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
function pendingEventIds(cursor) {
  return Object.keys(cursor.proposed);
}
function clearProposed(cursor) {
  return { ...cursor, proposed: {} };
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

// src/reconcile.ts
function readSchema(config) {
  const raw = readTextFile(config.agentsFile) ?? "";
  return parseSchemaDoc(raw);
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
function gatherDiaries(config, limit, since) {
  return collectDiaries(resolveDiaryDirs(config), {
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
async function propose(options) {
  const { config } = options;
  const logger = options.logger ?? createLogger();
  const before = readSchema(config);
  const onlyUndigested = options.onlyUndigested ?? config.digest.onlyUndigested;
  const cursor = loadCursor(config.stateRoot);
  const gathered = gatherDiaries(config, options.limit, options.since);
  const diaries = onlyUndigested ? filterUndigested(cursor, gathered) : gathered;
  const skippedDigested = gathered.length - diaries.length;
  if (diaries.length === 0) {
    throw new Error(
      gathered.length === 0 ? `\u6CA1\u6709\u53EF\u7528\u65E5\u8BB0\uFF1A${resolveDiaryDirs(config).join("\u3001") || "(\u672A\u914D\u7F6E diaries.dirs)"} \u4E3A\u7A7A\uFF0C\u6216 since/limit \u8FC7\u6EE4\u540E\u65E0\u5185\u5BB9\u3002\u5148\u8DD1\u4E00\u6B21 AutoBioMemory \u7684\u6574\u7406\uFF0C\u6216\u5728 config.json \u7684 diaries.dirs \u91CC\u6307\u5411\u6B63\u786E\u7684\u76EE\u5F55\u3002` : `\u6CA1\u6709"\u672A\u6D88\u5316"\u7684\u65E5\u8BB0\uFF08\u6700\u8FD1 ${gathered.length} \u7BC7\u90FD\u5DF2\u5904\u7406\u8FC7\uFF09\u3002\u7528 --all \u6216 digest.onlyUndigested=false \u91CD\u65B0\u5206\u6790\u5168\u90E8\u3002`
    );
  }
  logger.info(
    `\u56FE\u5F0F\uFF1A\u98CE\u683C ${before.style.length} / \u4FE1\u5FF5 ${before.belief.length} / \u4EF7\u503C\u89C2 ${before.value.length} \u6761\uFF1B\u65E5\u8BB0 ${diaries.length} \u7BC7`
  );
  const client = options.client ?? new DeepseekClient(config.deepseek, requireApiKey(config), logger);
  const renderedDiaries = renderDiaries(diaries);
  const { system, user } = buildAnalysisRequest({ doc: before, diaries, renderedDiaries });
  const raw = await client.chat([
    { role: "system", content: system },
    { role: "user", content: user }
  ]);
  const analysis = parseAnalysisResponse(raw);
  const runId = options.runId ?? nowIso();
  const ids = diaries.map((entry) => entry.eventId);
  saveCursor(
    config.stateRoot,
    analysis.suggestions.length > 0 ? markProposed(cursor, ids, runId) : markRun(cursor, runId)
  );
  const pendingSaved = analysis.suggestions.length > 0;
  if (pendingSaved) {
    writeJsonFile(pendingFile(config.stateRoot), { at: nowIso(), runId, analysis, eventIds: ids });
  }
  writeJsonFile(path6.join(config.stateRoot, "last-run.json"), {
    at: nowIso(),
    equilibriumScore: analysis.equilibriumScore,
    observations: analysis.observations.length,
    suggestions: analysis.suggestions.length,
    diaries: diaries.length
  });
  return {
    analysis,
    digestedIds: ids,
    skippedDigested,
    diaries,
    rendered: renderSchemaDoc(before),
    pendingSaved
  };
}
var run = propose;
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
function applySelected(config, suggestions, options = {}) {
  const before = readSchema(config);
  const outcome = applySuggestions(before, suggestions, {
    ...options.ids === void 0 ? {} : { ids: options.ids },
    maxRemovals: config.trigger.maxRemovals,
    maxAdditions: config.trigger.maxAdditions
  });
  const changed = outcome.applied.add + outcome.applied.remove + outcome.applied.modify + outcome.applied.reorder > 0;
  let snapshot;
  if (changed) {
    snapshot = snapshotSchema(config, readTextFile(config.agentsFile) ?? "");
    writeSchemaDoc(config.agentsFile, outcome.doc);
  }
  return {
    changed,
    doc: outcome.doc,
    rendered: outcome.rendered,
    applied: outcome.applied,
    rejected: outcome.rejected,
    ...snapshot === void 0 ? {} : { snapshot }
  };
}
function applyPending(config, options = {}) {
  const pending = loadPending(config);
  if (pending === void 0) throw new Error("\u6CA1\u6709\u5F85\u5BA1\u5EFA\u8BAE\uFF08\u5148\u8FD0\u884C autoschema propose\uFF09");
  const result = applySelected(config, pending.analysis.suggestions, options);
  const cursor = loadCursor(config.stateRoot);
  const accepted = options.ids === void 0 ? pending.eventIds : pending.analysis.suggestions.filter((s) => options.ids?.includes(s.id)).length > 0 ? pending.eventIds : [];
  if (accepted.length > 0 && result.changed) {
    saveCursor(config.stateRoot, markDigested(cursor, accepted, options.runId ?? pending.runId));
  }
  if (options.ids === void 0) clearPending(config);
  return { result, cursorMarked: accepted.length };
}
var OP_LABELS = {
  add: "\u589E",
  remove: "\u5220",
  modify: "\u6539",
  reorder: "\u91CD\u6392"
};
function renderReport(result) {
  const { analysis } = result;
  const lines = [];
  lines.push(`\u5E73\u8861\u5EA6\uFF1A${Math.round(analysis.equilibriumScore * 100)}%\uFF080=\u5B8C\u5168\u51B2\u7A81\uFF0C100=\u5B8C\u5168\u81EA\u6D3D\uFF09`);
  if (analysis.summary !== "") lines.push(`\u603B\u89C8\uFF1A${analysis.summary}`);
  lines.push("");
  lines.push(`\u975E\u5E73\u8861\u89C2\u5BDF ${analysis.observations.length} \u6761`);
  for (const item of analysis.observations) {
    lines.push(`  \xB7 [${SECTION_LABELS[item.area]}\xB7${item.severity}] ${item.observed}`);
    lines.push(`    \u51B2\u7A81\u5BF9\u8C61\uFF1A${item.against}`);
    if (item.conflict !== "") lines.push(`    \u5F20\u529B\uFF1A${item.conflict}`);
    for (const evidence of item.evidence.slice(0, 3)) {
      lines.push(`    \u8BC1\u636E\uFF1A${evidence.eventId}${evidence.quote === void 0 ? "" : ` \u300C${evidence.quote}\u300D`}`);
    }
  }
  lines.push("");
  lines.push(`\u5EFA\u8BAE ${analysis.suggestions.length} \u6761\uFF08\u662F\u5426\u91C7\u7EB3\u7531\u4F60\u51B3\u5B9A\uFF09`);
  for (const suggestion of analysis.suggestions) {
    const label = OP_LABELS[suggestion.op];
    lines.push(`  \xB7 ${suggestion.id} [${SECTION_LABELS[suggestion.area]}\xB7${label}] ${suggestion.op === "reorder" ? `\u65B0\u987A\u5E8F\uFF1A${(suggestion.order ?? []).join(" \u2192 ")}` : suggestion.op === "add" ? `+ ${suggestion.value ?? ""}` : suggestion.op === "remove" ? `- ${suggestion.target ?? ""}` : `${suggestion.target ?? ""} \u2192 ${suggestion.value ?? ""}`}`);
    lines.push(`    \u76AE\u4E9A\u6770\uFF1A${suggestion.piaget === "assimilation" ? "\u540C\u5316\uFF08\u6539\u63AA\u8F9E\uFF09" : "\u987A\u5E94\uFF08\u6539\u7ED3\u6784\uFF09"}\uFF5C\u628A\u63E1 ${Math.round(suggestion.confidence * 100)}%\uFF5C${suggestion.severity}`);
    if (suggestion.reason !== "") lines.push(`    \u7406\u7531\uFF1A${suggestion.reason}`);
    if (suggestion.risk !== void 0) lines.push(`    \u98CE\u9669\uFF1A${suggestion.risk}`);
    for (const evidence of suggestion.evidence.slice(0, 3)) {
      lines.push(`    \u8BC1\u636E\uFF1A${evidence.eventId}${evidence.quote === void 0 ? "" : ` \u300C${evidence.quote}\u300D`}`);
    }
  }
  if (analysis.notes !== "") {
    lines.push("");
    lines.push(`\u5907\u6CE8\uFF1A${analysis.notes}`);
  }
  lines.push("");
  lines.push(
    result.pendingSaved ? `\u5EFA\u8BAE\u5DF2\u5B58\u4E3A\u5F85\u5BA1\uFF1A${"~/.autoschema/state/pending.json"}\uFF08\u91C7\u7EB3\uFF1Aautoschema apply --ids s1,s3\uFF09` : "\u6CA1\u6709\u9700\u8981\u843D\u5730\u7684\u5EFA\u8BAE\uFF08\u56FE\u5F0F\u4E0E\u7ECF\u9A8C\u57FA\u672C\u81EA\u6D3D\uFF09\u3002"
  );
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
  const cursor = loadCursor(config.stateRoot);
  const undigested = countUndigested(cursor, listEventIds(resolveDiaryDirs(config)));
  if (!config.trigger.modes.includes("schedule")) {
    return {
      due: false,
      reason: "trigger.modes \u672A\u542F\u7528 schedule",
      waitMs: Number.POSITIVE_INFINITY,
      undigested
    };
  }
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
  const cursor = loadCursor(config.stateRoot);
  const undigested = countUndigested(cursor, listEventIds(resolveDiaryDirs(config)));
  if (events.length === 0) {
    return {
      due: false,
      reason: "trigger.hook.events \u4E3A\u7A7A\uFF08\u672A\u9009\u62E9\u6302\u70B9\uFF09",
      waitMs: Number.POSITIVE_INFINITY,
      undigested
    };
  }
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
  const tail = `${cliPath} tick --state ${config.stateRoot} >> ${config.stateRoot}/logs/tick.log 2>&1`;
  if (minutes >= 1440) {
    const days = Math.max(1, Math.round(minutes / 1440));
    return days === 1 ? `0 3 * * * ${tail}` : `0 3 */${days} * * ${tail}`;
  }
  if (minutes % 60 === 0) {
    return `0 */${Math.max(1, minutes / 60)} * * * ${tail}`;
  }
  return `*/${Math.max(1, minutes)} * * * * ${tail}`;
}

// src/tick.ts
function describe2(result) {
  const ops = result.analysis.suggestions.map((s) => s.op);
  const count = (op) => ops.filter((entry) => entry === op).length;
  return [
    `\u5E73\u8861\u5EA6 ${Math.round(result.analysis.equilibriumScore * 100)}%`,
    `\u975E\u5E73\u8861 ${result.analysis.observations.length}`,
    `\u5EFA\u8BAE ${result.analysis.suggestions.length}\uFF08\u589E ${count("add")} \u5220 ${count("remove")} \u6539 ${count("modify")} \u91CD\u6392 ${count("reorder")}\uFF09`
  ].join(" \xB7 ");
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
  const result = await propose({
    config,
    logger,
    ...options.client === void 0 ? {} : { client: options.client },
    runId: nowIso()
  });
  const mode = result.pendingSaved ? "proposed" : "clean";
  const message = describe2(result);
  logger.info(`${result.pendingSaved ? "\u5EFA\u8BAE\u5DF2\u5C31\u7EEA\uFF08\u672A\u5199\u56DE\uFF09" : "\u56FE\u5F0F\u4E0E\u7ECF\u9A8C\u57FA\u672C\u81EA\u6D3D"}\uFF1A${message}`);
  return { ran: true, result, mode, message };
}
function touchRun(config) {
  const cursor = loadCursor(config.stateRoot);
  saveCursor(config.stateRoot, { ...cursor, lastRunAt: nowIso(), skippedRuns: 0 });
}

// src/plugin.ts
import z from "@deepseek-ai/schemastery";
var name = "autoschema";
var inject = ["tools", "systemPrompt"];
var Config = z.object({
  stateRoot: z.string(),
  agentsFile: z.string(),
  memoryRoot: z.string(),
  events: z.array(z.string()),
  cooldownMs: z.natural(),
  disabled: z.boolean().default(false)
});
function bridgeLogger(ctx) {
  const base = ctx.logger(name);
  const emit = (level, message) => {
    try {
      base[level]?.(`[${name}] ${message}`);
    } catch {
    }
  };
  return {
    debug: (m) => emit("debug", m),
    info: (m) => emit("info", m),
    warn: (m) => emit("warn", m),
    error: (m) => emit("error", m)
  };
}
function apply(ctx, pluginConfig = {}) {
  if (pluginConfig.disabled === true) return;
  const config = loadConfig({
    ...pluginConfig.stateRoot === void 0 ? {} : { stateRoot: pluginConfig.stateRoot },
    patch: {
      ...pluginConfig.agentsFile === void 0 ? {} : { agentsFile: pluginConfig.agentsFile },
      ...pluginConfig.memoryRoot === void 0 ? {} : { memoryRoot: pluginConfig.memoryRoot },
      ...pluginConfig.events === void 0 ? {} : { trigger: { hook: { events: pluginConfig.events } } },
      ...pluginConfig.cooldownMs === void 0 ? {} : { trigger: { hook: { cooldownMs: pluginConfig.cooldownMs } } },
      trigger: { modes: ["hook"] }
    }
  });
  ensureConfigFile(config);
  const logger = createLogger({ level: "warn" });
  const cLogger = bridgeLogger(ctx);
  const events = config.trigger.hook.events;
  const fire = (label) => {
    void (async () => {
      try {
        const result = await tick({ config, origin: "hook", logger });
        if (result.ran) {
          cLogger.info(`${label} \u2192 ${result.mode}\uFF1A${result.message}`);
        } else {
          cLogger.debug(`${label} \u8DF3\u8FC7\uFF1A${result.message}`);
        }
      } catch (error) {
        cLogger.warn(`${label} \u5931\u8D25\uFF1A${error instanceof Error ? error.message : String(error)}`);
      }
    })();
  };
  if (events.includes("compaction/start")) {
    ctx.on("session/event", ((_session, event) => {
      if (event?.type === "compaction/start") fire("compaction/start");
    }));
  }
  if (events.includes("agent/pre-step")) {
    ctx.on(
      "agent/pre-step",
      (async (_payload, next) => {
        fire("agent/pre-step");
        return next();
      }),
      { prepend: true }
    );
  }
  if (events.includes("agent/idle")) {
    ctx.on("agent/status", ((payload) => {
      if (payload.status === "idle") fire("agent/idle");
    }));
  }
  if (events.includes("session/start")) {
    ctx.on("agent/created", (() => fire("session/start")));
  }
  cLogger.info(
    `AutoSchema hook \u5DF2\u542F\u7528\uFF1A${events.join(", ")}\uFF08\u53EA\u4EA7\u51FA\u5EFA\u8BAE\uFF0C\u4E0D\u4FEE\u6539 AGENTS.md\uFF09`
  );
}
var plugin_default = { name, inject, Config, apply };
export {
  ANALYSIS_GUIDE,
  AnalysisError,
  Config,
  DeepseekClient,
  DeepseekError,
  RESPONSE_CONTRACT,
  SECTION_LABELS,
  VERSION,
  apply,
  applyPending,
  applySelected,
  applySuggestions,
  buildAnalysisRequest,
  checkDue,
  checkHookDue,
  clearPending,
  clearProposed,
  collectDiaries,
  configFile,
  countUndigested,
  createLogger,
  cronLine,
  cursorFile,
  plugin_default as default,
  defaultConfig,
  emptyCursor,
  ensureConfigFile,
  eventsDir,
  extractJsonObject,
  filterUndigested,
  findClosestIndex,
  gatherDiaries,
  inject,
  isDigested,
  isPending,
  isSettled,
  itemCount,
  listEventIds,
  listHistory,
  loadConfig,
  loadCursor,
  loadPending,
  markDigested,
  markProposed,
  markRun,
  msSinceLastRun,
  name,
  nextAtTime,
  normalizeAnalysis,
  parseAnalysisResponse,
  parseSchemaDoc,
  pendingEventIds,
  pendingFile,
  propose,
  readDiary,
  readSchema,
  readSchemaDoc,
  recordSkip,
  renderDiaries,
  renderReport,
  renderSchema,
  renderSchemaDoc,
  resetCursor,
  resolveApiKey,
  resolveDiaryDirs,
  run,
  saveCursor,
  silentLogger,
  snapshotSchema,
  tick,
  touchRun,
  validateConfig,
  writeSchemaDoc
};
//# sourceMappingURL=index.js.map