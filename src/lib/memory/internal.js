import path from "node:path";
import { listFiles, readText, writeText } from "../fs.js";
import { parseFrontmatter, stringifyFrontmatter } from "../frontmatter.js";
import { generateText } from "../llm.js";
import { buildMemoryPrompt, extractTaggedSections } from "../prompts.js";
import { buildFallbackMemory } from "../templates.js";
import { loadProjectConfig, resolveProjectPaths } from "../project.js";
import { countTokens, trimTextToTokenBudget } from "../token.js";

const DEFAULT_CONTEXT_BUDGET = 12000;

export async function buildContext(rootDir, chapterId, options = {}) {
  const assembled = await buildAssembledContext(rootDir, chapterId, options);
  return assembled.sections
    .filter((section) => section.included && section.text)
    .map((section) => `# ${section.heading}\n${section.text}`)
    .join("\n\n");
}

export async function buildContextSections(rootDir, chapterId, options = {}) {
  const assembled = await buildAssembledContext(rootDir, chapterId, options);
  return assembled.sections.filter((section) => section.included && section.text);
}

export async function buildAssembledContext(rootDir, chapterId, options = {}) {
  const chapterSlug = chapterId ? String(chapterId).padStart(3, "0") : null;
  const paths = resolveProjectPaths(rootDir);
  const config = await loadProjectConfig(rootDir);
  const structured = await loadStructuredMemory(rootDir);
  const budget = parseBudget(options.budget || config.context_budget);
  const model = process.env.AINOVEL_MODEL || config.default_model || "gpt-4o-mini";
  const chapterPlanPath = chapterSlug ? path.join(rootDir, "chapters", `${chapterSlug}.plan.md`) : null;

  const [
    style,
    story,
    arcs,
    recentSummary,
    globalSummary,
    openLoopsDoc,
    characterState,
    worldState,
    plan,
    chapterMemory
  ] = await Promise.all([
    readText(paths.style, ""),
    readText(paths.outlineStory, ""),
    readText(paths.outlineArcs, ""),
    readText(paths.recentSummary, ""),
    readText(paths.globalSummary, ""),
    readText(paths.openLoops, ""),
    readText(paths.characterState, ""),
    readText(paths.worldState, ""),
    chapterPlanPath ? readText(chapterPlanPath, "") : "",
    chapterSlug ? readText(path.join(paths.memoryChaptersDir, `${chapterSlug}.summary.md`), "") : ""
  ]);

  const retrievalItems = options.retrievalItems || [];
  const retrievalSections = await buildRetrievalSections(rootDir, retrievalItems, chapterSlug);
  const threadSummary = summarizeStoryThreads(structured.storyThreads);
  const loopSummary = summarizeLoopItems(structured.openLoops);
  const warningSummary = summarizeWarningItems(structured.continuityWarnings);

  const sections = [
    createContextSection("chapter_plan", "当前章节计划", plan, "required"),
    createContextSection("chapter_memory", "当前章节记忆", buildChapterMemoryFocus(chapterMemory), "high"),
    createContextSection("recent_summary", "近期记忆", recentSummary, "high"),
    createContextSection("character_state", "人物状态", characterState, "required"),
    createContextSection("world_state", "世界状态", worldState, "required"),
    createContextSection("open_loops", "未回收伏笔", openLoopsDoc || loopSummary, "high"),
    createContextSection("story_threads", "剧情线索", threadSummary, "medium"),
    createContextSection("continuity_warnings", "连续性提醒", warningSummary, "medium"),
    ...retrievalSections,
    createContextSection("story", "故事总纲", story, "medium"),
    createContextSection("arcs", "卷纲", arcs, "medium"),
    createContextSection("global_summary", "全局记忆", globalSummary, "low"),
    createContextSection("style", "文风", style, "low")
  ].filter((section) => section.text);

  const applied = applyContextBudget(sections, budget, {
    model,
    preferCompressed: new Set(["story", "arcs", "global_summary", "style"])
  });
  const usage = summarizeContextUsage(applied, budget, model);

  return {
    budget,
    model,
    sections: applied,
    structured,
    usage
  };
}

export async function updateMemoryFromChapter(rootDir, chapterId) {
  await summarizeChapter(rootDir, chapterId);
  await rebuildMemoryAggregates(rootDir);

  const chapterPath = path.join(
    resolveProjectPaths(rootDir).memoryChaptersDir,
    `${String(chapterId).padStart(3, "0")}.summary.md`
  );
  const summaryDoc = await readText(chapterPath, "");
  return extractSection(summaryDoc, "章节摘要").trim() || `- 第${chapterId}章摘要已更新。`;
}

export async function rebuildMemory(rootDir) {
  const chapterDir = path.join(rootDir, "chapters");
  const chapterFiles = await listFiles(chapterDir);
  const draftFiles = chapterFiles.filter((name) => name.endsWith(".draft.md"));
  const summarizedChapterIds = [];
  const warnings = [];

  for (const draftFile of draftFiles) {
    const chapterId = draftFile.split(".")[0];
    try {
      await summarizeChapter(rootDir, chapterId);
      summarizedChapterIds.push(chapterId);
    } catch (error) {
      warnings.push({
        chapterId,
        message: error.message
      });
    }
  }

  const updates = await rebuildMemoryAggregates(rootDir);
  return {
    updates,
    warnings,
    summarizedChapterIds
  };
}

