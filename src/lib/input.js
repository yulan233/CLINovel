const RAW_COMMANDS = /^(init|outline|guid|doctor|config|style|memory|context|chapter|status|export|plot)\b/;

export const SLASH_COMMANDS = [
  { command: "/init", description: "在当前目录初始化项目", usage: "/init" },
  { command: "/guid", description: "引导式生成世界观和故事大纲", usage: "/guid" },
  { command: "/outline", description: "快速生成大纲，可附加要求", usage: "/outline [要求]" },
  { command: "/plan", description: "规划当前章或指定章", usage: "/plan [chapter]" },
  { command: "/write", description: "生成当前章或指定章正文", usage: "/write [chapter]" },
  { command: "/next plan", description: "规划下一章", usage: "/next plan" },
  { command: "/next write", description: "生成下一章正文", usage: "/next write" },
  { command: "/revise", description: "修订章节计划或正文", usage: "/revise [chapter] <feedback>" },
  { command: "/rewirte", description: "重写当前章或指定章，并先规划补充上下文", usage: "/rewirte [chapter] <feedback>" },
  { command: "/focus", description: "切换当前焦点章节", usage: "/focus <chapter>" },
  { command: "/focus next", description: "切到下一章", usage: "/focus next" },
  { command: "/focus prev", description: "切到上一章", usage: "/focus prev" },
  { command: "/list", description: "查看章节列表", usage: "/list" },
  { command: "/show", description: "查看章节计划/正文/记忆", usage: "/show [chapter]" },
  { command: "/inspect status", description: "查看项目和章节状态", usage: "/inspect status" },
  { command: "/inspect context", description: "查看当前章节上下文", usage: "/inspect context" },
  { command: "/inspect memory", description: "查看当前章节记忆摘要", usage: "/inspect memory" },
  { command: "/inspect plot", description: "查看剧情建议面板", usage: "/inspect plot" },
  { command: "/inspect artifacts", description: "查看最近产物", usage: "/inspect artifacts" },
  { command: "/inspect loops", description: "查看伏笔面板", usage: "/inspect loops" },
  { command: "/inspect warnings", description: "查看连续性警告", usage: "/inspect warnings" },
  { command: "/close", description: "关闭当前 inspector", usage: "/close" },
  { command: "/context", description: "查看当前章节上下文", usage: "/context [chapter]" },
  { command: "/memory chapter", description: "查看章节记忆", usage: "/memory chapter [chapter]" },
  { command: "/memory tags", description: "查看章节标签", usage: "/memory tags [chapter]" },
  { command: "/loop list", description: "查看未回收伏笔", usage: "/loop list" },
  { command: "/entity", description: "查看人物/物品/地点状态", usage: "/entity <name>" },
  { command: "/warnings", description: "查看连续性警告", usage: "/warnings" },
  { command: "/plot chapter", description: "为当前章节生成 3 条剧情走向", usage: "/plot chapter [chapter]" },
  { command: "/plot book", description: "为全书生成 3 条剧情走向", usage: "/plot book" },
  { command: "/plot keep", description: "保留一条剧情走向", usage: "/plot keep <id>" },
  { command: "/plot drop", description: "放弃一条剧情走向", usage: "/plot drop <id>" },
  { command: "/plot apply", description: "采纳一条剧情走向", usage: "/plot apply <id>" },
  { command: "/plot thread", description: "查看剧情线程详情", usage: "/plot thread <thread-id>" },
  { command: "/plot resolve", description: "结束剧情线程", usage: "/plot resolve <thread-id> [chapter]" },
  { command: "/plot pause", description: "暂停剧情线程", usage: "/plot pause <thread-id>" },
  { command: "/plot resume", description: "恢复剧情线程", usage: "/plot resume <thread-id>" },
  { command: "/status", description: "查看项目状态", usage: "/status" },
  { command: "/export", description: "导出项目", usage: "/export [path|--txt|--epub]" },
  { command: "/retry", description: "重跑最近一次任务", usage: "/retry" },
  { command: "/continue", description: "继续最近一次生成", usage: "/continue" },
  { command: "/stop", description: "停止当前生成", usage: "/stop" },
  { command: "/exit", description: "退出 TUI", usage: "/exit" }
];

