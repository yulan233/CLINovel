import path from "node:path";
import process from "node:process";
import readline from "node:readline/promises";
import { readText, writeText } from "./fs.js";
import { startTui } from "./tui.js";
import { loadEnv } from "./env.js";
import { exportProject } from "./exporter.js";
import { parseFrontmatter, stringifyFrontmatter } from "./frontmatter.js";
import { describeLlmMode, generateText, streamText } from "./llm.js";
import {
  archiveMemory,
  buildAssembledContext,
  buildContext,
  findMemoryEntity,
  getChapterTags,
  getContinuityWarnings,
  getOpenLoops,
  rebuildMemory,
  searchMemory,
  updateMemoryFromChapter
} from "./memory.js";
import {
  buildIntentContext,
  changePlotOptionStatus,
  changePlotThreadStatus,
  generatePlotOptions,
  getPlotOptions,
  getPlotThread,
  getPlotThreads
} from "./plot.js";
import {
  buildChapterPlanPrompt,
  buildChapterRewritePlanPrompt,
  buildChapterRewritePrompt,
  buildChapterRevisionPrompt,
  buildDraftPrompt,
  buildGuidedOutlinePrompt,
  buildOutlinePrompt,
  buildOutlineRevisionPrompt,
  extractTaggedSections,
  normalizeDraftOutput,
  normalizePlanOutput
} from "./prompts.js";
import {
  getChapterArtifacts,
  getChapterStatuses,
  getNextChapterId,
  initProject,
  loadProjectConfig,
  resolveProjectPaths
} from "./project.js";
import {
  buildFallbackChapterPlan,
  buildFallbackChapterRevision,
  buildFallbackDraft,
  buildFallbackOutline,
  buildFallbackOutlineRevision
} from "./templates.js";

export async function runCli(argv, options = {}) {
  return runCommand(argv, buildRuntime(options));
}

export async function runCommand(argv, options = {}) {
  const runtime = buildRuntime(options);
  const [command, subcommand, arg, ...rest] = argv;
  const trailingText = [subcommand, arg, ...rest].filter((item) => item !== undefined && item !== null && item !== "").join(" ");

  switch (command) {
    case "init":
      return handleInit(subcommand, runtime);
    case "outline":
      return handleOutline(subcommand === "revise" ? subcommand : null, subcommand === "revise" ? [arg, ...rest].filter(Boolean).join(" ") : trailingText, runtime);
    case "guid":
      return handleGuid(runtime);
    case "chapter":
      return handleChapter(subcommand, arg, rest.join(" ").trim(), runtime);
    case "style":
      return handleStyle(subcommand, runtime);
    case "memory":
      return handleMemory(subcommand, [arg, ...rest].filter(Boolean).join(" ").trim(), runtime);
    case "context":
      return handleContext(subcommand, runtime);
    case "doctor":
      return handleDoctor(runtime);
    case "config":
      return handleConfig(runtime);
    case "status":
      return handleStatus(runtime);
    case "export":
      return handleExport(subcommand, runtime);
    case "plot":
      return handlePlot(subcommand, arg, rest.join(" ").trim(), runtime);
    case "tui":
      return handleTui(runtime);
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp(runtime.print);
      return { output: buildHelpText() };
    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function buildRuntime(options = {}) {
  return {
    print: options.print === false ? () => {} : options.print || ((line) => console.log(line)),
    emit: options.emit || (() => {}),
    signal: options.signal,
    stream: Boolean(options.stream),
    interactive: Boolean(options.interactive),
    rootDir: options.rootDir || process.cwd(),
    guideAnswers: options.guideAnswers || null
  };
}

function emit(runtime, type, payload = {}) {
  runtime.emit({
    type,
    timestamp: new Date().toISOString(),
    ...payload
  });
}

function print(runtime, output) {
  if (!output) {
    return;
  }
  runtime.print(output);
}

async function handleInit(nameArg, runtime) {
  const rootDir = nameArg ? path.resolve(process.cwd(), nameArg) : process.cwd();
  const name = path.basename(rootDir);
  await initProject(rootDir, name);
  const output = `Initialized novel project at ${rootDir}
Next steps:
  1. cd ${rootDir}
  2. cp .env.example .env
  3. edit .env and set AINOVEL_API_KEY / AINOVEL_BASE_URL / AINOVEL_MODEL
  4. ainovel doctor`;
  print(runtime, output);
  return {
    output,
    artifacts: [rootDir]
  };
}

async function handleOutline(action, feedback, runtime) {
  if (action === "revise") {
    return handleOutlineRevise(feedback, runtime);
  }

  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);
  const config = await loadProjectConfig(rootDir);
  const paths = resolveProjectPaths(rootDir);
  const styleText = await readText(paths.style, "");
  const plotIntent = await buildIntentContext(rootDir);
  const requirements = [action, feedback].filter(Boolean).join(" ").trim();
  const prompt = buildOutlinePrompt(config, [styleText, plotIntent].filter(Boolean).join("\n\n"), requirements);
  const fallback = buildFallbackOutline(config, styleText);

  emit(runtime, "task_started", { task: "outline" });
  emit(runtime, "phase_changed", { task: "outline", phase: "calling_model" });
  const llmText = await requestGeneratedText("outline", prompt, config, runtime, {
    fallbackText: buildOutlineFallbackStream(fallback)
  });

  emit(runtime, "phase_changed", { task: "outline", phase: "writing_files" });
  const artifacts = await writeOutlineArtifacts(rootDir, llmText, fallback, runtime, "outline");
  const output = "Generated outline files.";
  emit(runtime, "task_completed", { task: "outline", output });
  print(runtime, output);
  return {
    output,
    artifacts
  };
}

async function handleGuid(runtime) {
  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);
  const config = await loadProjectConfig(rootDir);
  const paths = resolveProjectPaths(rootDir);
  const styleText = await readText(paths.style, "");
  const guideAnswers = runtime.guideAnswers || (await collectGuideAnswersInteractive());
  const prompt = buildGuidedOutlinePrompt(config, guideAnswers, styleText);
  const fallback = buildFallbackOutline(config, styleText);

  emit(runtime, "task_started", { task: "guid" });
  emit(runtime, "phase_changed", { task: "guid", phase: "calling_model" });
  const llmText = await requestGeneratedText("guid", prompt, config, runtime, {
    fallbackText: buildOutlineFallbackStream(fallback)
  });

  emit(runtime, "phase_changed", { task: "guid", phase: "writing_files" });
  const artifacts = await writeOutlineArtifacts(rootDir, llmText, fallback, runtime, "guid");
  const output = "Generated guided outline files.";
  emit(runtime, "task_completed", { task: "guid", output });
  print(runtime, output);
  return {
    output,
    artifacts,
    guideAnswers
  };
}