export async function archiveMemory(rootDir) {
  const paths = resolveProjectPaths(rootDir);
  const summaryFiles = await listFiles(paths.memoryChaptersDir);
  const docs = [];

  for (const summaryFile of summaryFiles) {
    const raw = await readText(path.join(paths.memoryChaptersDir, summaryFile), "");
    docs.push({
      chapterId: summaryFile.split(".")[0],
      raw
    });
  }

  docs.sort((a, b) => a.chapterId.localeCompare(b.chapterId));
  const { archivedDocs, recentDocs } = splitArchiveDocs(docs);

  await writeText(paths.archiveSummary, buildArchiveDocument("# 阶段归档摘要", archivedDocs, recentDocs));

  return {
    archivedCount: archivedDocs.length,
    retainedCount: recentDocs.length
  };
}

export async function loadStructuredMemory(rootDir) {
  const paths = resolveProjectPaths(rootDir);
  const [chapterIndexRaw, threadsRaw, entitiesRaw, loopsRaw, warningsRaw] = await Promise.all([
    readText(paths.chapterIndex, ""),
    readText(paths.storyThreads, ""),
    readText(paths.entities, ""),
    readText(paths.structuredLoops, ""),
    readText(paths.continuityWarnings, "")
  ]);

  return {
    chapterIndex: parseStructuredFile(chapterIndexRaw, "chapters"),
    storyThreads: parseStructuredFile(threadsRaw, "threads"),
    entities: parseStructuredFile(entitiesRaw, "entities"),
    openLoops: parseStructuredFile(loopsRaw, "loops"),
    continuityWarnings: parseStructuredFile(warningsRaw, "warnings")
  };
}

export async function getOpenLoops(rootDir) {
  return (await loadStructuredMemory(rootDir)).openLoops.filter((item) => item.status !== "resolved");
}

export async function getContinuityWarnings(rootDir) {
  return (await loadStructuredMemory(rootDir)).continuityWarnings;
}

export async function findMemoryEntity(rootDir, query) {
  const normalizedQuery = canonicalMemoryKey(query);
  if (!normalizedQuery) {
    return null;
  }

  const structured = await loadStructuredMemory(rootDir);
  return (
    structured.entities.find((entity) => {
      const aliases = [entity.name, ...(entity.aliases || [])].map((item) => canonicalMemoryKey(item));
      return aliases.includes(normalizedQuery);
    }) || null
  );
}

export async function getChapterTags(rootDir, chapterId = null) {
  const structured = await loadStructuredMemory(rootDir);
  const chapters = structured.chapterIndex || [];
  if (!chapterId) {
    return chapters.map((item) => ({ chapterId: item.chapterId, tags: item.tags || [] }));
  }
  const chapter = chapters.find((item) => item.chapterId === String(chapterId).padStart(3, "0"));
  return chapter?.tags || [];
}

export async function searchMemory(rootDir, filters = {}) {
  const structured = await loadStructuredMemory(rootDir);
  let chapters = structured.chapterIndex || [];

  if (filters.tag) {
    const query = canonicalMemoryKey(filters.tag);
    chapters = chapters.filter((item) => (item.tags || []).some((tag) => canonicalMemoryKey(tag) === query));
  }

  if (filters.entity) {
    const query = canonicalMemoryKey(filters.entity);
    chapters = chapters.filter((item) => (item.keyEntities || []).some((name) => canonicalMemoryKey(name) === query));
  }

  if (filters.thread) {
    const query = canonicalMemoryKey(filters.thread);
    chapters = chapters.filter((item) => (item.keyThreads || []).some((name) => matchesThreadQuery(name, query)));
  }

  if (filters.threadRegex) {
    const regex = buildMemoryRegex(filters.threadRegex);
    chapters = chapters.filter((item) => (item.keyThreads || []).some((name) => regex.test(String(name || ""))));
  }

  return chapters;
}

