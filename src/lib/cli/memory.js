import { loadEnv } from "../env.js";
import {
  findMemoryEntity,
  getChapterTags,
  getContinuityWarnings,
  getOpenLoops,
  searchMemory
} from "../memory/search.js";
import { archiveMemory, rebuildMemory } from "../memory/rebuild.js";
import { buildContextWithIntent, printRuntime, requireChapterId } from "./runtime.js";

export async function handleMemory(action, value, runtime) {
  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);
  switch (action) {
    case "summarize": {
      const result = await rebuildMemory(rootDir);
      const output = formatMemoryRebuildOutput("summarized", result);
      printRuntime(runtime, output);
      return { output };
    }
    case "rebuild": {
      const result = await rebuildMemory(rootDir);
      const output = formatMemoryRebuildOutput("rebuilt", result);
      printRuntime(runtime, output);
      return { output };
    }
    case "archive": {
      const result = await archiveMemory(rootDir);
      const output = `Archived ${result.archivedCount} chapter(s); retained ${result.retainedCount} recent chapter(s).`;
      printRuntime(runtime, output);
      return { output };
    }
    case "loops": {
      const loops = await getOpenLoops(rootDir);
      const output = loops.length
        ? ["Open loops:", ...loops.map((item) => `- ${item.title} (latest ${item.latestChapterId})`)].join("\n")
        : "Open loops: none.";
      printRuntime(runtime, output);
      return { output, loops };
    }
    case "warnings": {
      const warnings = await getContinuityWarnings(rootDir);
      const output = warnings.length
        ? ["Continuity warnings:", ...warnings.map((item) => `- [${item.severity}] ${item.message}`)].join("\n")
        : "Continuity warnings: none.";
      printRuntime(runtime, output);
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
      printRuntime(runtime, output);
      return { output, tags };
    }
    case "search": {
      return handleMemorySearch(value, runtime);
    }
    default:
      throw new Error("Usage: ainovel memory <summarize|rebuild|archive|loops|warnings|entity|tags|search>");
  }
}

export async function handleContext(chapterId, runtime) {
  if (!chapterId) {
    throw new Error("Usage: ainovel context <chapter-id>");
  }
  await loadEnv(runtime.rootDir);
  const normalizedChapterId = requireChapterId(chapterId, "Usage: ainovel context <chapter-id>");
  const assembled = await buildContextWithIntent(runtime.rootDir, normalizedChapterId);
  const output = assembled.text;
  printRuntime(runtime, output);
  return { output, currentChapterId: normalizedChapterId, contextSections: assembled.sections };
}

async function handleMemoryEntity(name, runtime) {
  if (!name) {
    throw new Error("Usage: ainovel memory entity <name>");
  }

  const entity = await findMemoryEntity(runtime.rootDir, name);
  if (!entity) {
    const output = `Entity not found: ${name}`;
    printRuntime(runtime, output);
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
  printRuntime(runtime, output);
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
    } else if (part === "--thread-regex") {
      filters.threadRegex = parts[index + 1];
      index += 1;
    }
  }

  const chapters = await searchMemory(runtime.rootDir, filters);
  const output = chapters.length
    ? ["Memory search results:", ...chapters.map((item) => `- ${item.chapterId}: ${item.summary || "-"} [${(item.tags || []).join(", ")}]`)].join("\n")
    : "Memory search results: none.";
  printRuntime(runtime, output);
  return { output, chapters };
}

function formatMemoryRebuildOutput(action, result) {
  const summarizedChapterIds = Array.isArray(result?.summarizedChapterIds) ? result.summarizedChapterIds : [];
  const warnings = Array.isArray(result?.warnings) ? result.warnings : [];
  return [
    `Memory ${action} for ${summarizedChapterIds.length} chapter(s).`,
    ...warnings.map((item) => `- skipped ${item.chapterId}: ${item.message}`)
  ].join("\n");
}