async function handleOutlineRevise(feedback, runtime) {
  if (!feedback) {
    throw new Error("Usage: ainovel outline revise <feedback>");
  }

  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);
  const config = await loadProjectConfig(rootDir);
  const paths = resolveProjectPaths(rootDir);
  const styleText = await readText(paths.style, "");
  const plotIntent = await buildIntentContext(rootDir);
  const existingStory = await readText(paths.outlineStory, "");
  const existingArcs = await readText(paths.outlineArcs, "");
  const existingCharacters = await readText(paths.characters, "");
  const existingWorld = await readText(paths.world, "");
  const currentOutline = [existingStory, existingArcs, existingCharacters, existingWorld].join("\n\n");
  const prompt = buildOutlineRevisionPrompt(currentOutline, feedback, [styleText, plotIntent].filter(Boolean).join("\n\n"));

  emit(runtime, "task_started", { task: "outline-revise" });
  emit(runtime, "phase_changed", { task: "outline-revise", phase: "calling_model" });
  const llmText = await requestGeneratedText("outline-revise", prompt, config, runtime, {
    fallbackText: currentOutline || feedback
  });

  emit(runtime, "phase_changed", { task: "outline-revise", phase: "writing_files" });
  const sections = extractTaggedSections(llmText || "", ["story", "arcs", "characters", "world"]);
  await writeText(
    paths.outlineStory,
    (sections.story || buildFallbackOutlineRevision(existingStory, feedback)).trim() + "\n"
  );
  emit(runtime, "artifact_written", { task: "outline-revise", artifact: paths.outlineStory });
  await writeText(
    paths.outlineArcs,
    (sections.arcs || buildFallbackOutlineRevision(existingArcs, feedback)).trim() + "\n"
  );
  emit(runtime, "artifact_written", { task: "outline-revise", artifact: paths.outlineArcs });
  await writeText(
    paths.characters,
    (sections.characters || buildFallbackOutlineRevision(existingCharacters, feedback)).trim() + "\n"
  );
  emit(runtime, "artifact_written", { task: "outline-revise", artifact: paths.characters });
  await writeText(
    paths.world,
    (sections.world || buildFallbackOutlineRevision(existingWorld, feedback)).trim() + "\n"
  );
  emit(runtime, "artifact_written", { task: "outline-revise", artifact: paths.world });

  const output = "Revised outline files.";
  emit(runtime, "task_completed", { task: "outline-revise", output });
  print(runtime, output);
  return {
    output,
    artifacts: [paths.outlineStory, paths.outlineArcs, paths.characters, paths.world]
  };
}

async function handleChapter(action, chapterId, feedback, runtime) {
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

async function handleChapterList(runtime) {
  const items = await getChapterStatuses(runtime.rootDir);
  if (items.length === 0) {
    const output = "No chapters yet.";
    print(runtime, output);
    return { output };
  }

  const lines = ["chapter list"];
  for (const item of items) {
    lines.push(
      `- ${item.chapterId}: plan=${item.hasPlan ? "yes" : "no"}, draft=${item.hasDraft ? "yes" : "no"}, memory=${item.summaryStatus}`
    );
  }
  const output = lines.join("\n");
  print(runtime, output);
  return { output, statuses: items };
}

async function handleChapterNext(mode = "plan", runtime) {
  if (!["plan", "write"].includes(mode)) {
    throw new Error("Usage: ainovel chapter next <plan|write>");
  }

  const nextChapterId = await getNextChapterId(runtime.rootDir);
  if (mode === "plan") {
    return handleChapterPlan(nextChapterId, runtime);
  }

  const planPath = path.join(runtime.rootDir, "chapters", `${nextChapterId}.plan.md`);
  const planRaw = await readText(planPath, "");
  if (!planRaw) {
    await handleChapterPlan(nextChapterId, runtime);
  }
  const result = await handleChapterWrite(nextChapterId, runtime);
  return { ...result, currentChapterId: nextChapterId };
}

async function handleChapterPlan(chapterId, runtime) {
  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);
  const config = await loadProjectConfig(rootDir);
  const chapterSlug = String(chapterId).padStart(3, "0");

  emit(runtime, "task_started", { task: "chapter-plan", chapterId: chapterSlug });
  emit(runtime, "phase_changed", { task: "chapter-plan", chapterId: chapterSlug, phase: "assembling_context" });
  const context = (await buildContextWithIntent(rootDir, chapterSlug)).text;
  const fallback = buildFallbackChapterPlan(chapterSlug, context);
  const prompt = buildChapterPlanPrompt(chapterSlug, context);

  emit(runtime, "phase_changed", { task: "chapter-plan", chapterId: chapterSlug, phase: "calling_model" });
  const llmText = await requestGeneratedText("chapter-plan", prompt, config, runtime, {
    fallbackText: fallback.body
  });
  const normalized = normalizePlanOutput(chapterSlug, llmText, fallback);
  const filePath = path.join(rootDir, "chapters", `${chapterSlug}.plan.md`);

  emit(runtime, "phase_changed", { task: "chapter-plan", chapterId: chapterSlug, phase: "writing_files" });
  await writeText(filePath, stringifyFrontmatter(normalized.frontmatter, normalized.body));
  emit(runtime, "artifact_written", { task: "chapter-plan", chapterId: chapterSlug, artifact: filePath });

  const output = `Generated chapter plan: ${filePath}`;
  emit(runtime, "task_completed", { task: "chapter-plan", chapterId: chapterSlug, output });
  print(runtime, output);
  return {
    output,
    currentChapterId: chapterSlug,
    artifacts: [filePath]
  };
}

