import { randomUUID } from "node:crypto";
import { readText, writeText } from "./fs.js";
import { generateText } from "./llm.js";
import { buildContext } from "./memory/context.js";
import { buildPlotOptionsPrompt, extractTaggedSections } from "./prompts.js";
import { buildFallbackPlotOptions } from "./templates.js";
import { loadProjectConfig, resolveProjectPaths } from "./project.js";

export async function loadPlotState(rootDir = process.cwd()) {
  const paths = resolveProjectPaths(rootDir);
  const raw = await readText(paths.plotOptions, "");
  if (!raw) {
    return emptyPlotState();
  }

  try {
    return migratePlotState(JSON.parse(raw));
  } catch {
    return emptyPlotState();
  }
}

export async function savePlotState(rootDir, state) {
  const paths = resolveProjectPaths(rootDir);
  const normalized = normalizePlotState(migratePlotState(state));
  await writeText(paths.plotOptions, `${JSON.stringify(normalized, null, 2)}\n`);
  return paths.plotOptions;
}

export async function generatePlotOptions(rootDir, scope, chapterId, runtime = {}) {
  const config = await loadProjectConfig(rootDir);
  const currentState = await loadPlotState(rootDir);
  const context = await buildPlotContext(rootDir, scope, chapterId);
  const prompt = buildPlotOptionsPrompt({
    scope,
    chapterId,
    activeIntent: summarizeActiveThreads(currentState, chapterId),
    context
  });
  const fallbackOptions = buildFallbackPlotOptions(scope, chapterId);
  const llmText = await requestPlotText(prompt, config, runtime, fallbackOptions);
  const createdAt = new Date().toISOString();
  const parsed = parsePlotOptionResponse(llmText, scope, chapterId, fallbackOptions).map((item, index) => ({
    ...item,
    id: makePlotOptionId(scope, chapterId, index),
    scope,
    chapterId: scope === "chapter" ? String(chapterId).padStart(3, "0") : null,
    status: "suggested",
    createdAt
  }));
  const nextState = {
    ...currentState,
    options: [...currentState.options, ...parsed]
  };
  const filePath = await savePlotState(rootDir, nextState);
  return {
    options: parsed,
    plotState: nextState,
    artifact: filePath
  };
}

export async function changePlotOptionStatus(rootDir, optionId, status, options = {}) {
  const plotState = await loadPlotState(rootDir);
  const option = plotState.options.find((item) => item.id === optionId);
  if (!option) {
    throw new Error(`Plot option not found: ${optionId}`);
  }

  option.status = status;
  let thread = null;
  if (status === "applied") {
    thread = upsertThreadFromOption(plotState, option, options.chapterId);
    option.threadId = thread.id;
    activateThread(plotState, thread.id);
    for (const item of plotState.options) {
      if (item.id !== option.id && item.status === "applied") {
        item.status = "kept";
      }
    }
  }

  normalizePlotState(plotState, {
    preferredThreadId: thread?.id || option.threadId || null,
    preferredOptionId: status === "applied" ? option.id : null
  });

  const artifact = await savePlotState(rootDir, plotState);
  return { option, thread, plotState, artifact };
}

export async function changePlotThreadStatus(rootDir, threadId, status, chapterId = null) {
  const plotState = await loadPlotState(rootDir);
  const thread = plotState.threads.find((item) => item.id === threadId);
  if (!thread) {
    throw new Error(`Plot thread not found: ${threadId}`);
  }

  thread.status = status;
  thread.history = [...(thread.history || []), buildThreadHistoryEvent(status, chapterId)];
  if (status === "active") {
    activateThread(plotState, thread.id);
  } else {
    plotState.activeThreadIds = plotState.activeThreadIds.filter((item) => item !== thread.id);
  }
  if (status === "resolved") {
    thread.resolvedInChapterId = chapterId ? String(chapterId).padStart(3, "0") : thread.latestChapterId || null;
  }
  normalizePlotState(plotState, {
    preferredThreadId: status === "active" ? thread.id : null
  });
  const artifact = await savePlotState(rootDir, plotState);
  return { thread, plotState, artifact };
}

