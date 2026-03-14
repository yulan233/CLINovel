import path from "node:path";
import { ensureDir, exists, listFiles, readText, writeText } from "./fs.js";
import { parseFrontmatter } from "./frontmatter.js";

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
  return {
    rootDir,
    config: path.join(rootDir, "project.yaml"),
    envExample: path.join(rootDir, ".env.example"),
    gitignore: path.join(rootDir, ".gitignore"),
    style: path.join(rootDir, "style.md"),
    outlineStory: path.join(rootDir, "outline", "story.md"),
    outlineArcs: path.join(rootDir, "outline", "arcs.md"),
    characters: path.join(rootDir, "characters", "roster.md"),
    world: path.join(rootDir, "world", "rules.md"),
    recentSummary: path.join(rootDir, "memory", "recent_summary.md"),
    globalSummary: path.join(rootDir, "memory", "global_summary.md"),
    archiveSummary: path.join(rootDir, "memory", "archive_summary.md"),
    plotOptions: path.join(rootDir, "memory", "plot_options.json"),
    chapterIndex: path.join(rootDir, "memory", "chapter_index.json"),
    storyThreads: path.join(rootDir, "memory", "story_threads.json"),
    entities: path.join(rootDir, "memory", "entities.json"),
    structuredLoops: path.join(rootDir, "memory", "open_loops.json"),
    continuityWarnings: path.join(rootDir, "memory", "continuity_warnings.json"),
    memoryChaptersDir: path.join(rootDir, "memory", "chapters"),
    openLoops: path.join(rootDir, "memory", "open_loops.md"),
    characterState: path.join(rootDir, "memory", "character_state.md"),
    worldState: path.join(rootDir, "memory", "world_state.md"),
    forgettingLog: path.join(rootDir, "memory", "forgetting_log.md")
  };
}

export async function initProject(rootDir, name = path.basename(rootDir)) {
  const paths = resolveProjectPaths(rootDir);

  for (const entry of PROJECT_STRUCTURE) {
    await ensureDir(path.join(rootDir, entry));
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
  const configPath = resolveProjectPaths(rootDir).config;
  const raw = await readText(configPath);

  if (!raw) {
    throw new Error("project.yaml not found. Run `ainovel init <name>` first.");
  }

  const config = {};
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      continue;
    }
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    config[key] = value;
  }
  return config;
}

export async function getNextChapterId(rootDir = process.cwd()) {
  const chapterDir = path.join(rootDir, "chapters");
  const files = await listFiles(chapterDir);
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
  const chapterDir = path.join(rootDir, "chapters");
  const files = await listFiles(chapterDir);
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
      const raw = await readText(path.join(chapterDir, file), "");
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
    planPath: path.join(rootDir, "chapters", `${chapterSlug}.plan.md`),
    draftPath: path.join(rootDir, "chapters", `${chapterSlug}.draft.md`),
    memoryPath: path.join(paths.memoryChaptersDir, `${chapterSlug}.summary.md`)
  };
}