async function handleChapterWrite(chapterId, runtime) {
  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);
  const config = await loadProjectConfig(rootDir);
  const chapterSlug = String(chapterId).padStart(3, "0");
  const paths = resolveProjectPaths(rootDir);
  const styleText = await readText(paths.style, "");
  const planPath = path.join(rootDir, "chapters", `${chapterSlug}.plan.md`);
  const planRaw = await readText(planPath);
  if (!planRaw) {
    throw new Error(`Chapter plan not found: ${planPath}`);
  }

  emit(runtime, "task_started", { task: "draft", chapterId: chapterSlug });
  emit(runtime, "phase_changed", { task: "draft", chapterId: chapterSlug, phase: "assembling_context" });
  const { content: planBody } = parseFrontmatter(planRaw);
  const context = (await buildContextWithIntent(rootDir, chapterSlug)).text;
  const prompt = buildDraftPrompt(chapterSlug, context);
  const fallback = buildFallbackDraft(chapterSlug, planBody, styleText);

  emit(runtime, "phase_changed", { task: "draft", chapterId: chapterSlug, phase: "calling_model" });
  const llmText = await requestGeneratedText("draft", prompt, config, runtime, {
    fallbackText: fallback.body
  });
  const normalized = await normalizeDraftWithLeakGuard("draft", chapterSlug, llmText, fallback, prompt, config, runtime);
  const draftPath = path.join(rootDir, "chapters", `${chapterSlug}.draft.md`);

  emit(runtime, "phase_changed", { task: "draft", chapterId: chapterSlug, phase: "writing_files" });
  await writeText(draftPath, stringifyFrontmatter(normalized.frontmatter, normalized.body));
  emit(runtime, "artifact_written", { task: "draft", chapterId: chapterSlug, artifact: draftPath });

  emit(runtime, "phase_changed", { task: "draft", chapterId: chapterSlug, phase: "updating_memory" });
  const memorySummary = await updateMemoryFromChapter(rootDir, chapterSlug);
  emit(runtime, "memory_updated", { task: "draft", chapterId: chapterSlug, summary: memorySummary });

  const output = `Generated chapter draft: ${draftPath}\n${memorySummary}`;
  emit(runtime, "task_completed", { task: "draft", chapterId: chapterSlug, output });
  print(runtime, `Generated chapter draft: ${draftPath}`);
  print(runtime, memorySummary);
  return {
    output,
    currentChapterId: chapterSlug,
    artifacts: [draftPath]
  };
}

async function handleChapterRevise(chapterId, feedback, runtime) {
  if (!feedback) {
    throw new Error("Usage: ainovel chapter revise <chapter-id> <feedback>");
  }

  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);
  const config = await loadProjectConfig(rootDir);
  const chapterSlug = String(chapterId).padStart(3, "0");
  const planPath = path.join(rootDir, "chapters", `${chapterSlug}.plan.md`);
  const draftPath = path.join(rootDir, "chapters", `${chapterSlug}.draft.md`);
  const planRaw = await readText(planPath, "");
  const draftRaw = await readText(draftPath, "");
  if (!planRaw && !draftRaw) {
    throw new Error(`Neither chapter plan nor draft exists for ${chapterSlug}`);
  }

  emit(runtime, "task_started", { task: "chapter-revise", chapterId: chapterSlug });
  emit(runtime, "phase_changed", { task: "chapter-revise", chapterId: chapterSlug, phase: "assembling_context" });
  const planBody = planRaw ? parseFrontmatter(planRaw).content : "";
  const draftParsed = draftRaw ? parseFrontmatter(draftRaw) : { data: {}, content: "" };
  const context = (await buildContextWithIntent(rootDir, chapterSlug)).text;
  const prompt = buildChapterRevisionPrompt(chapterSlug, planBody, draftParsed.content, feedback, context);

  emit(runtime, "phase_changed", { task: "chapter-revise", chapterId: chapterSlug, phase: "calling_model" });
  const llmText = await requestGeneratedText("chapter-revise", prompt, config, runtime, {
    fallbackText: draftRaw ? draftParsed.content : planBody
  });

  if (draftRaw) {
    const paths = resolveProjectPaths(rootDir);
    const styleText = await readText(paths.style, "");
    const fallback = {
      ...buildFallbackDraft(chapterSlug, planBody, styleText),
      body: buildFallbackChapterRevision(draftParsed.content, feedback)
    };
    const normalized = await normalizeDraftWithLeakGuard("chapter-revise", chapterSlug, llmText, fallback, prompt, config, runtime);
    emit(runtime, "phase_changed", { task: "chapter-revise", chapterId: chapterSlug, phase: "writing_files" });
    await writeText(draftPath, stringifyFrontmatter(normalized.frontmatter, normalized.body));
    emit(runtime, "artifact_written", { task: "chapter-revise", chapterId: chapterSlug, artifact: draftPath });
    emit(runtime, "phase_changed", { task: "chapter-revise", chapterId: chapterSlug, phase: "updating_memory" });
    const summary = await updateMemoryFromChapter(rootDir, chapterSlug);
    emit(runtime, "memory_updated", { task: "chapter-revise", chapterId: chapterSlug, summary });
    const output = `Revised chapter draft: ${draftPath}\n${summary}`;
    emit(runtime, "task_completed", { task: "chapter-revise", chapterId: chapterSlug, output });
    print(runtime, `Revised chapter draft: ${draftPath}`);
    print(runtime, summary);
    return {
      output,
      currentChapterId: chapterSlug,
      artifacts: [draftPath]
    };
  }

  const fallback = {
    ...buildFallbackChapterPlan(chapterSlug, context),
    body: buildFallbackChapterRevision(planBody, feedback)
  };
  const normalized = normalizePlanOutput(chapterSlug, llmText, fallback);
  emit(runtime, "phase_changed", { task: "chapter-revise", chapterId: chapterSlug, phase: "writing_files" });
  await writeText(planPath, stringifyFrontmatter(normalized.frontmatter, normalized.body));
  emit(runtime, "artifact_written", { task: "chapter-revise", chapterId: chapterSlug, artifact: planPath });
  const output = `Revised chapter plan: ${planPath}`;
  emit(runtime, "task_completed", { task: "chapter-revise", chapterId: chapterSlug, output });
  print(runtime, output);
  return {
    output,
    currentChapterId: chapterSlug,
    artifacts: [planPath]
  };
}

