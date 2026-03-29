import { safeReadPath, safeWritePath } from "../fs.js";
import { parseFrontmatter, stringifyFrontmatter } from "../frontmatter.js";
import { loadEnv } from "../env.js";
import { updateMemoryFromChapter } from "../memory/rebuild.js";
import {
  buildChapterPlanPrompt,
  buildChapterRewritePlanPrompt,
  buildChapterRewritePrompt,
  buildChapterRevisionPrompt,
  buildDraftPrompt,
  extractTaggedSections,
  normalizePlanOutput
} from "../prompts.js";
import { getChapterArtifacts, getChapterStatuses, getNextChapterId, loadProjectConfig } from "../project.js";
import {
  buildFallbackChapterPlan,
  buildFallbackChapterRevision,
  buildFallbackDraft
} from "../templates.js";
import {
  buildContextWithIntent,
  buildRewriteSupplementalContext,
  emitRuntime,
  normalizeDraftWithLeakGuard,
  printRuntime,
  requestGeneratedText,
  requireChapterId,
  requireNonEmptyText
} from "./runtime.js";

export async function handleChapter(action, chapterId, feedback, runtime) {
  if (!action) {
    throw new Error("Usage: ainovel chapter <plan|write|revise|rewrite|next> <chapter-id> [feedback]");
  }

  if (action === "next") {
    return handleChapterNext(chapterId, runtime);
  }

  if (action === "list") {
    return handleChapterList(runtime);
  }

  if (action === "show") {
    return handleChapterShow(chapterId, runtime);
  }

  if (!chapterId) {
    throw new Error("Usage: ainovel chapter <plan|write|revise|rewrite|next|list> <chapter-id> [feedback]");
  }

  if (action === "plan") {
    return handleChapterPlan(chapterId, runtime);
  }

  if (action === "write") {
    return handleChapterWrite(chapterId, runtime);
  }

  if (action === "revise") {
    return handleChapterRevise(chapterId, feedback, runtime);
  }

  if (action === "rewrite") {
    return handleChapterRewrite(chapterId, feedback, runtime);
  }

  throw new Error(`Unknown chapter action: ${action}`);
}

export async function handleChapterList(runtime) {
  const items = await getChapterStatuses(runtime.rootDir);
  if (items.length === 0) {
    const output = "No chapters yet.";
    printRuntime(runtime, output);
    return { output };
  }

  const lines = ["chapter list"];
  for (const item of items) {
    lines.push(
      `- ${item.chapterId}: plan=${item.hasPlan ? "yes" : "no"}, draft=${item.hasDraft ? "yes" : "no"}, memory=${item.summaryStatus}`
    );
  }
  const output = lines.join("\n");
  printRuntime(runtime, output);
  return { output, statuses: items };
}

export async function handleChapterNext(mode = "plan", runtime) {
  if (!["plan", "write"].includes(mode)) {
    throw new Error("Usage: ainovel chapter next <plan|write>");
  }

  const nextChapterId = await getNextChapterId(runtime.rootDir);
  if (mode === "plan") {
    return handleChapterPlan(nextChapterId, runtime);
  }

  const planRaw = await safeReadPath(runtime.rootDir, `chapters/${nextChapterId}.plan.md`, "");
  if (!planRaw) {
    await handleChapterPlan(nextChapterId, runtime);
  }
  const result = await handleChapterWrite(nextChapterId, runtime);
  return { ...result, currentChapterId: nextChapterId };
}

export async function handleChapterPlan(chapterId, runtime) {
  const { rootDir, config, chapterSlug } = await prepareChapterRuntime(runtime, chapterId, "Usage: ainovel chapter plan <chapter-id>");

  emitRuntime(runtime, "task_started", { task: "chapter-plan", chapterId: chapterSlug });
  emitRuntime(runtime, "phase_changed", { task: "chapter-plan", chapterId: chapterSlug, phase: "assembling_context" });
  const context = (await buildContextWithIntent(rootDir, chapterSlug)).text;
  const fallback = buildFallbackChapterPlan(chapterSlug, context);
  const prompt = buildChapterPlanPrompt(chapterSlug, context);

  emitRuntime(runtime, "phase_changed", { task: "chapter-plan", chapterId: chapterSlug, phase: "calling_model" });
  const llmText = await requestGeneratedText("chapter-plan", prompt, config, runtime, {
    fallbackText: fallback.body
  });
  const normalized = normalizePlanOutput(chapterSlug, llmText, fallback);
  return completePlanChapterAction({
    task: "chapter-plan",
    chapterSlug,
    rootDir,
    runtime,
    normalized,
    outputLabel: "Generated chapter plan"
  });
}