async function summarizeChapter(rootDir, chapterId) {
  const chapterSlug = String(chapterId).padStart(3, "0");
  const draftPath = path.join(rootDir, "chapters", `${chapterSlug}.draft.md`);
  const draftRaw = await readText(draftPath);
  if (!draftRaw) {
    throw new Error(`Chapter draft not found: ${draftPath}`);
  }

  const paths = resolveProjectPaths(rootDir);
  const { data, content } = parseFrontmatter(draftRaw);
  const projectConfig = await loadProjectConfig(rootDir);
  const existingMemory = [
    await readText(paths.globalSummary, ""),
    await readText(paths.openLoops, ""),
    await readText(paths.characterState, ""),
    await readText(paths.worldState, "")
  ].join("\n\n");
  const llmText = await generateText(
    "memory",
    buildMemoryPrompt(chapterSlug, content, existingMemory),
    projectConfig
  );
  const sections = extractTaggedSections(llmText || "", [
    "recent_summary",
    "global_summary",
    "open_loops",
    "character_state",
    "world_state",
    "forgetting_log",
    "story_threads",
    "entities",
    "chapter_tags"
  ]);
  const fallback = buildFallbackMemory(chapterSlug, content);
  const summary = {
    chapterSummary: fallback.chapterSummary,
    recentSummary: sections.recent_summary || fallback.recentSummary,
    globalSummary: sections.global_summary || fallback.globalSummary,
    openLoops: sections.open_loops || fallback.openLoops,
    characterState: sections.character_state || fallback.characterState,
    worldState: sections.world_state || fallback.worldState,
    forgettingLog: sections.forgetting_log || fallback.forgettingLog,
    storyThreads: sections.story_threads || fallback.storyThreads,
    entities: sections.entities || fallback.entities,
    chapterTags: sections.chapter_tags || deriveChapterTagsFromText(content)
  };
  await writeText(
    path.join(paths.memoryChaptersDir, `${chapterSlug}.summary.md`),
    [
      `# 第${chapterSlug}章记忆摘要`,
      "",
      "## 章节摘要",
      summary.chapterSummary,
      "",
      "## 近期摘要",
      summary.recentSummary,
      "",
      "## 长期摘要",
      summary.globalSummary,
      "",
      "## 未回收伏笔",
      summary.openLoops,
      "",
      "## 人物状态",
      summary.characterState,
      "",
      "## 世界状态",
      summary.worldState,
      "",
      "## 剧情线索",
      summary.storyThreads,
      "",
      "## 实体索引",
      summary.entities,
      "",
      "## 标签",
      summary.chapterTags,
      "",
      "## 遗忘日志",
      summary.forgettingLog,
      ""
    ].join("\n")
  );

  const updatedFrontmatter = {
    ...data,
    summary_status: "complete",
    memory_updated_at: new Date().toISOString()
  };
  await writeText(draftPath, stringifyFrontmatter(updatedFrontmatter, content));
}

export async function rebuildMemoryAggregates(rootDir) {
  const paths = resolveProjectPaths(rootDir);
  const summaryFiles = await listFiles(paths.memoryChaptersDir);
  const docs = [];

  for (const summaryFile of summaryFiles) {
    const raw = await readText(path.join(paths.memoryChaptersDir, summaryFile), "");
    docs.push({
      chapterId: summaryFile.split(".")[0],
      raw
    });
  }

  docs.sort((a, b) => a.chapterId.localeCompare(b.chapterId));
  const { archivedDocs: olderDocs, recentDocs } = splitArchiveDocs(docs);
  const globalDocs = olderDocs.length > 0 ? olderDocs : docs;
  const openLoops = collectUniqueItems(docs, ["未回收伏笔"], { filterItem: isActiveLoop });
  const characterState = collectLatestStateItems(docs, "人物状态");
  const worldState = collectLatestStateItems(docs, "世界状态");
  const forgettingLog = collectUniqueItems(docs, ["遗忘日志"]);

  const structured = buildStructuredMemoryFromDocs(docs);
  const chapterIndex = docs.map((doc) => buildChapterIndexEntry(doc, structured));

  await writeText(
    paths.recentSummary,
    buildSectionedAggregateDocument("# 近期剧情摘要", recentDocs, ["章节摘要", "近期摘要"], "暂无内容。")
  );
  await writeText(
    paths.globalSummary,
    buildFlatAggregateDocument("# 全局长期记忆", collectUniqueItems(globalDocs, ["长期摘要"]), "暂无内容。")
  );
  await writeText(paths.openLoops, buildFlatAggregateDocument("# 未回收伏笔", openLoops, "暂无内容。"));
  await writeText(paths.characterState, buildFlatAggregateDocument("# 人物状态", characterState, "暂无内容。"));
  await writeText(paths.worldState, buildFlatAggregateDocument("# 世界状态", worldState, "暂无内容。"));
  await writeText(paths.forgettingLog, buildFlatAggregateDocument("# 遗忘日志", forgettingLog, "暂无内容。"));
  await writeText(paths.chapterIndex, `${JSON.stringify({ chapters: chapterIndex }, null, 2)}\n`);
  await writeText(paths.storyThreads, `${JSON.stringify({ threads: structured.storyThreads }, null, 2)}\n`);
  await writeText(paths.entities, `${JSON.stringify({ entities: structured.entities }, null, 2)}\n`);
  await writeText(paths.structuredLoops, `${JSON.stringify({ loops: structured.openLoops }, null, 2)}\n`);
  await writeText(paths.continuityWarnings, `${JSON.stringify({ warnings: structured.continuityWarnings }, null, 2)}\n`);

  return recentDocs.map((doc) => `- 第${doc.chapterId}章摘要已纳入记忆分层。`);
}

function buildSectionedAggregateDocument(title, docs, sections, fallback) {
  const lines = [title, ""];
  const collected = [];

  for (const doc of docs) {
    for (const section of sections) {
      const body = extractSection(doc.raw, section);
      if (body) {
        collected.push(`## 第${doc.chapterId}章 / ${section}\n${body.trim()}`);
      }
    }
  }

  if (collected.length === 0) {
    lines.push(fallback, "");
    return lines.join("\n");
  }

  lines.push(collected.join("\n\n"), "");
  return lines.join("\n");
}