async function handleChapterRewrite(chapterId, feedback, runtime) {
  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);
  const config = await loadProjectConfig(rootDir);
  const chapterSlug = String(chapterId).padStart(3, "0");
  const paths = resolveProjectPaths(rootDir);
  const planPath = path.join(rootDir, "chapters", `${chapterSlug}.plan.md`);
  const draftPath = path.join(rootDir, "chapters", `${chapterSlug}.draft.md`);
  const rewritePlanPath = path.join(rootDir, "chapters", `${chapterSlug}.rewrite-plan.md`);
  const planRaw = await readText(planPath, "");
  const draftRaw = await readText(draftPath, "");
  if (!planRaw && !draftRaw) {
    throw new Error(`Neither chapter plan nor draft exists for ${chapterSlug}`);
  }

  const planBody = planRaw ? parseFrontmatter(planRaw).content : "";
  const draftParsed = draftRaw ? parseFrontmatter(draftRaw) : { data: {}, content: "" };
  const context = (await buildContextWithIntent(rootDir, chapterSlug)).text;

  emit(runtime, "task_started", { task: "chapter-rewrite-plan", chapterId: chapterSlug });
  emit(runtime, "phase_changed", { task: "chapter-rewrite-plan", chapterId: chapterSlug, phase: "planning_retrieval" });
  const retrievalPrompt = buildChapterRewritePlanPrompt(chapterSlug, planBody, draftParsed.content, feedback, context);
  const retrievalFallbackText = buildFallbackRewritePlan(chapterSlug, feedback);
  const retrievalRaw = await requestGeneratedText("chapter-rewrite-plan", retrievalPrompt, config, runtime, {
    fallbackText: retrievalFallbackText,
    stream: false
  });
  const retrievalPlan = parseRewritePlan(retrievalRaw || retrievalFallbackText, chapterSlug);
  await writeText(rewritePlanPath, formatRewritePlanArtifact(chapterSlug, retrievalPlan));
  emit(runtime, "artifact_written", { task: "chapter-rewrite-plan", chapterId: chapterSlug, artifact: rewritePlanPath });
  emit(runtime, "task_completed", {
    task: "chapter-rewrite-plan",
    chapterId: chapterSlug,
    output: `Planned rewrite retrieval for chapter ${chapterSlug}: ${summarizeRewritePlan(retrievalPlan)}`
  });

  emit(runtime, "task_started", { task: "chapter-rewrite", chapterId: chapterSlug });
  emit(runtime, "phase_changed", { task: "chapter-rewrite", chapterId: chapterSlug, phase: "retrieving_context" });
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

  emit(runtime, "phase_changed", { task: "chapter-rewrite", chapterId: chapterSlug, phase: "calling_model" });
  const llmText = await requestGeneratedText("chapter-rewrite", rewritePrompt, config, runtime, {
    fallbackText: rewriteFallback
  });

  if (draftRaw) {
    const styleText = await readText(paths.style, "");
    const fallback = {
      ...buildFallbackDraft(chapterSlug, planBody, styleText),
      body: rewriteFallback
    };
    const normalized = await normalizeDraftWithLeakGuard("chapter-rewrite", chapterSlug, llmText, fallback, rewritePrompt, config, runtime);
    emit(runtime, "phase_changed", { task: "chapter-rewrite", chapterId: chapterSlug, phase: "writing_files" });
    await writeText(draftPath, stringifyFrontmatter(normalized.frontmatter, normalized.body));
    emit(runtime, "artifact_written", { task: "chapter-rewrite", chapterId: chapterSlug, artifact: draftPath });
    emit(runtime, "phase_changed", { task: "chapter-rewrite", chapterId: chapterSlug, phase: "updating_memory" });
    const summary = await updateMemoryFromChapter(rootDir, chapterSlug);
    emit(runtime, "memory_updated", { task: "chapter-rewrite", chapterId: chapterSlug, summary });
    const output = `Rewrote chapter draft: ${draftPath}\nRewrite plan: ${rewritePlanPath}\n${summary}`;
    emit(runtime, "task_completed", { task: "chapter-rewrite", chapterId: chapterSlug, output });
    print(runtime, `Rewrote chapter draft: ${draftPath}`);
    print(runtime, `Rewrite plan: ${rewritePlanPath}`);
    print(runtime, summary);
    return {
      output,
      currentChapterId: chapterSlug,
      artifacts: [draftPath, rewritePlanPath]
    };
  }

  const fallback = {
    ...buildFallbackChapterPlan(chapterSlug, context),
    body: rewriteFallback
  };
  const normalized = normalizePlanOutput(chapterSlug, llmText, fallback);
  emit(runtime, "phase_changed", { task: "chapter-rewrite", chapterId: chapterSlug, phase: "writing_files" });
  await writeText(planPath, stringifyFrontmatter(normalized.frontmatter, normalized.body));
  emit(runtime, "artifact_written", { task: "chapter-rewrite", chapterId: chapterSlug, artifact: planPath });
  const output = `Rewrote chapter plan: ${planPath}\nRewrite plan: ${rewritePlanPath}`;
  emit(runtime, "task_completed", { task: "chapter-rewrite", chapterId: chapterSlug, output });
  print(runtime, `Rewrote chapter plan: ${planPath}`);
  print(runtime, `Rewrite plan: ${rewritePlanPath}`);
  return {
    output,
    currentChapterId: chapterSlug,
    artifacts: [planPath, rewritePlanPath]
  };
}