export async function handleChapterWrite(chapterId, runtime) {
  const { rootDir, config, chapterSlug } = await prepareChapterRuntime(runtime, chapterId, "Usage: ainovel chapter write <chapter-id>");
  const { planPath, planRaw, planBody } = await loadChapterSourceDocs(rootDir, chapterSlug);
  if (!planRaw) {
    throw new Error(`Chapter plan not found: ${planPath}`);
  }
  const styleText = await safeReadPath(rootDir, "style.md", "");

  emitRuntime(runtime, "task_started", { task: "draft", chapterId: chapterSlug });
  emitRuntime(runtime, "phase_changed", { task: "draft", chapterId: chapterSlug, phase: "assembling_context" });
  const context = (await buildContextWithIntent(rootDir, chapterSlug)).text;
  const prompt = buildDraftPrompt(chapterSlug, context);
  const fallback = buildFallbackDraft(chapterSlug, planBody, styleText);

  emitRuntime(runtime, "phase_changed", { task: "draft", chapterId: chapterSlug, phase: "calling_model" });
  const llmText = await requestGeneratedText("draft", prompt, config, runtime, {
    fallbackText: fallback.body
  });
  const normalized = await normalizeDraftWithLeakGuard("draft", chapterSlug, llmText, fallback, prompt, config, runtime);
  return completeDraftChapterAction({
    task: "draft",
    chapterSlug,
    rootDir,
    runtime,
    normalized,
    outputLabel: "Generated chapter draft"
  });
}

export async function handleChapterRevise(chapterId, feedback, runtime) {
  const normalizedFeedback = requireNonEmptyText(feedback, "Usage: ainovel chapter revise <chapter-id> <feedback>");

  const { rootDir, config, chapterSlug } = await prepareChapterRuntime(runtime, chapterId, "Usage: ainovel chapter revise <chapter-id> <feedback>");
  const { planRaw, draftRaw, planBody, draftParsed } = await loadChapterSourceDocs(rootDir, chapterSlug);
  if (!planRaw && !draftRaw) {
    throw new Error(`Neither chapter plan nor draft exists for ${chapterSlug}`);
  }

  emitRuntime(runtime, "task_started", { task: "chapter-revise", chapterId: chapterSlug });
  emitRuntime(runtime, "phase_changed", { task: "chapter-revise", chapterId: chapterSlug, phase: "assembling_context" });
  const context = (await buildContextWithIntent(rootDir, chapterSlug)).text;
  const prompt = buildChapterRevisionPrompt(chapterSlug, planBody, draftParsed.content, normalizedFeedback, context);

  emitRuntime(runtime, "phase_changed", { task: "chapter-revise", chapterId: chapterSlug, phase: "calling_model" });
  const llmText = await requestGeneratedText("chapter-revise", prompt, config, runtime, {
    fallbackText: draftRaw ? draftParsed.content : planBody
  });

  if (draftRaw) {
    const styleText = await safeReadPath(rootDir, "style.md", "");
    const fallback = {
      ...buildFallbackDraft(chapterSlug, planBody, styleText),
      body: buildFallbackChapterRevision(draftParsed.content, normalizedFeedback)
    };
    const normalized = await normalizeDraftWithLeakGuard("chapter-revise", chapterSlug, llmText, fallback, prompt, config, runtime);
    return completeDraftChapterAction({
      task: "chapter-revise",
      chapterSlug,
      rootDir,
      runtime,
      normalized,
      outputLabel: "Revised chapter draft"
    });
  }

  const fallback = {
    ...buildFallbackChapterPlan(chapterSlug, context),
    body: buildFallbackChapterRevision(planBody, normalizedFeedback)
  };
  const normalized = normalizePlanOutput(chapterSlug, llmText, fallback);
  return completePlanChapterAction({
    task: "chapter-revise",
    chapterSlug,
    rootDir,
    runtime,
    normalized,
    outputLabel: "Revised chapter plan"
  });
}