function buildFlatAggregateDocument(title, items, fallback) {
  const lines = [title, ""];
  if (!items.length) {
    lines.push(fallback, "");
    return lines.join("\n");
  }

  lines.push(...items.map((item) => `- ${item}`), "");
  return lines.join("\n");
}

function buildStructuredMemoryFromDocs(docs) {
  const storyThreads = [];
  const threadByKey = new Map();
  const entities = [];
  const entityByKey = new Map();
  const openLoops = [];
  const loopByKey = new Map();
  const continuityWarnings = [];

  for (const doc of docs) {
    const chapterId = doc.chapterId;
    for (const item of extractListItems(extractSection(doc.raw, "长期摘要"))) {
      const normalized = normalizeMemoryItem(item);
      if (!normalized) {
        continue;
      }
      const key = canonicalMemoryKey(normalized);
      const existing = threadByKey.get(key);
      if (existing) {
        existing.latestChapterId = chapterId;
        if (!existing.facts.includes(normalized)) {
          existing.facts.push(normalized);
        }
        continue;
      }
      const thread = {
        id: `thread-${storyThreads.length + 1}`,
        title: normalizeThreadTitle(normalized),
        status: "active",
        latestChapterId: chapterId,
        facts: [normalized],
        tags: inferTagsFromItems([normalized])
      };
      storyThreads.push(thread);
      threadByKey.set(key, thread);
    }

    for (const item of extractListItems(extractSection(doc.raw, "人物状态"))) {
      mergeEntityState(entityByKey, entities, item, chapterId, "character", continuityWarnings);
    }

    for (const item of extractListItems(extractSection(doc.raw, "世界状态"))) {
      mergeEntityState(entityByKey, entities, item, chapterId, inferEntityType(item), continuityWarnings);
    }

    for (const item of extractListItems(extractSection(doc.raw, "实体索引"))) {
      mergeEntityState(entityByKey, entities, item, chapterId, inferEntityType(item), continuityWarnings);
    }

    for (const item of extractListItems(extractSection(doc.raw, "未回收伏笔"))) {
      const normalized = normalizeMemoryItem(item);
      if (!normalized) {
        continue;
      }
      const key = canonicalMemoryKey(stripResolutionPrefix(normalized));
      const status = isActiveLoop(normalized) ? "open" : "resolved";
      const existing = loopByKey.get(key);
      if (existing) {
        existing.latestChapterId = chapterId;
        existing.title = stripResolutionPrefix(normalized);
        existing.status = status;
        continue;
      }
      const relatedEntityIds = findRelatedEntityIds(entities, normalized);
      const loop = {
        id: `loop-${openLoops.length + 1}`,
        title: stripResolutionPrefix(normalized),
        status,
        introducedIn: chapterId,
        latestChapterId: chapterId,
        relatedEntityIds,
        resolutionRule: status === "resolved" ? "resolved_in_later_chapter" : "pending",
        tags: inferTagsFromItems([normalized])
      };
      openLoops.push(loop);
      loopByKey.set(key, loop);
    }
  }

  return {
    storyThreads,
    entities,
    openLoops,
    continuityWarnings
  };
}

async function buildRetrievalSections(rootDir, items, currentChapterId) {
  const sections = [];
  const paths = resolveProjectPaths(rootDir);

  for (const item of items.slice(0, 4)) {
    const chapterSlug = String(item.chapterId).padStart(3, "0");
    if (currentChapterId && chapterSlug === currentChapterId) {
      continue;
    }
    for (const file of item.files || []) {
      let raw = "";
      let heading = "";
      if (file === "plan") {
        raw = await readText(path.join(rootDir, "chapters", `${chapterSlug}.plan.md`), "");
        heading = `检索 / 第${chapterSlug}章计划`;
      } else if (file === "draft") {
        raw = await readText(path.join(rootDir, "chapters", `${chapterSlug}.draft.md`), "");
        heading = `检索 / 第${chapterSlug}章正文`;
      } else if (file === "memory") {
        raw = await readText(path.join(paths.memoryChaptersDir, `${chapterSlug}.summary.md`), "");
        heading = `检索 / 第${chapterSlug}章记忆`;
      }

      const text = file === "memory" ? buildChapterMemoryFocus(raw) : (raw ? parseFrontmatter(raw).content.trim() : "");
      if (!text) {
        continue;
      }

      sections.push(createContextSection(`retrieval_${chapterSlug}_${file}`, heading, text, "high", { reason: item.reason }));
    }
  }

  return sections;
}

function applyContextBudget(sections, budget, options = {}) {
  let used = 0;
  const order = { required: 0, high: 1, medium: 2, low: 3 };
  const sorted = [...sections].sort((a, b) => {
    const priorityDiff = (order[a.priority] ?? 9) - (order[b.priority] ?? 9);
    return priorityDiff !== 0 ? priorityDiff : a.label.localeCompare(b.label, "zh-Hans-CN");
  });
  const preferCompressed = options.preferCompressed || new Set();
  const model = options.model || "gpt-4o-mini";

  for (const section of sorted) {
    const fullCost = estimateTokenCost(section.text, model);
    if (used + fullCost <= budget || section.priority === "required") {
      section.included = true;
      section.compressed = false;
      section.truncated = false;
      used += fullCost;
      continue;
    }

    const compressedText = preferCompressed.has(section.id) ? compressSectionText(section.text) : "";
    const compressedCost = estimateTokenCost(compressedText, model);
    if (compressedText && used + compressedCost <= budget) {
      section.text = compressedText;
      section.included = true;
      section.compressed = true;
      section.truncated = false;
      used += compressedCost;
      continue;
    }

    section.included = false;
    section.compressed = false;
    section.truncated = false;
  }

  enforceHardBudget(sections, budget, {
    model,
    preferCompressed
  });

  return sections;
}