async function handleChapterShow(chapterId, runtime) {
  if (!chapterId) {
    throw new Error("Usage: ainovel chapter show <chapter-id>");
  }

  const artifacts = await getChapterArtifacts(runtime.rootDir, chapterId);
  const [plan, draft, memory] = await Promise.all([
    readText(artifacts.planPath, ""),
    readText(artifacts.draftPath, ""),
    readText(artifacts.memoryPath, "")
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
  print(runtime, output);
  return { output, currentChapterId: artifacts.chapterId };
}

async function handleStyle(action, runtime) {
  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);
  const paths = resolveProjectPaths(rootDir);
  const current = await readText(paths.style, "");

  if (action === "show" || !action) {
    print(runtime, current);
    return { output: current };
  }

  if (action === "template") {
    const output = [
      "# 文风配置",
      "",
      "- 叙事视角：第三人称有限视角",
      "- 语言风格：冷峻克制，细节密度高",
      "- 节奏：前慢后快，关键冲突前压缩铺垫",
      "- 对白要求：角色口吻清晰区分，避免解释型对白",
      "- 禁写法：流水账、连续空泛感叹、重复比喻",
      "- 参考气质：悬疑推进强，章节结尾留钩子",
      "",
      "补充说明：",
      "希望整体更有宿命感，但人物行动逻辑要充分。"
    ].join("\n");
    print(runtime, output);
    return { output };
  }

  throw new Error("Usage: ainovel style [show|template]");
}

async function handleMemory(action, value, runtime) {
  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);
  switch (action) {
    case "summarize": {
      const updates = await rebuildMemory(rootDir);
      const output = `Memory summarized for ${updates.length} chapter(s).`;
      print(runtime, output);
      return { output };
    }
    case "rebuild": {
      const updates = await rebuildMemory(rootDir);
      const output = `Memory rebuilt from ${updates.length} draft(s).`;
      print(runtime, output);
      return { output };
    }
    case "archive": {
      const result = await archiveMemory(rootDir);
      const output = `Archived ${result.archivedCount} chapter(s); retained ${result.retainedCount} recent chapter(s).`;
      print(runtime, output);
      return { output };
    }
    case "loops": {
      const loops = await getOpenLoops(rootDir);
      const output = loops.length
        ? ["Open loops:", ...loops.map((item) => `- ${item.title} (latest ${item.latestChapterId})`)].join("\n")
        : "Open loops: none.";
      print(runtime, output);
      return { output, loops };
    }
    case "warnings": {
      const warnings = await getContinuityWarnings(rootDir);
      const output = warnings.length
        ? ["Continuity warnings:", ...warnings.map((item) => `- [${item.severity}] ${item.message}`)].join("\n")
        : "Continuity warnings: none.";
      print(runtime, output);
      return { output, warnings };
    }
    case "entity": {
      return handleMemoryEntity(value, runtime);
    }
    case "tags": {
      const tags = await getChapterTags(rootDir, value || null);
      const output = Array.isArray(tags) && tags.length && typeof tags[0] === "string"
        ? [`Chapter ${String(value).padStart(3, "0")} tags:`, ...tags.map((item) => `- ${item}`)].join("\n")
        : tags.length
          ? tags.map((item) => `- ${item.chapterId}: ${(item.tags || []).join(", ") || "-"}`).join("\n")
          : "No chapter tags available.";
      print(runtime, output);
      return { output, tags };
    }
    case "search": {
      return handleMemorySearch(value, runtime);
    }
    default:
      throw new Error("Usage: ainovel memory <summarize|rebuild|archive|loops|warnings|entity|tags|search>");
  }
}

async function handleContext(chapterId, runtime) {
  if (!chapterId) {
    throw new Error("Usage: ainovel context <chapter-id>");
  }
  await loadEnv(runtime.rootDir);
  const assembled = await buildContextWithIntent(runtime.rootDir, chapterId);
  const output = assembled.text;
  print(runtime, output);
  return { output, currentChapterId: String(chapterId).padStart(3, "0"), contextSections: assembled.sections };
}

async function handleDoctor(runtime) {
  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);
  const config = await loadProjectConfig(rootDir);
  const paths = resolveProjectPaths(rootDir);
  const llm = describeLlmMode(config);

  const checks = [
    ["project.yaml", (await readText(paths.config, "")) ? "ok" : "missing"],
    ["style.md", (await readText(paths.style, "")) ? "ok" : "missing"],
    [".env.example", (await readText(paths.envExample, "")) ? "ok" : "missing"],
    ["AINOVEL_API_KEY", llm.apiKey ? "set" : "missing"],
    ["AINOVEL_BASE_URL", llm.baseUrl || "missing"],
    ["AINOVEL_MODEL", llm.model || "missing"],
    ["LLM mode", llm.remoteEnabled ? "remote" : "fallback-local"]
  ];

  const output = [
    "ainovel doctor",
    ...checks.map(([label, value]) => `- ${label}: ${value}`),
    !llm.remoteEnabled
      ? "- hint: copy .env.example to .env and fill in your API config to enable remote generation"
      : null
  ]
    .filter(Boolean)
    .join("\n");
  print(runtime, output);
  return { output, checks };
}

async function handleConfig(runtime) {
  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);
  const config = await loadProjectConfig(rootDir);
  const llm = describeLlmMode(config);

  const output = [
    "# Project config",
    `title: ${config.title || ""}`,
    `genre: ${config.genre || ""}`,
    `target_length: ${config.target_length || ""}`,
    `context_budget: ${config.context_budget || ""}`,
    `summary_policy: ${config.summary_policy || ""}`,
    "",
    "# LLM config",
    `model: ${llm.model}`,
    `base_url: ${llm.baseUrl}`,
    `api_key: ${llm.maskedApiKey}`,
    `mode: ${llm.remoteEnabled ? "remote" : "fallback-local"}`
  ].join("\n");
  print(runtime, output);
  return { output, config, llm };
}

