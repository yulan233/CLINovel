import path from "node:path";
import { ensureDir, exists, safeListPath, safeReadPath, writeText } from "./fs.js";
import { parseFrontmatter } from "./frontmatter.js";
import { safeResolve } from "./path-safe.js";

export const PROJECT_STRUCTURE = [
  "outline",
  "chapters",
  "memory",
  "memory/chapters",
  "characters",
  "world",
  "logs"
];

export function resolveProjectPaths(rootDir = process.cwd()) {
  const resolveWithinProject = (target) => safeResolve(rootDir, target);
  return {
    rootDir,
    config: resolveWithinProject("project.yaml"),
    envExample: resolveWithinProject(".env.example"),
    gitignore: resolveWithinProject(".gitignore"),
    style: resolveWithinProject("style.md"),
    outlineStory: resolveWithinProject("outline/story.md"),
    outlineArcs: resolveWithinProject("outline/arcs.md"),
    characters: resolveWithinProject("characters/roster.md"),
    world: resolveWithinProject("world/rules.md"),
    recentSummary: resolveWithinProject("memory/recent_summary.md"),
    globalSummary: resolveWithinProject("memory/global_summary.md"),
    archiveSummary: resolveWithinProject("memory/archive_summary.md"),
    plotOptions: resolveWithinProject("memory/plot_options.json"),
    chapterIndex: resolveWithinProject("memory/chapter_index.json"),
    storyThreads: resolveWithinProject("memory/story_threads.json"),
    entities: resolveWithinProject("memory/entities.json"),
    structuredLoops: resolveWithinProject("memory/open_loops.json"),
    continuityWarnings: resolveWithinProject("memory/continuity_warnings.json"),
    memoryChaptersDir: resolveWithinProject("memory/chapters"),
    openLoops: resolveWithinProject("memory/open_loops.md"),
    characterState: resolveWithinProject("memory/character_state.md"),
    worldState: resolveWithinProject("memory/world_state.md"),
    forgettingLog: resolveWithinProject("memory/forgetting_log.md")
  };
}

export async function initProject(rootDir, name = path.basename(rootDir)) {
  const normalizedRootDir = path.resolve(rootDir);
  const paths = resolveProjectPaths(normalizedRootDir);

  for (const entry of PROJECT_STRUCTURE) {
    await ensureDir(safeResolve(normalizedRootDir, entry));
  }

  const files = [
    [
      paths.config,
      [
        `title: ${name}`,
        "genre: 未定义",
        "target_length: 长篇",
        "default_model: fallback-local",
        "context_budget: 12000",
        "summary_policy: chapter+rolling"
      ].join("\n") + "\n"
    ],
    [
      paths.style,
      [
        "# 文风配置",
        "",
        "- 叙事视角：第三人称有限视角",
        "- 语言风格：中文网文，节奏稳定，画面感清晰",
        "- 对白要求：人物口吻区分明确，避免流水账",
        "- 禁写法：过度解释、重复比喻、现代互联网口头禅",
        "- 参考气质：人物目标明确，冲突持续推进"
      ].join("\n") + "\n"
    ],
    [paths.outlineStory, "# 故事总纲\n\n等待生成。\n"],
    [paths.outlineArcs, "# 卷纲与章纲\n\n等待生成。\n"],
    [paths.characters, "# 人物设定\n\n等待生成。\n"],
    [paths.world, "# 世界规则\n\n等待生成。\n"],
    [paths.recentSummary, "# 近期剧情摘要\n\n暂无内容。\n"],
    [paths.globalSummary, "# 全局长期记忆\n\n暂无内容。\n"],
    [paths.archiveSummary, "# 阶段归档摘要\n\n暂无内容。\n"],
    [paths.plotOptions, `${JSON.stringify({ options: [], threads: [], activeThreadIds: [], activeIntent: null }, null, 2)}\n`],
    [paths.chapterIndex, `${JSON.stringify({ chapters: [] }, null, 2)}\n`],
    [paths.storyThreads, `${JSON.stringify({ threads: [] }, null, 2)}\n`],
    [paths.entities, `${JSON.stringify({ entities: [] }, null, 2)}\n`],
    [paths.structuredLoops, `${JSON.stringify({ loops: [] }, null, 2)}\n`],
    [paths.continuityWarnings, `${JSON.stringify({ warnings: [] }, null, 2)}\n`],
    [paths.openLoops, "# 未回收伏笔\n\n暂无内容。\n"],
    [paths.characterState, "# 人物状态\n\n暂无内容。\n"],
    [paths.worldState, "# 世界状态\n\n暂无内容。\n"],
    [paths.forgettingLog, "# 遗忘日志\n\n暂无内容。\n"],
    [
      paths.envExample,
      [
        "AINOVEL_API_KEY=your_api_key_here",
        "AINOVEL_BASE_URL=https://api.openai.com/v1",
        "AINOVEL_MODEL=gpt-4.1-mini"
      ].join("\n") + "\n"
    ],
    [
      paths.gitignore,
      [
        ".env",
        "logs/",
        ".DS_Store"
      ].join("\n") + "\n"
    ]
  ];

  for (const [filePath, content] of files) {
    if (!(await exists(filePath))) {
      await writeText(filePath, content);
    }
  }

  return paths;
}