export async function handleChapterRewrite(chapterId, feedback, runtime) {
  const { rootDir, config, chapterSlug } = await prepareChapterRuntime(runtime, chapterId, "Usage: ainovel chapter rewrite <chapter-id> [feedback]");
  const { rewritePlanPath, planRaw, draftRaw, planBody, draftParsed } = await loadChapterSourceDocs(rootDir, chapterSlug);
  if (!planRaw && !draftRaw) {
    throw new Error(`Neither chapter plan nor draft exists for ${chapterSlug}`);
  }

  const context = (await buildContextWithIntent(rootDir, chapterSlug)).text;

  emitRuntime(runtime, "task_started", { task: "chapter-rewrite-plan", chapterId: chapterSlug });
  emitRuntime(runtime, "phase_changed", { task: "chapter-rewrite-plan", chapterId: chapterSlug, phase: "planning_retrieval" });
  const retrievalPrompt = buildChapterRewritePlanPrompt(chapterSlug, planBody, draftParsed.content, feedback, context);
  const retrievalFallbackText = buildFallbackRewritePlan(chapterSlug, feedback);
  const retrievalRaw = await requestGeneratedText("chapter-rewrite-plan", retrievalPrompt, config, runtime, {
    fallbackText: retrievalFallbackText,
    stream: false
  });
  const retrievalPlan = parseRewritePlan(retrievalRaw || retrievalFallbackText, chapterSlug);
  const rewritePlanArtifact = await safeWritePath(rootDir, `chapters/${chapterSlug}.rewrite-plan.md`, formatRewritePlanArtifact(chapterSlug, retrievalPlan));
  emitRuntime(runtime, "artifact_written", { task: "chapter-rewrite-plan", chapterId: chapterSlug, artifact: rewritePlanArtifact });
  emitRuntime(runtime, "task_completed", {
    task: "chapter-rewrite-plan",
    chapterId: chapterSlug,
    output: `Planned rewrite retrieval for chapter ${chapterSlug}: ${summarizeRewritePlan(retrievalPlan)}`
  });

  emitRuntime(runtime, "task_started", { task: "chapter-rewrite", chapterId: chapterSlug });
  emitRuntime(runtime, "phase_changed", { task: "chapter-rewrite", chapterId: chapterSlug, phase: "retrieving_context" });
  const supplementalContext = await buildRewriteSupplementalContext(rootDir, retrievalPlan.items);
  const rewritePrompt = buildChapterRewritePrompt(
    chapterSlug,
    planBody,
    draftParsed.content,
    feedback,
    context,
    formatRewritePlanSummary(retrievalPlan),
    supplementalContext
  );
  const rewriteFallback = draftRaw
    ? draftParsed.content
      ? buildFallbackChapterRevision(draftParsed.content, feedback || "按检索计划重写，强化上文承接与结构推进。")
      : draftRaw
    : buildFallbackChapterRevision(planBody, feedback || "按检索计划重写，强化上文承接与结构推进。");

  emitRuntime(runtime, "phase_changed", { task: "chapter-rewrite", chapterId: chapterSlug, phase: "calling_model" });
  const llmText = await requestGeneratedText("chapter-rewrite", rewritePrompt, config, runtime, {
    fallbackText: rewriteFallback
  });

  if (draftRaw) {
    const styleText = await safeReadPath(rootDir, "style.md", "");
    const fallback = {
      ...buildFallbackDraft(chapterSlug, planBody, styleText),
      body: rewriteFallback
    };
    const normalized = await normalizeDraftWithLeakGuard("chapter-rewrite", chapterSlug, llmText, fallback, rewritePrompt, config, runtime);
    return completeDraftChapterAction({
      task: "chapter-rewrite",
      chapterSlug,
      rootDir,
      runtime,
      normalized,
      outputLabel: "Rewrote chapter draft",
      extraMessages: [`Rewrite plan: ${rewritePlanPath}`],
      extraArtifacts: [rewritePlanArtifact]
    });
  }

  const fallback = {
    ...buildFallbackChapterPlan(chapterSlug, context),
    body: rewriteFallback
  };
  const normalized = normalizePlanOutput(chapterSlug, llmText, fallback);
  return completePlanChapterAction({
    task: "chapter-rewrite",
    chapterSlug,
    rootDir,
    runtime,
    normalized,
    outputLabel: "Rewrote chapter plan",
    extraMessages: [`Rewrite plan: ${rewritePlanPath}`],
    extraArtifacts: [rewritePlanArtifact]
  });
}