async function handleStatus(runtime) {
  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);
  const config = await loadProjectConfig(rootDir);
  const statuses = await getChapterStatuses(rootDir);
  const paths = resolveProjectPaths(rootDir);
  const [story, arcs] = await Promise.all([readText(paths.outlineStory, ""), readText(paths.outlineArcs, "")]);

  const planned = statuses.filter((item) => item.hasPlan).length;
  const drafted = statuses.filter((item) => item.hasDraft).length;
  const memoryDone = statuses.filter((item) => item.summaryStatus === "complete").length;

  const output = [
    "ainovel status",
    `- title: ${config.title || ""}`,
    `- outline_story: ${story && !story.includes("等待生成") ? "ready" : "pending"}`,
    `- outline_arcs: ${arcs && !arcs.includes("等待生成") ? "ready" : "pending"}`,
    `- chapters_total: ${statuses.length}`,
    `- chapters_planned: ${planned}`,
    `- chapters_drafted: ${drafted}`,
    `- memory_complete: ${memoryDone}`
  ].join("\n");
  print(runtime, output);
  return {
    output,
    stats: {
      title: config.title || "",
      outlineStoryReady: Boolean(story && !story.includes("等待生成")),
      outlineArcsReady: Boolean(arcs && !arcs.includes("等待生成")),
      total: statuses.length,
      planned,
      drafted,
      memoryDone
    },
    statuses
  };
}

async function handleExport(outputPathArg, runtime) {
  const rootDir = runtime.rootDir;
  let format = "md";
  let outputPath;
  if (outputPathArg === "--txt") {
    format = "txt";
  } else if (outputPathArg === "--epub") {
    format = "epub";
  } else if (outputPathArg) {
    outputPath = path.resolve(rootDir, outputPathArg);
    if (outputPath.endsWith(".txt")) {
      format = "txt";
    } else if (outputPath.endsWith(".epub")) {
      format = "epub";
    }
  }
  const target = await exportProject(rootDir, outputPath, format);
  const output = `Exported novel bundle: ${target}`;
  print(runtime, output);
  return { output, artifacts: [target] };
}

async function handlePlot(action, target, rest, runtime) {
  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);

  if (action === "generate") {
    if (!["chapter", "book"].includes(target)) {
      throw new Error("Usage: ainovel plot generate <chapter|book> [chapter-id]");
    }
    const chapterId = target === "chapter" ? targetChapter(target, rest) : null;
    emit(runtime, "task_started", { task: "plot-options", scope: target, chapterId });
    emit(runtime, "plot_options_started", { scope: target, chapterId });
    const result = await generatePlotOptions(rootDir, target, chapterId, runtime);
    emit(runtime, "plot_options_completed", {
      scope: target,
      chapterId,
      count: result.options.length,
      artifact: result.artifact
    });
    const output = formatPlotOptionsOutput(result.options, result.plotState.activeThreads || [], result.plotState.activeIntent);
    print(runtime, output);
    return {
      output,
      currentChapterId: chapterId || null,
      plotOptions: result.options,
      artifacts: [result.artifact]
    };
  }

  if (["keep", "drop", "apply"].includes(action)) {
    if (!target) {
      throw new Error(`Usage: ainovel plot ${action} <option-id>`);
    }
    const status = action === "keep" ? "kept" : action === "drop" ? "dropped" : "applied";
    const result = await changePlotOptionStatus(rootDir, target, status);
    emit(runtime, "plot_option_status_changed", { optionId: target, status, artifact: result.artifact });
    if (status === "applied") {
      emit(runtime, "plot_option_applied", {
        optionId: target,
        artifact: result.artifact,
        activeIntent: result.plotState.activeIntent
      });
    }
    const output = status === "applied" && result.thread
      ? `Plot option ${target} marked as ${status}. Thread ${result.thread.id} is now active.`
      : `Plot option ${target} marked as ${status}.`;
    print(runtime, output);
    return {
      output,
      plotState: result.plotState,
      artifacts: [result.artifact]
    };
  }

  if (["resolve", "pause", "resume"].includes(action)) {
    if (!target) {
      throw new Error(`Usage: ainovel plot ${action} <thread-id> [chapter-id]`);
    }
    const nextStatus = action === "resolve" ? "resolved" : action === "pause" ? "paused" : "active";
    const result = await changePlotThreadStatus(rootDir, target, nextStatus, firstWord(rest) || null);
    const output = `Plot thread ${target} marked as ${nextStatus}.`;
    print(runtime, output);
    return { output, plotState: result.plotState, artifacts: [result.artifact] };
  }

  if (action === "thread") {
    if (!target) {
      throw new Error("Usage: ainovel plot thread <thread-id>");
    }
    const thread = await getPlotThread(rootDir, target);
    if (!thread) {
      throw new Error(`Plot thread not found: ${target}`);
    }
    const output = formatPlotThreadOutput(thread);
    print(runtime, output);
    return { output, thread };
  }

  if (!action || action === "list") {
    const scope = target === "chapter" || target === "book" ? target : null;
    const chapterId = scope === "chapter" ? firstWord(rest) || null : null;
    const result = await getPlotOptions(rootDir, {
      scope,
      chapterId
    });
    const output = formatPlotOptionsOutput(result.options, result.activeThreads, result.activeIntent, result.threads);
    print(runtime, output);
    return { output, plotState: result };
  }

  throw new Error("Usage: ainovel plot <generate|list|keep|drop|apply|thread|resolve|pause|resume> ...");
}