export async function getPlotThreads(rootDir, filters = {}) {
  const plotState = await loadPlotState(rootDir);
  const threads = plotState.threads.filter((item) => {
    if (filters.status && item.status !== filters.status) {
      return false;
    }
    if (filters.chapterId && !threadMatchesChapter(item, filters.chapterId)) {
      return false;
    }
    return true;
  });
  return { threads, activeThreadIds: plotState.activeThreadIds };
}

export async function getPlotThread(rootDir, threadId) {
  const plotState = await loadPlotState(rootDir);
  return plotState.threads.find((item) => item.id === threadId) || null;
}

export async function getPlotOptions(rootDir, filters = {}) {
  const plotState = await loadPlotState(rootDir);
  return {
    activeIntent: buildLegacyActiveIntent(plotState),
    activeThreads: getRelevantActiveThreads(plotState, filters.chapterId),
    threads: plotState.threads.filter((item) => {
      if (filters.threadId && item.id !== filters.threadId) {
        return false;
      }
      if (filters.chapterId && !threadMatchesChapter(item, filters.chapterId)) {
        return false;
      }
      return true;
    }),
    options: plotState.options.filter((item) => {
      if (filters.scope && item.scope !== filters.scope) {
        return false;
      }
      if (filters.chapterId && item.chapterId !== String(filters.chapterId).padStart(3, "0")) {
        return false;
      }
      return true;
    })
  };
}

export async function buildIntentContext(rootDir, chapterId) {
  const plotState = await loadPlotState(rootDir);
  const activeThreads = getRelevantActiveThreads(plotState, chapterId);
  if (activeThreads.length === 0) {
    return "";
  }

  return [
    "# 剧情线程",
    ...activeThreads.map((thread) => {
      const parts = [
        `- ${thread.title} [${thread.status}]`,
        `  - 作用章节：${formatThreadRange(thread)}`,
        `  - 摘要：${thread.summary}`,
        `  - 结束条件：${thread.endCondition || "未设定"}`,
        thread.tags?.length ? `  - tags：${thread.tags.join(", ")}` : "",
        thread.relatedEntityIds?.length ? `  - 关联实体：${thread.relatedEntityIds.join(", ")}` : ""
      ].filter(Boolean);
      return parts.join("\n");
    })
  ].join("\n");
}

export function makePlotOptionId(scope, chapterId, index) {
  const chapter = scope === "chapter" ? `-${String(chapterId).padStart(3, "0")}` : "";
  return `${scope}${chapter}-${randomUUID()}-${index + 1}`;
}

function emptyPlotState() {
  return {
    options: [],
    threads: [],
    activeThreadIds: [],
    activeIntent: null
  };
}

function migratePlotState(parsed) {
  const base = {
    options: Array.isArray(parsed?.options) ? parsed.options : [],
    threads: Array.isArray(parsed?.threads) ? parsed.threads : [],
    activeThreadIds: Array.isArray(parsed?.activeThreadIds) ? parsed.activeThreadIds : [],
    activeIntent: parsed?.activeIntent || null
  };

  if (base.threads.length === 0 && base.activeIntent?.plotOptionId) {
    const option = base.options.find((item) => item.id === base.activeIntent.plotOptionId);
    if (option) {
      const thread = createThreadFromOption(option, option.chapterId);
      thread.appliedAt = base.activeIntent.appliedAt || thread.appliedAt;
      thread.status = "active";
      base.threads.push(thread);
      base.activeThreadIds = [thread.id];
      option.threadId = thread.id;
    }
  }

  for (const thread of base.threads) {
    thread.tags = dedupeStrings(thread.tags || []);
    thread.relatedEntityIds = dedupeStrings(thread.relatedEntityIds || []);
    thread.relatedLoopIds = dedupeStrings(thread.relatedLoopIds || []);
    thread.appliesToChapters = normalizeChapterRange(thread.appliesToChapters, thread.originChapterId, thread.scope);
    thread.history = Array.isArray(thread.history) ? thread.history : [];
  }
  return normalizePlotState(base, {
    storedActiveIntent: parsed?.activeIntent || null
  });
}