export async function handleChapterShow(chapterId, runtime) {
  if (!chapterId) {
    throw new Error("Usage: ainovel chapter show <chapter-id>");
  }

  const artifacts = await getChapterArtifacts(runtime.rootDir, requireChapterId(chapterId, "Usage: ainovel chapter show <chapter-id>"));
  const [plan, draft, memory] = await Promise.all([
    safeReadPath(runtime.rootDir, `chapters/${artifacts.chapterId}.plan.md`, ""),
    safeReadPath(runtime.rootDir, `chapters/${artifacts.chapterId}.draft.md`, ""),
    safeReadPath(runtime.rootDir, `memory/chapters/${artifacts.chapterId}.summary.md`, "")
  ]);
  const output = [
    `# Chapter ${artifacts.chapterId}`,
    "",
    "## Plan",
    plan.trim() || "Missing.",
    "",
    "## Draft",
    draft.trim() || "Missing.",
    "",
    "## Memory",
    memory.trim() || "Missing."
  ].join("\n");
  printRuntime(runtime, output);
  return { output, currentChapterId: artifacts.chapterId };
}

function parseRewritePlan(text, currentChapterId) {
  const sections = extractTaggedSections(text || "", ["retrieval_plan", "retrieval_items", "rewrite_focus"]);
  const planText = (sections.retrieval_plan || "").trim() || "- 优先校验与上一章、关键伏笔和人物状态直接相关的前文。";
  const focusText = (sections.rewrite_focus || "").trim() || "- 强化承接、节奏与因果链。";
  const items = String(sections.retrieval_items || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.toLowerCase() !== "none")
    .map((line) => {
      const [chapterId, filesText, ...reasonParts] = line.split("|").map((part) => part.trim());
      const files = String(filesText || "")
        .split(",")
        .map((item) => item.trim())
        .filter((item) => ["plan", "draft", "memory"].includes(item));
      return {
        chapterId: String(chapterId || "").padStart(3, "0"),
        files,
        reason: reasonParts.join(" | ").trim()
      };
    })
    .filter((item) => /^\d{3}$/.test(item.chapterId) && item.chapterId < String(currentChapterId).padStart(3, "0") && item.files.length > 0)
    .slice(0, 4);

  return {
    planText,
    focusText,
    items
  };
}

function buildFallbackRewritePlan(chapterId, feedback) {
  const previousChapter = String(Math.max(0, Number(chapterId) - 1)).padStart(3, "0");
  const items = Number(chapterId) > 1 ? `${previousChapter}|draft,memory|核对上一章结尾驱动力、人物状态和未回收线索。` : "none";
  return [
    "<retrieval_plan>",
    "- 先检查与当前章直接相连的上一章收束点。",
    "- 核对关键人物状态、未回收伏笔和信息揭示顺序。",
    "</retrieval_plan>",
    "<retrieval_items>",
    items,
    "</retrieval_items>",
    "<rewrite_focus>",
    `- ${feedback?.trim() || "提升上文承接、节奏推进和信息组织。"} `,
    "- 让本章开场承接更自然，结尾驱动力更明确。",
    "</rewrite_focus>"
  ].join("\n");
}

function formatRewritePlanArtifact(chapterId, plan) {
  return [
    `# 第${chapterId}章重写检索计划`,
    "",
    "## 检索策略",
    plan.planText,
    "",
    "## 检索目标",
    plan.items.length > 0
      ? plan.items.map((item) => `- 第${item.chapterId}章 [${item.files.join(", ")}] ${item.reason}`.trim()).join("\n")
      : "- 无需额外检索前文章节。",
    "",
    "## 重写重点",
    plan.focusText,
    ""
  ].join("\n");
}