async function handleTui(runtime) {
  await startTui({
    runCommand: (argv, options = {}) =>
      runCommand(argv, {
        rootDir: runtime.rootDir,
        ...options
      }),
    printHelp: buildHelpText
  });
  return { output: "Closed TUI session." };
}

async function requestGeneratedText(task, prompt, config, runtime, options = {}) {
  if (options.stream === false) {
    return (await generateText(task, prompt, config)) || options.fallbackText || null;
  }

  if (!runtime.stream) {
    return generateText(task, prompt, config);
  }

  return streamText(task, prompt, config, {
    signal: runtime.signal,
    fallbackText: options.fallbackText,
    onToken(chunk, fullText) {
      emit(runtime, "token", {
        task,
        chunk,
        fullText
      });
    }
  });
}

async function normalizeDraftWithLeakGuard(task, chapterId, llmText, fallbackDraft, prompt, config, runtime) {
  let normalized = normalizeDraftOutput(chapterId, llmText, fallbackDraft);
  if (!containsAiLeak(normalized.body)) {
    return normalized;
  }

  emit(runtime, "warning", {
    task,
    chapterId,
    message: "Detected AI meta narration in draft output; retrying once."
  });
  const retryText = await requestGeneratedText(task, `${prompt}\n\n再次提醒：禁止输出任何元叙述、自我说明、思考过程。`, config, runtime, {
    fallbackText: fallbackDraft.body,
    stream: false
  });
  normalized = normalizeDraftOutput(chapterId, retryText, fallbackDraft);
  if (!containsAiLeak(normalized.body)) {
    return normalized;
  }

  emit(runtime, "warning", {
    task,
    chapterId,
    message: "AI meta narration persisted after retry; applying cleanup."
  });
  return {
    frontmatter: normalized.frontmatter,
    body: cleanupAiLeak(normalized.body) || fallbackDraft.body
  };
}

function containsAiLeak(text) {
  return /以下是|我将|我会|我认为|作为ai|作为 AI|这里是|思考过程|创作说明|写作说明/.test(String(text || ""));
}

function cleanupAiLeak(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => !/以下是|我将|我会|我认为|作为ai|作为 AI|这里是|思考过程|创作说明|写作说明/.test(line))
    .join("\n")
    .trim();
}

function buildOutlineFallbackStream(fallback) {
  return [fallback.story, fallback.arcs, fallback.characters, fallback.world].filter(Boolean).join("\n\n");
}

async function buildContextWithIntent(rootDir, chapterId) {
  const [assembled, intent] = await Promise.all([
    buildAssembledContext(rootDir, chapterId),
    buildIntentContext(rootDir, chapterId)
  ]);
  const sections = [...assembled.sections];
  if (intent.trim()) {
    sections.push({
      id: "intent",
      heading: "剧情意图",
      label: "剧情意图",
      text: intent.trim(),
      priority: "high",
      included: true,
      compressed: false
    });
  }
  return {
    budget: assembled.budget,
    sections,
    text: sections
      .filter((section) => section.included && section.text)
      .map((section) => `# ${section.heading}\n${section.text}`)
      .join("\n\n")
  };
}

async function buildRewriteSupplementalContext(rootDir, items) {
  const paths = resolveProjectPaths(rootDir);
  const sections = [];

  for (const item of items.slice(0, 4)) {
    const chapterSlug = String(item.chapterId).padStart(3, "0");
    for (const file of item.files) {
      let raw = "";
      let heading = "";
      if (file === "plan") {
        raw = await readText(path.join(rootDir, "chapters", `${chapterSlug}.plan.md`), "");
        heading = `第${chapterSlug}章计划`;
      } else if (file === "draft") {
        raw = await readText(path.join(rootDir, "chapters", `${chapterSlug}.draft.md`), "");
        heading = `第${chapterSlug}章正文`;
      } else if (file === "memory") {
        raw = await readText(path.join(paths.memoryChaptersDir, `${chapterSlug}.summary.md`), "");
        heading = `第${chapterSlug}章记忆摘要`;
      }

      const text = file === "memory" ? raw.trim() : (raw ? parseFrontmatter(raw).content : "").trim();
      if (!text) {
        continue;
      }

      sections.push(`## ${heading}\n${text}`);
    }
  }

  return sections.join("\n\n");
}

async function handleMemoryEntity(name, runtime) {
  if (!name) {
    throw new Error("Usage: ainovel memory entity <name>");
  }

  const entity = await findMemoryEntity(runtime.rootDir, name);
  if (!entity) {
    const output = `Entity not found: ${name}`;
    print(runtime, output);
    return { output, entity: null };
  }

  const output = [
    `# ${entity.name}`,
    `- type: ${entity.type}`,
    `- latest: ${entity.latestChapterId}`,
    `- state: ${entity.currentState || "-"}`,
    `- arc_stage: ${entity.arcStage || "-"}`,
    `- arc_summary: ${entity.arcSummary || "-"}`,
    `- goals: ${(entity.goals || []).join(" / ") || "-"}`,
    `- constraints: ${(entity.constraints || []).join(" / ") || "-"}`,
    `- secrets: ${(entity.secrets || []).join(" / ") || "-"}`,
    "## recent_timeline",
    ...((entity.timeline || []).slice(-5).map((item) => `- ${item.chapterId}: ${item.summary}`) || ["- none"])
  ].join("\n");
  print(runtime, output);
  return { output, entity };
}