export function interpretInput(input, state = { currentChapterId: null }) {
  const trimmed = input.trim();

  if (trimmed.startsWith("/")) {
    return parseSlashCommand(trimmed, state);
  }

  if (RAW_COMMANDS.test(trimmed)) {
    if (/^outline\b/.test(trimmed)) {
      const reviseMatch = trimmed.match(/^outline\s+revise\s+(.+)$/);
      if (reviseMatch) {
        return ["outline", "revise", reviseMatch[1]];
      }
      const requirements = trimmed.replace(/^outline\b/, "").trim();
      return requirements ? ["outline", requirements] : ["outline"];
    }
    if (/^init\b/.test(trimmed)) {
      const name = trimmed.replace(/^init\b/, "").trim();
      return name ? ["init", name] : ["init"];
    }
    if (/^guid\b/.test(trimmed)) {
      return ["guid"];
    }
    return trimmed.split(/\s+/);
  }

  const planMatch = trimmed.match(/(?:规划|计划|生成)[^\d]*第?\s*(\d+)\s*章/);
  if (planMatch) {
    return ["chapter", "plan", planMatch[1]];
  }

  if ((/^修改这一章\s+/.test(trimmed) || /^重写这一章\s+/.test(trimmed)) && state.currentChapterId) {
    const action = trimmed.startsWith("重写") ? "rewrite" : "revise";
    const feedback = trimmed.replace(/^(修改|重写)这一章\s+/, "").trim();
    return ["chapter", action, state.currentChapterId, feedback];
  }

  if (/^重写第?\s*(\d+)\s*章(?:\s+(.+))?$/.test(trimmed)) {
    const rewriteChapterMatch = trimmed.match(/^重写第?\s*(\d+)\s*章(?:\s+(.+))?$/);
    return ["chapter", "rewrite", rewriteChapterMatch[1], rewriteChapterMatch[2] || ""];
  }

  if (/^重写这一章$/.test(trimmed) && state.currentChapterId) {
    return ["chapter", "rewrite", state.currentChapterId, ""];
  }

  if (/^修改这一章$/.test(trimmed) && state.currentChapterId) {
    return ["chapter", "revise", state.currentChapterId, ""];
  }

  const writeMatch = trimmed.match(/(?:写|生成)[^\d]*第?\s*(\d+)\s*章/);
  if (writeMatch) {
    return ["chapter", "write", writeMatch[1]];
  }

  if (/^写下一章$/.test(trimmed) || /^规划下一章$/.test(trimmed)) {
    return ["chapter", "next", trimmed.startsWith("规划") ? "plan" : "write"];
  }

  const reviseChapterMatch = trimmed.match(/(?:修改|润色)[^\d]*第?\s*(\d+)\s*章\s*(.+)$/);
  if (reviseChapterMatch) {
    return ["chapter", "revise", reviseChapterMatch[1], reviseChapterMatch[2]];
  }

  const reviseOutlineMatch = trimmed.match(/(?:修改|重写|调整).*(大纲)\s*(.+)$/);
  if (reviseOutlineMatch) {
    return ["outline", "revise", reviseOutlineMatch[2]];
  }

  if (trimmed.includes("大纲")) {
    const detail = trimmed.replace(/.*大纲[，,\s]*/, "").trim();
    return detail && detail !== trimmed ? ["outline", detail] : ["outline"];
  }

  if (trimmed.includes("引导") && (trimmed.includes("大纲") || trimmed.includes("世界观") || trimmed.includes("故事"))) {
    return ["guid"];
  }

  if (trimmed.includes("初始化") && trimmed.includes("项目")) {
    return ["init"];
  }

  if (trimmed.includes("记忆") && (trimmed.includes("重建") || trimmed.includes("总结"))) {
    return ["memory", "rebuild"];
  }

  if (trimmed.includes("配置") || trimmed.includes("模型")) {
    return ["config"];
  }

  if (trimmed.includes("状态") || trimmed.includes("进度")) {
    return ["status"];
  }

  throw new Error("无法识别输入。示例：`生成大纲`、`规划第 3 章`、`写第 3 章`、`/status`");
}

export function updateInputState(state, argv, result = {}) {
  if (argv[0] === "chapter" && ["plan", "write", "revise", "rewrite", "show"].includes(argv[1]) && argv[2]) {
    state.currentChapterId = String(argv[2]).padStart(3, "0");
  }

  if (argv[0] === "plot" && argv[1] === "generate" && argv[2] === "chapter" && argv[3]) {
    state.currentChapterId = String(argv[3]).padStart(3, "0");
  }

  if (result?.currentChapterId) {
    state.currentChapterId = result.currentChapterId;
  }
}

export function getSlashSuggestions(input, state = { currentChapterId: null }) {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return [];
  }

  return SLASH_COMMANDS.filter((item) => item.command.startsWith(trimmed) || item.usage.startsWith(trimmed)).map(
    (item) => ({
      ...item,
      preview: hydrateUsage(item.usage, state)
    })
  );
}