export async function loadProjectConfig(rootDir = process.cwd()) {
  const raw = await safeReadPath(rootDir, "project.yaml");

  if (!raw) {
    throw new Error("project.yaml not found. Run `ainovel init <name>` first.");
  }

  return parseProjectYaml(raw);
}

export async function getNextChapterId(rootDir = process.cwd()) {
  const files = await safeListPath(rootDir, "chapters");
  let max = 0;

  for (const file of files) {
    const match = file.match(/^(\d+)\.(plan|draft)\.md$/);
    if (match) {
      max = Math.max(max, Number(match[1]));
    }
  }

  return String(max + 1).padStart(3, "0");
}

export async function getChapterStatuses(rootDir = process.cwd()) {
  const files = await safeListPath(rootDir, "chapters");
  const map = new Map();

  for (const file of files) {
    const match = file.match(/^(\d+)\.(plan|draft)\.md$/);
    if (!match) {
      continue;
    }

    const chapterId = match[1];
    const kind = match[2];
    const item = map.get(chapterId) || {
      chapterId,
      hasPlan: false,
      hasDraft: false,
      summaryStatus: "missing"
    };
    item.hasPlan = item.hasPlan || kind === "plan";
    item.hasDraft = item.hasDraft || kind === "draft";

    if (kind === "draft") {
      const raw = await safeReadPath(rootDir, `chapters/${file}`, "");
      const parsed = parseFrontmatter(raw);
      item.summaryStatus = parsed.data.summary_status || "pending";
    }

    map.set(chapterId, item);
  }

  return [...map.values()].sort((a, b) => a.chapterId.localeCompare(b.chapterId));
}

export async function getChapterArtifacts(rootDir = process.cwd(), chapterId) {
  const chapterSlug = String(chapterId).padStart(3, "0");
  const paths = resolveProjectPaths(rootDir);
  return {
    chapterId: chapterSlug,
    planPath: safeResolve(rootDir, `chapters/${chapterSlug}.plan.md`),
    draftPath: safeResolve(rootDir, `chapters/${chapterSlug}.draft.md`),
    memoryPath: safeResolve(paths.memoryChaptersDir, `${chapterSlug}.summary.md`)
  };
}

function parseProjectYaml(raw) {
  const lines = String(raw || "").replace(/\r\n/g, "\n").split("\n");
  const config = {};

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || /^\s/.test(line)) {
      continue;
    }

    const separator = line.indexOf(":");
    if (separator === -1) {
      continue;
    }

    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1).trim();
    if (value) {
      config[key] = parseYamlScalar(value);
      continue;
    }

    const blockLines = [];
    let cursor = index + 1;
    while (cursor < lines.length) {
      const blockLine = lines[cursor];
      if (!blockLine.trim()) {
        blockLines.push("");
        cursor += 1;
        continue;
      }
      if (!/^\s+/.test(blockLine)) {
        break;
      }
      blockLines.push(blockLine);
      cursor += 1;
    }

    config[key] = parseYamlBlock(blockLines);
    index = cursor - 1;
  }

  return config;
}

function parseYamlBlock(lines) {
  const nonEmpty = lines.filter((line) => line.trim());
  if (nonEmpty.length === 0) {
    return "";
  }

  if (nonEmpty.every((line) => line.trim().startsWith("- "))) {
    return nonEmpty
      .map((line) => parseYamlScalar(line.trim().slice(2).trim()))
      .filter((item) => item !== "");
  }

  return lines
    .map((line) => line.replace(/^\s+/, ""))
    .join("\n")
    .trimEnd();
}

function parseYamlScalar(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed) {
    return "";
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => stripYamlQuotes(item.trim()))
      .filter(Boolean);
  }

  return stripYamlQuotes(trimmed);
}

function stripYamlQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
