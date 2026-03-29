import path from "node:path";
import process from "node:process";
import { safeReadPath } from "./fs.js";
import { startTui } from "./tui.js";
import { loadEnv } from "./env.js";
import { exportProject } from "./exporter.js";
import { getChapterStatuses, initProject, loadProjectConfig } from "./project.js";
import { safeResolve } from "./path-safe.js";
import { handleChapter } from "./cli/chapter.js";
import { handleMemory, handleContext } from "./cli/memory.js";
import { handleOutline, handleGuid } from "./cli/outline.js";
import { handlePlot } from "./cli/plot.js";
import { buildRuntime, describeLlmMode, printRuntime } from "./cli/runtime.js";

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
      return handleOutline(
        subcommand === "revise" ? subcommand : null,
        subcommand === "revise" ? [arg, ...rest].filter(Boolean).join(" ") : trailingText,
        runtime
      );
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

async function handleInit(nameArg, runtime) {
  const rootDir = nameArg ? safeResolve(process.cwd(), nameArg) : process.cwd();
  const name = path.basename(rootDir);
  await initProject(rootDir, name);
  const output = `Initialized novel project at ${rootDir}
Next steps:
  1. cd ${rootDir}
  2. cp .env.example .env
  3. edit .env and set AINOVEL_API_KEY / AINOVEL_BASE_URL / AINOVEL_MODEL
  4. ainovel doctor`;
  printRuntime(runtime, output);
  return {
    output,
    artifacts: [rootDir]
  };
}

async function handleStyle(action, runtime) {
  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);
  const current = await safeReadPath(rootDir, "style.md", "");

  if (action === "show" || !action) {
    printRuntime(runtime, current);
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
    printRuntime(runtime, output);
    return { output };
  }

  throw new Error("Usage: ainovel style [show|template]");
}

async function handleDoctor(runtime) {
  const rootDir = runtime.rootDir;
  const envInfo = await loadEnv(rootDir);
  const config = await loadProjectConfig(rootDir);
  const llm = describeLlmMode(config);
  const contextBudget = Number.parseInt(String(config.context_budget || ""), 10);

  const checks = [
    ["project.yaml", (await safeReadPath(rootDir, "project.yaml", "")) ? "ok" : "missing"],
    ["style.md", (await safeReadPath(rootDir, "style.md", "")) ? "ok" : "missing"],
    [".env.example", (await safeReadPath(rootDir, ".env.example", "")) ? "ok" : "missing"],
    [".env loaded from", envInfo.loadedFiles.length ? envInfo.loadedFiles.join(", ") : "not found"],
    ["AINOVEL_API_KEY", llm.apiKey ? "set" : "missing"],
    ["AINOVEL_BASE_URL", llm.baseUrl || "missing"],
    ["AINOVEL_MODEL", llm.model || "missing"],
    ["LLM context_window", llm.contextWindow ? String(llm.contextWindow) : "unknown"],
    ["LLM mode", llm.remoteEnabled ? "remote" : "fallback-local"],
    ["LLM timeout_ms", String(llm.timeoutMs)]
  ];

  const output = [
    "ainovel doctor",
    ...checks.map(([label, value]) => `- ${label}: ${value}`),
    llm.contextWindow && Number.isFinite(contextBudget) && contextBudget > llm.contextWindow
      ? `- warning: context_budget (${contextBudget}) exceeds model context window (${llm.contextWindow})`
      : null,
    !llm.remoteEnabled
      ? "- hint: copy .env.example to .env and fill in your API config to enable remote generation"
      : null
  ]
    .filter(Boolean)
    .join("\n");
  printRuntime(runtime, output);
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
    `context_window: ${llm.contextWindow || "unknown"}`,
    `mode: ${llm.remoteEnabled ? "remote" : "fallback-local"}`
  ].join("\n");
  printRuntime(runtime, output);
  return { output, config, llm };
}

async function handleStatus(runtime) {
  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);
  const config = await loadProjectConfig(rootDir);
  const statuses = await getChapterStatuses(rootDir);
  const [story, arcs] = await Promise.all([
    safeReadPath(rootDir, "outline/story.md", ""),
    safeReadPath(rootDir, "outline/arcs.md", "")
  ]);

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
  printRuntime(runtime, output);
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
    outputPath = safeResolve(rootDir, outputPathArg);
    if (outputPath.endsWith(".txt")) {
      format = "txt";
    } else if (outputPath.endsWith(".epub")) {
      format = "epub";
    }
  }
  const target = await exportProject(rootDir, outputPath, format);
  const output = `Exported novel bundle: ${target}`;
  printRuntime(runtime, output);
  return { output, artifacts: [target] };
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
    "  memory search ...         Search chapter index by --tag/--entity/--thread/--thread-regex",
    "  context <chapter-id>      Print assembled chapter context",
    "  doctor                    Check project and model configuration",
    "  config                    Print resolved project and model config",
    "  plot ...                  Generate options and manage plot threads",
    "  tui                       Start the full-screen writing workspace"
  ].join("\n");
}

function printHelp(log = console.log) {
  log(buildHelpText());
}