function parseSlashCommand(input, state) {
  if (!String(input || "").startsWith("/")) {
    throw new Error("Slash commands must start with /.");
  }

  const [command, ...rest] = input.slice(1).split(/\s+/);
  const arg = rest.join(" ").trim();

  switch (command) {
    case "status":
      return ["status"];
    case "list":
      return ["chapter", "list"];
    case "show":
      return ["chapter", "show", arg || state.currentChapterId];
    case "export":
      return ["export", arg || "export.novel.md"];
    case "context":
      return ["context", arg || state.currentChapterId];
    case "next":
      return ["chapter", "next", firstToken(arg)];
    case "outline":
      if (arg.startsWith("revise ")) {
        return ["outline", "revise", arg.replace(/^revise\s+/, "")];
      }
      return arg ? ["outline", arg] : ["outline"];
    case "init":
      return arg ? ["init", firstToken(arg)] : ["init"];
    case "guid":
      return ["guid"];
    case "memory":
      return parseMemorySlash(rest, state);
    case "loop":
      return parseLoopSlash(rest);
    case "entity":
      return ["memory", "entity", arg];
    case "warnings":
      return ["memory", "warnings"];
    case "plan":
      return ["chapter", "plan", firstToken(arg) || state.currentChapterId];
    case "write":
      return ["chapter", "write", firstToken(arg) || state.currentChapterId];
    case "revise":
      return parseReviseSlash(arg, state);
    case "rewirte":
    case "rewrite":
      return parseRewriteSlash(arg, state);
    case "focus":
      return ["focus", firstToken(arg)];
    case "inspect":
      return parseInspectSlash(rest);
    case "close":
      return ["close"];
    case "plot":
      return parsePlotSlash(rest, state);
    case "retry":
      return ["retry"];
    case "continue":
      return ["continue"];
    case "stop":
      return ["stop"];
    case "exit":
      return ["exit"];
    default:
      throw new Error("未知斜杠命令。可用：/init /guid /outline /plan /write /next /revise /rewirte /inspect /memory /loop /entity /warnings /plot /status /context /export /retry /continue /stop /exit");
  }
}

function parseInspectSlash(parts) {
  const view = firstToken(parts.join(" "));
  if (!["status", "context", "memory", "plot", "artifacts", "loops", "warnings"].includes(view)) {
    throw new Error("Inspector 命令示例：/inspect status, /inspect context, /inspect memory, /inspect plot, /inspect artifacts, /inspect loops, /inspect warnings");
  }
  return ["inspect", view];
}

function parseMemorySlash(parts, state) {
  const [action, ...rest] = parts;
  const value = rest.join(" ").trim();

  switch (action) {
    case "chapter":
      return ["chapter", "show", firstToken(value) || state.currentChapterId];
    case "tags":
      return ["memory", "tags", firstToken(value) || state.currentChapterId];
    default:
      throw new Error("记忆命令示例：/memory chapter 003, /memory tags 003");
  }
}

function parseLoopSlash(parts) {
  const [action] = parts;
  if (action !== "list") {
    throw new Error("伏笔命令示例：/loop list");
  }
  return ["memory", "loops"];
}

function parsePlotSlash(parts, state) {
  const [action, ...rest] = parts;
  const value = rest.join(" ").trim();

  switch (action) {
    case "chapter":
      return ["plot", "generate", "chapter", firstToken(value) || state.currentChapterId];
    case "book":
      return ["plot", "generate", "book"];
    case "keep":
      return ["plot", "keep", firstToken(value)];
    case "drop":
      return ["plot", "drop", firstToken(value)];
    case "apply":
      return ["plot", "apply", firstToken(value)];
    case "thread":
      return ["plot", "thread", firstToken(value)];
    case "resolve":
      return ["plot", "resolve", firstToken(value), parts[2] || state.currentChapterId];
    case "pause":
      return ["plot", "pause", firstToken(value)];
    case "resume":
      return ["plot", "resume", firstToken(value)];
    default:
      throw new Error("剧情建议命令示例：/plot chapter 003, /plot book, /plot keep <id>, /plot drop <id>, /plot apply <id>, /plot thread <id>");
  }
}

function parseReviseSlash(arg, state) {
  const parts = arg.split(/\s+/).filter(Boolean);
  if (parts.length === 0) {
    throw new Error("Usage: /revise [chapter] <feedback>");
  }
  const hasChapter = /^\d+$/.test(parts[0] || "");
  const chapterId = hasChapter ? parts[0] : state.currentChapterId;
  const feedback = hasChapter ? parts.slice(1).join(" ") : parts.join(" ");
  if (!String(feedback || "").trim()) {
    throw new Error("Usage: /revise [chapter] <feedback>");
  }
  return ["chapter", "revise", chapterId, feedback];
}

function parseRewriteSlash(arg, state) {
  const parts = arg.split(/\s+/).filter(Boolean);
  const hasChapter = /^\d+$/.test(parts[0] || "");
  const chapterId = hasChapter ? parts[0] : state.currentChapterId;
  const feedback = hasChapter ? parts.slice(1).join(" ") : parts.join(" ");
  if (!chapterId) {
    throw new Error("Usage: /rewirte [chapter] <feedback>");
  }
  return ["chapter", "rewrite", chapterId, feedback];
}

function firstToken(text) {
  return String(text || "").trim().split(/\s+/)[0] || "";
}

function hydrateUsage(usage, state) {
  return usage.replace("[chapter]", state.currentChapterId || "001");
}