async function buildPlotContext(rootDir, scope, chapterId) {
  if (scope === "chapter") {
    return buildContext(rootDir, chapterId);
  }

  const paths = resolveProjectPaths(rootDir);
  const [story, arcs, recent] = await Promise.all([
    readText(paths.outlineStory, ""),
    readText(paths.outlineArcs, ""),
    readText(paths.recentSummary, "")
  ]);
  return [story, arcs, recent].filter(Boolean).join("\n\n");
}

async function requestPlotText(prompt, config, runtime, fallbackOptions) {
  const fallbackText = renderPlotFallbackText(fallbackOptions);
  if (runtime.stream) {
    return generateText("plot-options", prompt, config, {
      stream: true,
      signal: runtime.signal,
      fallbackText,
      onToken(chunk, fullText) {
        runtime.emit?.({
          type: "plot_option_generated",
          chunk,
          fullText,
          timestamp: new Date().toISOString()
        });
      }
    });
  }
  const text = await generateText("plot-options", prompt, config);
  return text || fallbackText;
}

function parsePlotOptionResponse(text, scope, chapterId, fallbackOptions) {
  if (!text) {
    return fallbackOptions.map((item) => normalizeOptionShape(item, scope, chapterId));
  }

  const sections = extractTaggedSections(text, ["option_1", "option_2", "option_3"]);
  return ["option_1", "option_2", "option_3"].map((key, index) => {
    const content = sections[key];
    const fallback = normalizeOptionShape(fallbackOptions[index], scope, chapterId);
    if (!content) {
      return fallback;
    }

    const lines = content.split("\n").map((line) => line.trim()).filter(Boolean);
    const title = lines[0]?.replace(/^#+\s*/, "").trim() || fallback.title;
    const summaryLines = [];
    let risk = fallback.risk_or_tradeoff;
    let appliesToChapters = fallback.appliesToChapters;
    let endCondition = fallback.endCondition;
    let tags = fallback.tags;
    let relatedEntityIds = fallback.relatedEntityIds;

    for (const line of lines.slice(1)) {
      if (/^风险[:：]/.test(line)) {
        risk = line.replace(/^风险[:：]\s*/, "").trim() || risk;
      } else if (/^(适用章节|作用章节)[:：]/.test(line)) {
        appliesToChapters = parseRangeText(line.replace(/^(适用章节|作用章节)[:：]\s*/, ""), fallback.appliesToChapters);
      } else if (/^(结束条件|结束标志)[:：]/.test(line)) {
        endCondition = line.replace(/^(结束条件|结束标志)[:：]\s*/, "").trim() || endCondition;
      } else if (/^标签[:：]/.test(line)) {
        tags = parseDelimitedValues(line.replace(/^标签[:：]\s*/, ""));
      } else if (/^(关联人物|关联对象)[:：]/.test(line)) {
        relatedEntityIds = parseDelimitedValues(line.replace(/^(关联人物|关联对象)[:：]\s*/, ""));
      } else {
        summaryLines.push(line);
      }
    }

    return normalizeOptionShape(
      {
        ...fallback,
        title,
        summary: summaryLines.join("\n").trim() || fallback.summary,
        risk_or_tradeoff: risk,
        appliesToChapters,
        endCondition,
        tags,
        relatedEntityIds
      },
      scope,
      chapterId
    );
  });
}

function normalizeOptionShape(option, scope, chapterId) {
  const chapterSlug = scope === "chapter" ? String(chapterId).padStart(3, "0") : null;
  return {
    ...option,
    scope,
    chapterId: chapterSlug,
    appliesToChapters: normalizeChapterRange(option.appliesToChapters, chapterSlug, scope),
    endCondition: option.endCondition || (scope === "chapter" ? "当本章核心冲突完成推进后结束。" : "当该主线目标完成或转入新阶段后结束。"),
    tags: dedupeStrings(option.tags || inferPlotTags(option.title, option.summary)),
    relatedEntityIds: dedupeStrings(option.relatedEntityIds || inferRelatedNames(option.summary)),
    relatedLoopIds: dedupeStrings(option.relatedLoopIds || [])
  };
}

function renderPlotFallbackText(options) {
  return options
    .map((item, index) =>
      [
        `<option_${index + 1}>`,
        `# ${item.title}`,
        item.summary,
        `适用章节：${formatThreadRange({ scope: item.scope, appliesToChapters: item.appliesToChapters, originChapterId: item.chapterId })}`,
        `结束条件：${item.endCondition}`,
        `风险：${item.risk_or_tradeoff}`,
        `标签：${(item.tags || []).join("、")}`,
        "</option_" + (index + 1) + ">"
      ].join("\n")
    )
    .join("\n");
}

function summarizeActiveThreads(plotState, chapterId) {
  return getRelevantActiveThreads(plotState, chapterId)
    .map((thread) => `${thread.title} / ${thread.summary} / 作用章节:${formatThreadRange(thread)} / 结束条件:${thread.endCondition}`)
    .join("\n");
}

function createThreadFromOption(option, chapterId) {
  const timestamp = new Date().toISOString();
  const originChapterId = option.scope === "chapter" ? String(chapterId || option.chapterId).padStart(3, "0") : option.chapterId || null;
  return {
    id: `thread-${option.id}`,
    title: option.title,
    scope: option.scope,
    originChapterId,
    status: "active",
    appliesToChapters: normalizeChapterRange(option.appliesToChapters, originChapterId, option.scope),
    endCondition: option.endCondition || "",
    resolvedInChapterId: null,
    summary: option.summary,
    risk: option.risk_or_tradeoff,
    relatedEntityIds: dedupeStrings(option.relatedEntityIds || []),
    relatedLoopIds: dedupeStrings(option.relatedLoopIds || []),
    tags: dedupeStrings(option.tags || []),
    appliedAt: timestamp,
    latestChapterId: originChapterId,
    history: [buildThreadHistoryEvent("applied", originChapterId, option.id)]
  };
}

function upsertThreadFromOption(plotState, option, chapterId) {
  const existing = option.threadId ? plotState.threads.find((item) => item.id === option.threadId) : null;
  if (existing) {
    existing.status = "active";
    existing.summary = option.summary;
    existing.risk = option.risk_or_tradeoff;
    existing.endCondition = option.endCondition || existing.endCondition;
    existing.tags = dedupeStrings([...(existing.tags || []), ...(option.tags || [])]);
    existing.relatedEntityIds = dedupeStrings([...(existing.relatedEntityIds || []), ...(option.relatedEntityIds || [])]);
    existing.latestChapterId = String(chapterId || option.chapterId || existing.latestChapterId || "").padStart(3, "0") || existing.latestChapterId;
    existing.history = [...(existing.history || []), buildThreadHistoryEvent("reapplied", chapterId || option.chapterId, option.id)];
    return existing;
  }

  const thread = createThreadFromOption(option, chapterId);
  plotState.threads.push(thread);
  return thread;
}

function activateThread(plotState, threadId) {
  const thread = plotState.threads.find((item) => item.id === threadId);
  if (!thread) {
    return;
  }
  thread.status = "active";
  if (!plotState.activeThreadIds.includes(threadId)) {
    plotState.activeThreadIds.push(threadId);
  }
}

function getRelevantActiveThreads(plotState, chapterId) {
  const activeIds = new Set(plotState.activeThreadIds || []);
  return plotState.threads.filter((item) => activeIds.has(item.id) && item.status === "active" && threadMatchesChapter(item, chapterId));
}

function threadMatchesChapter(thread, chapterId) {
  if (!chapterId || thread.scope === "book") {
    return thread.status !== "resolved" && thread.status !== "abandoned";
  }
  const chapter = String(chapterId).padStart(3, "0");
  const range = normalizeChapterRange(thread.appliesToChapters, thread.originChapterId, thread.scope);
  if (range.mode === "all_future") {
    return chapter >= (range.start || "000");
  }
  if (range.mode === "range") {
    return chapter >= (range.start || "000") && chapter <= (range.end || "999");
  }
  return (range.chapters || []).includes(chapter);
}

function normalizeChapterRange(range, originChapterId, scope) {
  if (scope === "book") {
    return range?.mode ? range : { mode: "all_future", start: originChapterId || null, end: null, chapters: [] };
  }
  if (!range) {
    return { mode: "range", start: originChapterId || null, end: originChapterId || null, chapters: originChapterId ? [originChapterId] : [] };
  }
  if (Array.isArray(range)) {
    const chapters = range.map((item) => String(item).padStart(3, "0"));
    return { mode: "list", chapters, start: chapters[0] || originChapterId || null, end: chapters.at(-1) || originChapterId || null };
  }
  return {
    mode: range.mode || "range",
    start: range.start ? String(range.start).padStart(3, "0") : originChapterId || null,
    end: range.end ? String(range.end).padStart(3, "0") : range.mode === "all_future" ? null : originChapterId || null,
    chapters: (range.chapters || []).map((item) => String(item).padStart(3, "0"))
  };
}

function parseRangeText(text, fallback) {
  const value = String(text || "").trim();
  const rangeMatch = value.match(/(\d{1,3})\s*[-~至]\s*(\d{1,3})/);
  if (rangeMatch) {
    return {
      mode: "range",
      start: String(rangeMatch[1]).padStart(3, "0"),
      end: String(rangeMatch[2]).padStart(3, "0"),
      chapters: []
    };
  }
  if (/后续|长期|持续|全书/.test(value)) {
    return {
      mode: "all_future",
      start: fallback?.start || fallback?.chapters?.[0] || null,
      end: null,
      chapters: []
    };
  }
  const chapters = value.match(/\d{1,3}/g);
  if (chapters?.length) {
    const normalized = chapters.map((item) => String(item).padStart(3, "0"));
    return {
      mode: normalized.length > 1 ? "list" : "range",
      start: normalized[0],
      end: normalized.at(-1),
      chapters: normalized.length > 1 ? normalized : [normalized[0]]
    };
  }
  return fallback;
}

function formatThreadRange(thread) {
  const range = normalizeChapterRange(thread.appliesToChapters, thread.originChapterId, thread.scope);
  if (thread.scope === "book" || range.mode === "all_future") {
    return `第${range.start || thread.originChapterId || "?"}章起持续生效`;
  }
  if (range.mode === "list") {
    return (range.chapters || []).map((item) => `第${item}章`).join("、");
  }
  if (range.start && range.end && range.start !== range.end) {
    return `第${range.start}-${range.end}章`;
  }
  return `第${range.start || thread.originChapterId || "?"}章`;
}

function buildLegacyActiveIntent(plotState) {
  const candidateThreads = getRelevantActiveThreads(plotState, null);
  const activeThreads = candidateThreads.length > 0 ? candidateThreads : plotState.threads.filter((item) => item.status === "active");
  const selected = activeThreads
    .map((thread) => ({
      thread,
      sourceEvent: getLatestSourceEvent(plotState, thread)
    }))
    .sort((left, right) => {
      const leftAt = left.sourceEvent?.at || left.thread.appliedAt || "";
      const rightAt = right.sourceEvent?.at || right.thread.appliedAt || "";
      return rightAt.localeCompare(leftAt);
    })[0];

  if (!selected?.thread) {
    return null;
  }
  return buildActiveIntentFromThread(plotState, selected.thread, selected.sourceEvent);
}

function normalizeStoredActiveIntent(plotState, activeIntent) {
  if (!activeIntent?.threadId) {
    return null;
  }

  const thread = plotState.threads.find((item) => item.id === activeIntent.threadId && item.status === "active");
  if (!thread) {
    return null;
  }

  const sourceEvent = getLatestSourceEvent(plotState, thread, activeIntent.plotOptionId);
  return buildActiveIntentFromThread(plotState, thread, sourceEvent, activeIntent.plotOptionId);
}

function normalizePlotState(plotState, options = {}) {
  plotState.activeThreadIds = dedupeStrings(plotState.activeThreadIds || []).filter((threadId) =>
    plotState.threads.some((item) => item.id === threadId && item.status === "active")
  );

  for (const thread of plotState.threads || []) {
    thread.tags = dedupeStrings(thread.tags || []);
    thread.relatedEntityIds = dedupeStrings(thread.relatedEntityIds || []);
    thread.relatedLoopIds = dedupeStrings(thread.relatedLoopIds || []);
    thread.history = Array.isArray(thread.history) ? thread.history : [];
    thread.appliesToChapters = normalizeChapterRange(thread.appliesToChapters, thread.originChapterId, thread.scope);
  }

  const preferredThread = options.preferredThreadId
    ? plotState.threads.find((item) => item.id === options.preferredThreadId && item.status === "active")
    : null;
  const preferredOption = options.preferredOptionId
    ? plotState.options.find((item) => item.id === options.preferredOptionId && item.status !== "dropped")
    : null;
  const preferredIntent = preferredThread
    ? buildActiveIntentFromThread(plotState, preferredThread, getLatestSourceEvent(plotState, preferredThread, preferredOption?.id))
    : preferredOption?.threadId
      ? normalizeStoredActiveIntent(plotState, { threadId: preferredOption.threadId, plotOptionId: preferredOption.id })
      : null;

  plotState.activeIntent =
    preferredIntent ||
    normalizeStoredActiveIntent(plotState, options.storedActiveIntent || plotState.activeIntent) ||
    buildLegacyActiveIntent(plotState);

  return plotState;
}

function buildActiveIntentFromThread(plotState, thread, sourceEvent = null, preferredOptionId = null) {
  if (!thread || thread.status !== "active") {
    return null;
  }

  const resolvedSourceEvent = sourceEvent || getLatestSourceEvent(plotState, thread, preferredOptionId);
  return {
    plotOptionId: preferredOptionId || resolvedSourceEvent?.sourceOptionId || null,
    threadId: thread.id,
    scope: thread.scope,
    chapterId: thread.originChapterId,
    summary: thread.summary,
    title: thread.title,
    appliedAt: thread.appliedAt
  };
}

function getLatestSourceEvent(plotState, thread, preferredOptionId = null) {
  const activeOptionIds = new Set(
    (plotState.options || [])
      .filter((item) => item.status !== "dropped")
      .map((item) => item.id)
  );
  const history = [...(thread.history || [])].reverse();

  if (preferredOptionId && activeOptionIds.has(preferredOptionId)) {
    const preferredEvent = history.find(
      (item) => ["applied", "reapplied"].includes(item.action) && item.sourceOptionId === preferredOptionId
    );
    if (preferredEvent) {
      return preferredEvent;
    }
  }

  return history.find((item) => ["applied", "reapplied"].includes(item.action) && activeOptionIds.has(item.sourceOptionId));
}

function buildThreadHistoryEvent(action, chapterId = null, sourceOptionId = null) {
  return {
    action,
    chapterId: chapterId ? String(chapterId).padStart(3, "0") : null,
    sourceOptionId,
    at: new Date().toISOString()
  };
}

function parseDelimitedValues(text) {
  return dedupeStrings(
    String(text || "")
      .split(/[、,，/]/)
      .map((item) => item.trim())
      .filter(Boolean)
  );
}

function inferPlotTags(title, summary) {
  const source = `${title || ""} ${summary || ""}`;
  const tags = [];
  if (/主线|幕后|真相|任务/.test(source)) {
    tags.push("plot:main");
  }
  if (/关系|师徒|兄弟|家族|爱/.test(source)) {
    tags.push("relationship");
  }
  if (/秘密|真相|隐瞒/.test(source)) {
    tags.push("secret");
  }
  if (/线索|调查|伏笔/.test(source)) {
    tags.push("clue");
  }
  return tags.length ? tags : ["plot:sub"];
}

function inferRelatedNames(text) {
  return dedupeStrings(
    [...String(text || "").matchAll(/[\u4e00-\u9fa5]{2,8}/g)]
      .map((match) => match[0])
      .filter((item) => !/风险|章节|结束条件|主线|后续|推进|冲突|线索|剧情/.test(item))
      .slice(0, 4)
  );
}

function dedupeStrings(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const value = String(item || "").trim();
    if (!value) {
      continue;
    }
    const key = value.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(value);
  }
  return result;
}