function formatRewritePlanSummary(plan) {
  return [
    "## 检索策略",
    plan.planText,
    "",
    "## 检索目标",
    plan.items.length > 0
      ? plan.items.map((item) => `- 第${item.chapterId}章 [${item.files.join(", ")}] ${item.reason}`.trim()).join("\n")
      : "- 无需额外检索前文章节。",
    "",
    "## 重写重点",
    plan.focusText
  ].join("\n");
}

function summarizeRewritePlan(plan) {
  if (!plan.items.length) {
    return "no extra chapter retrieval needed";
  }
  return plan.items.map((item) => `${item.chapterId}:${item.files.join(",")}`).join(" ");
}

async function prepareChapterRuntime(runtime, chapterId, usage) {
  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);
  const config = await loadProjectConfig(rootDir);
  const chapterSlug = requireChapterId(chapterId, usage);
  return {
    rootDir,
    config,
    chapterSlug
  };
}

async function loadChapterSourceDocs(rootDir, chapterSlug) {
  const planPath = `chapters/${chapterSlug}.plan.md`;
  const draftPath = `chapters/${chapterSlug}.draft.md`;
  const rewritePlanPath = `chapters/${chapterSlug}.rewrite-plan.md`;
  const [planRaw, draftRaw] = await Promise.all([
    safeReadPath(rootDir, planPath, ""),
    safeReadPath(rootDir, draftPath, "")
  ]);

  return {
    planPath: `${rootDir}/${planPath}`.replace(/\/+/g, "/"),
    draftPath: `${rootDir}/${draftPath}`.replace(/\/+/g, "/"),
    rewritePlanPath: `${rootDir}/${rewritePlanPath}`.replace(/\/+/g, "/"),
    planRaw,
    draftRaw,
    planBody: planRaw ? parseFrontmatter(planRaw).content : "",
    draftParsed: draftRaw ? parseFrontmatter(draftRaw) : { data: {}, content: "" }
  };
}

async function completePlanChapterAction({
  task,
  chapterSlug,
  rootDir,
  runtime,
  normalized,
  outputLabel,
  extraMessages = [],
  extraArtifacts = []
}) {
  emitRuntime(runtime, "phase_changed", { task, chapterId: chapterSlug, phase: "writing_files" });
  const filePath = await safeWritePath(rootDir, `chapters/${chapterSlug}.plan.md`, stringifyFrontmatter(normalized.frontmatter, normalized.body));
  emitRuntime(runtime, "artifact_written", { task, chapterId: chapterSlug, artifact: filePath });

  const outputLines = [`${outputLabel}: ${filePath}`, ...extraMessages];
  const output = outputLines.join("\n");
  emitRuntime(runtime, "task_completed", { task, chapterId: chapterSlug, output });
  for (const line of outputLines) {
    printRuntime(runtime, line);
  }

  return {
    output,
    currentChapterId: chapterSlug,
    artifacts: [filePath, ...extraArtifacts]
  };
}

async function completeDraftChapterAction({
  task,
  chapterSlug,
  rootDir,
  runtime,
  normalized,
  outputLabel,
  extraMessages = [],
  extraArtifacts = []
}) {
  emitRuntime(runtime, "phase_changed", { task, chapterId: chapterSlug, phase: "writing_files" });
  const draftPath = await safeWritePath(rootDir, `chapters/${chapterSlug}.draft.md`, stringifyFrontmatter(normalized.frontmatter, normalized.body));
  emitRuntime(runtime, "artifact_written", { task, chapterId: chapterSlug, artifact: draftPath });

  emitRuntime(runtime, "phase_changed", { task, chapterId: chapterSlug, phase: "updating_memory" });
  const memorySummary = await updateMemoryFromChapter(rootDir, chapterSlug);
  emitRuntime(runtime, "memory_updated", { task, chapterId: chapterSlug, summary: memorySummary });

  const outputLines = [`${outputLabel}: ${draftPath}`, ...extraMessages, memorySummary];
  const output = outputLines.join("\n");
  emitRuntime(runtime, "task_completed", { task, chapterId: chapterSlug, output });
  for (const line of outputLines) {
    printRuntime(runtime, line);
  }

  return {
    output,
    currentChapterId: chapterSlug,
    artifacts: [draftPath, ...extraArtifacts]
  };
}