async function handleMemorySearch(value, runtime) {
  const parts = String(value || "").trim().split(/\s+/).filter(Boolean);
  const filters = {};
  for (let index = 0; index < parts.length; index += 1) {
    const part = parts[index];
    if (part === "--tag") {
      filters.tag = parts[index + 1];
      index += 1;
    } else if (part === "--entity") {
      filters.entity = parts[index + 1];
      index += 1;
    } else if (part === "--thread") {
      filters.thread = parts[index + 1];
      index += 1;
    }
  }

  const chapters = await searchMemory(runtime.rootDir, filters);
  const output = chapters.length
    ? ["Memory search results:", ...chapters.map((item) => `- ${item.chapterId}: ${item.summary || "-"} [${(item.tags || []).join(", ")}]`)].join("\n")
    : "Memory search results: none.";
  print(runtime, output);
  return { output, chapters };
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

function formatPlotOptionsOutput(options, activeThreads = [], activeIntent = null, threads = []) {
  if (!options || options.length === 0) {
    const threadLines = activeThreads.length
      ? activeThreads.map((item) => `- ${item.id} [${item.status}] ${item.title} / ${item.endCondition || "-"}`)
      : threads.length
        ? threads.map((item) => `- ${item.id} [${item.status}] ${item.title}`).slice(0, 6)
        : [];
    return [
      activeIntent ? `Active intent: ${activeIntent.title} - ${activeIntent.summary}` : "Active intent: none",
      activeThreads.length ? "Active threads:" : "Active threads: none",
      ...threadLines
    ].join("\n");
  }

  return [
    activeIntent ? `Active intent: ${activeIntent.title} - ${activeIntent.summary}` : "Active intent: none",
    activeThreads.length ? "Active threads:" : "Active threads: none",
    ...activeThreads.map((item) => `- ${item.id} [${item.status}] ${item.title} / ${item.endCondition || "-"}`),
    ...options.map(
      (item) =>
        `- ${item.id} [${item.status}] ${item.title}\n  ${item.summary.replace(/\n/g, " ")}\n  range: ${formatPlotRange(item)}\n  end: ${item.endCondition || "-"}\n  risk: ${item.risk_or_tradeoff}`
    )
  ].join("\n");
}

function formatPlotThreadOutput(thread) {
  return [
    `# ${thread.title}`,
    `- id: ${thread.id}`,
    `- scope: ${thread.scope}`,
    `- status: ${thread.status}`,
    `- origin: ${thread.originChapterId || "-"}`,
    `- range: ${formatPlotRange(thread)}`,
    `- end_condition: ${thread.endCondition || "-"}`,
    `- tags: ${(thread.tags || []).join(", ") || "-"}`,
    `- related_entities: ${(thread.relatedEntityIds || []).join(", ") || "-"}`,
    "",
    thread.summary || "",
    "",
    "## history",
    ...((thread.history || []).map((item) => `- ${item.at}: ${item.action}${item.chapterId ? ` @ ${item.chapterId}` : ""}`) || ["- none"])
  ].join("\n");
}

function formatPlotRange(item) {
  const range = item.appliesToChapters || {};
  if (item.scope === "book" || range.mode === "all_future") {
    return `${range.start || item.originChapterId || item.chapterId || "-"}+`;
  }
  if (range.mode === "list") {
    return (range.chapters || []).join(",");
  }
  return [range.start || item.originChapterId || item.chapterId || "-", range.end || ""].filter(Boolean).join("-");
}

function targetChapter(target, rest) {
  if (target !== "chapter") {
    return null;
  }
  const value = firstWord(rest);
  if (!value) {
    throw new Error("Usage: ainovel plot generate chapter <chapter-id>");
  }
  return String(value).padStart(3, "0");
}

function firstWord(text) {
  return String(text || "").trim().split(/\s+/)[0] || "";
}

function buildHelpText() {
  return [
    "ainovel <command>",
    "",
    "Commands:",
    "  init [name]               Initialize a novel project",
    "  outline [requirements]    Generate project outlines",
    "  outline revise <feedback> Revise outlines from feedback",
    "  guid                      Guided outline generation",
    "  status                    Print project progress summary",
    "  export [path|--txt|--epub] Export outlines, memory, and drafts",
    "  chapter plan <id>         Generate chapter plan",
    "  chapter write <id>        Generate chapter draft and update memory",
    "  chapter revise <id> <fb>  Revise chapter plan or draft from feedback",
    "  chapter rewrite <id> <fb> Rewrite a chapter after planning extra retrieval",
    "  chapter next <plan|write> Generate the next chapter automatically",
    "  chapter list              Print chapter plan/draft/memory status",
    "  chapter show <id>         Print plan, draft, and memory snapshot",
    "  style [show|template]     Print current style.md or a style template",
    "  memory summarize          Rebuild rolling memory files",
    "  memory rebuild            Rebuild rolling memory files",
    "  memory archive            Archive older chapter memory summaries",
    "  memory tags [id]          Print chapter tags or all chapter tags",
    "  memory search ...         Search chapter index by --tag/--entity/--thread",
    "  context <chapter-id>      Print assembled chapter context",
    "  doctor                    Check project and model configuration",
    "  config                    Print resolved project and model config",
    "  plot ...                  Generate options and manage plot threads",
    "  tui                       Start the full-screen writing workspace"
  ].join("\n");
}

async function writeOutlineArtifacts(rootDir, llmText, fallback, runtime, task) {
  const paths = resolveProjectPaths(rootDir);
  const sections = extractTaggedSections(llmText || "", ["story", "arcs", "characters", "world"]);
  const writes = [
    [paths.outlineStory, sections.story || fallback.story],
    [paths.outlineArcs, sections.arcs || fallback.arcs],
    [paths.characters, sections.characters || fallback.characters],
    [paths.world, sections.world || fallback.world]
  ];

  for (const [filePath, content] of writes) {
    await writeText(filePath, String(content || "").trim() + "\n");
    emit(runtime, "artifact_written", { task, artifact: filePath });
  }

  return writes.map(([filePath]) => filePath);
}

async function collectGuideAnswersInteractive() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Usage: ainovel guid (interactive terminal required)");
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    return {
      genreAndTone: await rl.question("题材与基调："),
      worldAndRules: await rl.question("世界观与核心规则："),
      protagonistAndSetup: await rl.question("主角与初始处境："),
      goalAndCost: await rl.question("主线目标、阻碍与代价："),
      conflictAndEnding: await rl.question("关键冲突、卖点与结局倾向：")
    };
  } finally {
    rl.close();
  }
}

function printHelp(log = console.log) {
  log(buildHelpText());
}