function compressSectionText(text) {
  const lines = String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const bullets = lines.filter((line) => line.startsWith("- ") || line.startsWith("1.") || line.startsWith("2.") || line.startsWith("3."));
  const source = bullets.length > 0 ? bullets : lines;
  return source.slice(0, 6).join("\n");
}

function createContextSection(id, heading, text, priority = "medium", extra = {}) {
  return {
    id,
    heading,
    label: heading,
    text: String(text || "").trim(),
    priority,
    included: true,
    compressed: false,
    truncated: false,
    ...extra
  };
}

function buildChapterMemoryFocus(memoryDoc) {
  const chapterSummary = extractMarkdownSection(memoryDoc, "章节摘要");
  const characterState = extractMarkdownSection(memoryDoc, "人物状态");
  const openLoops = extractMarkdownSection(memoryDoc, "未回收伏笔");
  const storyThreads = extractMarkdownSection(memoryDoc, "剧情线索");
  return [
    chapterSummary ? `## 章节摘要\n${chapterSummary}` : "",
    characterState ? `## 人物状态\n${characterState}` : "",
    openLoops ? `## 未回收伏笔\n${openLoops}` : "",
    storyThreads ? `## 剧情线索\n${storyThreads}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}

function summarizeStoryThreads(items) {
  if (!items.length) {
    return "";
  }
  return items
    .slice(-6)
    .map((item) => `- ${item.title}（最新推进：第${item.latestChapterId}章）`)
    .join("\n");
}

function summarizeLoopItems(items) {
  const active = items.filter((item) => item.status !== "resolved");
  if (!active.length) {
    return "";
  }
  return active.slice(0, 8).map((item) => `- ${item.title}`).join("\n");
}

function summarizeWarningItems(items) {
  if (!items.length) {
    return "";
  }
  return items.slice(0, 6).map((item) => `- ${item.message}`).join("\n");
}

function buildChapterIndexEntry(doc, structured) {
  const chapterId = doc.chapterId;
  const chapterSummary = extractListItems(extractSection(doc.raw, "章节摘要"));
  const longFacts = extractListItems(extractSection(doc.raw, "长期摘要"));
  const loops = extractListItems(extractSection(doc.raw, "未回收伏笔"))
    .map((item) => stripResolutionPrefix(item))
    .filter(Boolean);
  const entities = extractListItems(extractSection(doc.raw, "实体索引"))
    .concat(extractListItems(extractSection(doc.raw, "人物状态")).map(deriveEntityName))
    .concat(extractListItems(extractSection(doc.raw, "世界状态")).map(deriveEntityName));
  const threads = structured.storyThreads
    .filter((item) => item.latestChapterId === chapterId || item.facts.some((fact) => longFacts.includes(fact)))
    .map((item) => item.title);
  const tags = dedupeStrings(
    extractListItems(extractSection(doc.raw, "标签")).concat(
      inferTagsFromItems([...chapterSummary, ...longFacts, ...loops, ...entities, ...threads])
    )
  );

  return {
    chapterId,
    summary: chapterSummary[0] || "",
    keyFacts: dedupeStrings([...chapterSummary, ...longFacts]).slice(0, 8),
    keyEntities: dedupeStrings(entities).slice(0, 8),
    keyLoops: dedupeStrings(loops).slice(0, 6),
    keyThreads: dedupeStrings(threads).slice(0, 6),
    tags,
    continuityConstraints: dedupeStrings(extractListItems(extractSection(doc.raw, "人物状态")).concat(extractListItems(extractSection(doc.raw, "世界状态")))).slice(0, 8),
    resolvedItems: extractListItems(extractSection(doc.raw, "遗忘日志")).filter((item) => /已解决|已回收|覆盖|压缩/.test(item))
  };
}

function parseStructuredFile(raw, key) {
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed[key]) ? parsed[key] : [];
  } catch {
    return [];
  }
}

function mergeEntityState(entityByKey, entities, item, chapterId, type, warnings) {
  const normalized = normalizeMemoryItem(item);
  if (!normalized) {
    return;
  }
  const name = deriveEntityName(normalized);
  const key = canonicalMemoryKey(name);
  if (!key) {
    return;
  }

  const currentState = extractEntityState(normalized);
  const existing = entityByKey.get(key);
  if (!existing) {
    const entity = {
      id: `entity-${entities.length + 1}`,
      type,
      name,
      aliases: [],
      profile: { role: type === "character" ? "character" : type },
      currentState,
      constraints: extractEntityConstraints(currentState),
      goals: extractGoalsFromState(currentState),
      motivation: extractMotivationFromState(currentState),
      internalConflict: inferInternalConflict(currentState),
      externalConflict: inferExternalConflict(currentState),
      relationships: [],
      secrets: inferSecrets(currentState),
      knownFacts: [currentState].filter(Boolean),
      arcStage: inferArcStage(currentState),
      arcSummary: currentState,
      timeline: [buildEntityTimelineEvent(chapterId, currentState)],
      latestChapterId: chapterId,
      tags: inferTagsFromItems([currentState, name])
    };
    entities.push(entity);
    entityByKey.set(key, entity);
    return;
  }

  if (existing.currentState && currentState && canonicalMemoryKey(existing.currentState) !== canonicalMemoryKey(currentState)) {
    warnings.push({
      severity: "warning",
      subjectId: existing.id,
      sourceChapterId: chapterId,
      message: `${name} 的状态已从“${existing.currentState}”更新为“${currentState}”。`
    });
  }

  existing.type = existing.type || type;
  existing.currentState = currentState || existing.currentState;
  existing.constraints = dedupeStrings([...(existing.constraints || []), ...extractEntityConstraints(currentState)]);
  existing.goals = dedupeStrings([...(existing.goals || []), ...extractGoalsFromState(currentState)]);
  existing.motivation = dedupeStrings([...(existing.motivation || []), ...extractMotivationFromState(currentState)]).join(" / ");
  existing.internalConflict = inferInternalConflict(currentState) || existing.internalConflict;
  existing.externalConflict = inferExternalConflict(currentState) || existing.externalConflict;
  existing.secrets = dedupeStrings([...(existing.secrets || []), ...inferSecrets(currentState)]);
  existing.knownFacts = dedupeStrings([...(existing.knownFacts || []), currentState]);
  existing.arcStage = inferArcStage(currentState) || existing.arcStage;
  existing.arcSummary = currentState || existing.arcSummary;
  existing.timeline = mergeTimeline(existing.timeline, buildEntityTimelineEvent(chapterId, currentState));
  existing.tags = dedupeStrings([...(existing.tags || []), ...inferTagsFromItems([currentState, name])]);
  existing.latestChapterId = chapterId;
}

function inferEntityType(item) {
  const name = deriveEntityName(item);
  if (/城|塔|宫|门|镇|街|山|海|殿|营地|学院|公司|研究所/.test(name)) {
    return "location";
  }
  if (/司|盟|会|派|团|军|署|局|门|教/.test(name)) {
    return "faction";
  }
  if (/剑|印|钥匙|卷宗|令牌|法器|石|碎片|玉|药/.test(name)) {
    return "item";
  }
  return "character";
}

function findRelatedEntityIds(entities, loopTitle) {
  const normalized = canonicalMemoryKey(loopTitle);
  return entities
    .filter((entity) => normalized.includes(canonicalMemoryKey(entity.name)))
    .map((entity) => entity.id);
}

function buildArchiveDocument(title, archivedDocs, recentDocs) {
  const lines = [title, ""];

  if (archivedDocs.length === 0) {
    lines.push("暂无可归档章节。", "");
  } else {
    lines.push("## 已归档章节");
    for (const doc of archivedDocs) {
      const summary = extractSection(doc.raw, "长期摘要") || extractSection(doc.raw, "章节摘要");
      lines.push(`- 第${doc.chapterId}章：${summary.replace(/\n+/g, " ").trim()}`);
    }
    lines.push("");
  }

  lines.push("## 保留高保真章节");
  if (recentDocs.length === 0) {
    lines.push("- 暂无内容。", "");
  } else {
    for (const doc of recentDocs) {
      lines.push(`- 第${doc.chapterId}章`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function collectUniqueItems(docs, sections, options = {}) {
  const seen = new Set();
  const collected = [];

  for (const doc of docs) {
    for (const section of sections) {
      const body = extractSection(doc.raw, section);
      for (const item of extractListItems(body)) {
        const normalized = normalizeMemoryItem(item);
        if (!normalized) {
          continue;
        }
        if (options.filterItem && !options.filterItem(normalized)) {
          continue;
        }
        const dedupeKey = canonicalMemoryKey(normalized);
        if (seen.has(dedupeKey)) {
          continue;
        }
        seen.add(dedupeKey);
        collected.push(normalized);
      }
    }
  }

  return collected;
}

function collectLatestStateItems(docs, heading) {
  const stateByKey = new Map();
  for (const doc of docs) {
    const body = extractSection(doc.raw, heading);
    for (const item of extractListItems(body)) {
      const normalized = normalizeMemoryItem(item);
      if (!normalized) {
        continue;
      }
      const key = deriveStateKey(normalized);
      stateByKey.set(key, normalized);
    }
  }
  return [...stateByKey.values()];
}

function extractSection(doc, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(doc || "").match(new RegExp(`## ${escaped}\\n([\\s\\S]*?)(?=\\n## |$)`));
  return match ? match[1].trim() : "";
}

function extractMarkdownSection(doc, heading) {
  return extractSection(doc, heading);
}

function extractListItems(body) {
  const source = String(body || "").trim();
  if (!source) {
    return [];
  }

  const bulletLines = source
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => /^[-*]\s+/.test(line))
    .map((line) => line.replace(/^[-*]\s+/, "").trim());

  if (bulletLines.length > 0) {
    return bulletLines;
  }

  return source
    .split(/\n{2,}/)
    .map((chunk) => chunk.replace(/\n+/g, " ").trim())
    .filter(Boolean);
}

function normalizeMemoryItem(item) {
  return String(item || "")
    .replace(/\s+/g, " ")
    .replace(/^[\-\*\d.、\s]+/, "")
    .trim();
}

function deriveStateKey(item) {
  const match = String(item || "").match(/^([^:：]{1,24})[:：]/);
  return canonicalMemoryKey((match ? match[1] : item).trim());
}

function deriveEntityName(item) {
  const match = String(item || "").match(/^([^:：]{1,24})[:：]/);
  return (match ? match[1] : item).trim();
}

function extractEntityState(item) {
  const match = String(item || "").match(/^[^:：]{1,24}[:：]\s*(.+)$/);
  return (match ? match[1] : item).trim();
}

function extractEntityConstraints(state) {
  return String(state || "")
    .split(/[，。；;]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 4)
    .slice(0, 4);
}

function extractGoalsFromState(state) {
  return String(state || "")
    .split(/[，。；;]+/)
    .filter((item) => /想|要|计划|准备|试图|决定|必须|目标/.test(item))
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function extractMotivationFromState(state) {
  return String(state || "")
    .split(/[，。；;]+/)
    .filter((item) => /为了|因|被迫|担心|希望|执意|不愿/.test(item))
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function inferInternalConflict(state) {
  return String(state || "")
    .split(/[，。；;]+/)
    .find((item) => /犹豫|隐瞒|挣扎|怀疑|恐惧|愧疚|矛盾/.test(item))
    ?.trim() || "";
}

function inferExternalConflict(state) {
  return String(state || "")
    .split(/[，。；;]+/)
    .find((item) => /追查|围攻|受伤|封锁|威胁|压制|对抗/.test(item))
    ?.trim() || "";
}

function inferSecrets(state) {
  return String(state || "")
    .split(/[，。；;]+/)
    .filter((item) => /隐瞒|秘密|真相|未知|不公开/.test(item))
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 3);
}

function inferArcStage(state) {
  if (/主动|布局|反击|掌控/.test(state)) {
    return "active_turn";
  }
  if (/受伤|隐瞒|被动|试探/.test(state)) {
    return "pressure";
  }
  if (/觉醒|转变|决裂|和解/.test(state)) {
    return "turning_point";
  }
  return state ? "ongoing" : "";
}

function buildEntityTimelineEvent(chapterId, state) {
  return {
    chapterId,
    summary: state || "",
    arcStage: inferArcStage(state),
    tags: inferTagsFromItems([state])
  };
}

function mergeTimeline(timeline = [], event) {
  if (!event?.summary) {
    return timeline || [];
  }
  const existing = (timeline || []).find((item) => item.chapterId === event.chapterId && canonicalMemoryKey(item.summary) === canonicalMemoryKey(event.summary));
  if (existing) {
    return timeline;
  }
  return [...(timeline || []), event].slice(-12);
}

function normalizeThreadTitle(item) {
  return String(item || "").replace(/^主线[:：]\s*/, "").trim();
}

function stripResolutionPrefix(item) {
  return String(item || "").replace(/^(已解决|已兑现|已公开|已回收)[:：]?\s*/i, "").trim();
}

function deriveChapterTagsFromText(text) {
  return inferTagsFromItems([text])
    .map((item) => `- ${item}`)
    .join("\n");
}

function inferTagsFromItems(items) {
  const source = items.join(" ");
  const tags = [];
  if (/主线|任务|真相|幕后|核心/.test(source)) {
    tags.push("plot:main");
  }
  if (/支线|旁支/.test(source)) {
    tags.push("plot:sub");
  }
  if (/人物|主角|导师|反派|关系|师徒|父子|恋/.test(source)) {
    tags.push("character");
  }
  if (/关系|和解|决裂|亲近|疏离/.test(source)) {
    tags.push("relationship");
  }
  if (/秘密|隐瞒|真相|身份/.test(source)) {
    tags.push("secret");
  }
  if (/线索|调查|证据|发现/.test(source)) {
    tags.push("clue");
  }
  if (/伏笔|未明|悬念|承诺/.test(source)) {
    tags.push("foreshadowing");
  }
  if (/规则|阵法|法则|设定|代价/.test(source)) {
    tags.push("world_rule");
  }
  if (/情绪|愧疚|恐惧|愤怒|动摇/.test(source)) {
    tags.push("emotion_turning");
  }
  if (/战|杀|追击|围攻/.test(source)) {
    tags.push("battle");
  }
  if (/朝堂|势力|城防司|派系|联盟/.test(source)) {
    tags.push("politics");
  }
  return dedupeStrings(tags);
}

function isActiveLoop(item) {
  return !/^(已解决|已兑现|已公开|已回收|resolved|closed)[:：]?/i.test(item) && !/[（(](已解决|已兑现|已公开|已回收)[）)]/.test(item);
}

function canonicalMemoryKey(item) {
  return String(item || "")
    .toLowerCase()
    .replace(/[，。！？；：、,.!?;:[\]()（）"'`]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function estimateTokenCost(text, model = "gpt-4o-mini") {
  return countTokens(text, model);
}

function splitArchiveDocs(docs, retainedCount = 3) {
  if (!Array.isArray(docs) || docs.length <= retainedCount) {
    return {
      archivedDocs: [],
      recentDocs: [...(docs || [])]
    };
  }

  return {
    archivedDocs: docs.slice(0, docs.length - retainedCount),
    recentDocs: docs.slice(-retainedCount)
  };
}

function parseBudget(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : DEFAULT_CONTEXT_BUDGET;
}

function summarizeContextUsage(sections, budget, model) {
  const includedSections = sections.filter((section) => section.included && section.text);
  const usedTokens = includedSections.reduce((total, section) => total + estimateTokenCost(section.text, model), 0);
  return {
    budget,
    usedTokens,
    remainingTokens: Math.max(0, budget - usedTokens),
    excludedSections: sections.filter((section) => !section.included).map((section) => section.id),
    compressedSections: sections.filter((section) => section.compressed).map((section) => section.id),
    truncatedSections: sections.filter((section) => section.truncated).map((section) => section.id)
  };
}

function enforceHardBudget(sections, budget, options = {}) {
  const model = options.model || "gpt-4o-mini";
  const preferCompressed = options.preferCompressed || new Set();
  let used = sections
    .filter((section) => section.included && section.text)
    .reduce((total, section) => total + estimateTokenCost(section.text, model), 0);

  if (used <= budget) {
    return;
  }

  const order = { low: 0, medium: 1, high: 2, required: 3 };
  const adjustable = sections
    .filter((section) => section.included && section.text)
    .sort((left, right) => {
      const priorityDiff = (order[left.priority] ?? 9) - (order[right.priority] ?? 9);
      return priorityDiff !== 0 ? priorityDiff : estimateTokenCost(right.text, model) - estimateTokenCost(left.text, model);
    });

  for (const section of adjustable) {
    if (used <= budget) {
      break;
    }

    const currentCost = estimateTokenCost(section.text, model);
    let nextText = section.text;

    if (!section.compressed && preferCompressed.has(section.id)) {
      const compressedText = compressSectionText(section.text);
      if (compressedText && estimateTokenCost(compressedText, model) < currentCost) {
        nextText = compressedText;
        section.compressed = true;
      }
    }

    const nextCost = estimateTokenCost(nextText, model);
    const overBudget = used - budget;
    const minimumTokens = minimumSectionTokens(section.priority);
    const targetBudget = Math.max(minimumTokens, nextCost - overBudget);

    if (targetBudget <= 0 && section.priority !== "required") {
      section.included = false;
      section.text = "";
      section.compressed = false;
      section.truncated = false;
      used -= nextCost;
      continue;
    }

    if (nextCost > targetBudget) {
      const trimmedText = trimTextToTokenBudget(nextText, targetBudget, model);
      if (trimmedText && estimateTokenCost(trimmedText, model) < nextCost) {
        nextText = trimmedText;
        section.truncated = true;
      } else if (section.priority !== "required") {
        section.included = false;
        section.text = "";
        section.compressed = false;
        section.truncated = false;
        used -= nextCost;
        continue;
      }
    }

    const finalCost = estimateTokenCost(nextText, model);
    if (finalCost < currentCost) {
      used -= currentCost - finalCost;
    }
    section.text = nextText;
  }
}

function minimumSectionTokens(priority) {
  switch (priority) {
    case "required":
      return 24;
    case "high":
      return 16;
    case "medium":
      return 8;
    default:
      return 0;
  }
}

function matchesThreadQuery(candidate, normalizedQuery) {
  if (!normalizedQuery) {
    return true;
  }

  const normalizedCandidate = canonicalMemoryKey(candidate);
  if (!normalizedCandidate) {
    return false;
  }

  if (normalizedCandidate === normalizedQuery) {
    return true;
  }

  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  const candidateTokens = normalizedCandidate.split(" ").filter(Boolean);
  if (queryTokens.length > 1) {
    return containsTokenSequence(candidateTokens, queryTokens) || normalizedCandidate.includes(normalizedQuery);
  }

  if (normalizedQuery.length <= 1) {
    return candidateTokens.includes(normalizedQuery);
  }

  return normalizedCandidate.includes(normalizedQuery);
}

function containsTokenSequence(candidateTokens, queryTokens) {
  if (queryTokens.length === 0 || candidateTokens.length < queryTokens.length) {
    return false;
  }

  for (let index = 0; index <= candidateTokens.length - queryTokens.length; index += 1) {
    let matched = true;
    for (let offset = 0; offset < queryTokens.length; offset += 1) {
      if (candidateTokens[index + offset] !== queryTokens[offset]) {
        matched = false;
        break;
      }
    }
    if (matched) {
      return true;
    }
  }

  return false;
}

function buildMemoryRegex(value) {
  try {
    return new RegExp(String(value || ""), "u");
  } catch (error) {
    throw new Error(`Invalid memory regex: ${error.message}`);
  }
}

function dedupeStrings(items) {
  const seen = new Set();
  const result = [];
  for (const item of items) {
    const normalized = normalizeMemoryItem(item);
    if (!normalized) {
      continue;
    }
    const key = canonicalMemoryKey(normalized);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(normalized);
  }
  return result;
}
