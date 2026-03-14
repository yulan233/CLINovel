import test from "node:test";
import assert from "node:assert/strict";
import { getChapterTags, rebuildMemory, rebuildMemoryAggregates, searchMemory } from "../src/lib/memory.js";
import { initProject, resolveProjectPaths } from "../src/lib/project.js";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { stringifyFrontmatter } from "../src/lib/frontmatter.js";
import { writeText, readText } from "../src/lib/fs.js";

test("rebuildMemory creates layered summaries from chapter snapshots", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-memory-"));
  const paths = await initProject(root, "memory-demo");

  for (const chapterId of ["001", "002", "003", "004"]) {
    await writeText(
      path.join(root, "chapters", `${chapterId}.draft.md`),
      stringifyFrontmatter(
        { chapter_id: chapterId, status: "draft", summary_status: "pending" },
        `# 第${chapterId}章\n\n主角推进了剧情。`
      )
    );
  }

  await rebuildMemory(root);

  const recent = await readText(paths.recentSummary);
  const global = await readText(paths.globalSummary);
  const summary001 = await readText(path.join(paths.memoryChaptersDir, "001.summary.md"));

  assert.match(summary001, /第001章记忆摘要/);
  assert.match(recent, /第004章/);
  assert.match(global, /长期主线更新/);
});

test("rebuildMemoryAggregates keeps latest state and only active loops", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-memory-aggregate-"));
  const paths = await initProject(root, "memory-aggregate-demo");

  await writeText(
    path.join(paths.memoryChaptersDir, "001.summary.md"),
    [
      "# 第001章记忆摘要",
      "",
      "## 章节摘要",
      "- 主角接下任务。",
      "",
      "## 近期摘要",
      "- 主角接下任务并暴露身份。",
      "",
      "## 长期摘要",
      "- 主线：任务背后另有黑手。",
      "",
      "## 未回收伏笔",
      "- 黑手身份未明。",
      "",
      "## 人物状态",
      "- 主角：右臂受伤，暂时隐瞒。",
      "",
      "## 世界状态",
      "- 城防司：开始秘密排查外来者。",
      "",
      "## 遗忘日志",
      "- 压缩街景描写。"
    ].join("\n")
  );

  await writeText(
    path.join(paths.memoryChaptersDir, "002.summary.md"),
    [
      "# 第002章记忆摘要",
      "",
      "## 章节摘要",
      "- 主角完成初步试探。",
      "",
      "## 近期摘要",
      "- 主角发现黑手线索来自城防司内鬼。",
      "",
      "## 长期摘要",
      "- 主线：任务背后另有黑手。",
      "- 反派网络与城防司存在勾连。",
      "",
      "## 未回收伏笔",
      "- 已解决：黑手身份未明。",
      "- 内鬼具体身份未明。",
      "",
      "## 人物状态",
      "- 主角：右臂伤势基本恢复，开始主动布局。",
      "- 导师：确认知道任务真相，但继续隐瞒。",
      "",
      "## 世界状态",
      "- 城防司：排查升级为封锁城门。",
      "",
      "## 遗忘日志",
      "- 压缩配角寒暄。"
    ].join("\n")
  );

  await rebuildMemoryAggregates(root);

  const global = await readText(paths.globalSummary);
  const openLoops = await readText(paths.openLoops);
  const characterState = await readText(paths.characterState);
  const worldState = await readText(paths.worldState);

  assert.match(global, /任务背后另有黑手/);
  assert.match(global, /城防司存在勾连/);
  assert.doesNotMatch(openLoops, /已解决/);
  assert.match(openLoops, /内鬼具体身份未明/);
  assert.doesNotMatch(characterState, /暂时隐瞒/);
  assert.match(characterState, /开始主动布局/);
  assert.match(worldState, /封锁城门/);
  assert.doesNotMatch(worldState, /秘密排查外来者/);
});

test("rebuildMemoryAggregates dedupes normalized facts and drops resolved loop variants", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-memory-dedupe-"));
  const paths = await initProject(root, "memory-dedupe-demo");

  await writeText(
    path.join(paths.memoryChaptersDir, "001.summary.md"),
    [
      "# 第001章记忆摘要",
      "",
      "## 章节摘要",
      "- 主角潜入档案库。",
      "",
      "## 近期摘要",
      "- 主角潜入档案库并发现旧卷宗。",
      "",
      "## 长期摘要",
      "- 主线：黑塔与失踪案有关。",
      "",
      "## 未回收伏笔",
      "- 失踪案真凶未明。",
      "- 已公开：黑塔位置。",
      "",
      "## 人物状态",
      "- 主角：手臂轻伤，继续隐瞒。",
      "",
      "## 世界状态",
      "- 黑塔：处于封锁调查中。",
      "",
      "## 标签",
      "- character",
      "- clue",
      "",
      "## 遗忘日志",
      "- 压缩环境描写。"
    ].join("\n")
  );

  await writeText(
    path.join(paths.memoryChaptersDir, "002.summary.md"),
    [
      "# 第002章记忆摘要",
      "",
      "## 章节摘要",
      "- 主角从卷宗中确认黑塔线索。",
      "",
      "## 近期摘要",
      "- 主角推进调查。",
      "",
      "## 长期摘要",
      "- 主线: 黑塔与失踪案有关。",
      "",
      "## 未回收伏笔",
      "- 已回收：失踪案真凶未明。",
      "- 黑塔幕后资助者未明。",
      "",
      "## 人物状态",
      "- 主角：伤势恢复，转入主动布局。",
      "",
      "## 世界状态",
      "- 黑塔：封锁调查升级为全面清查。",
      "",
      "## 标签",
      "- character",
      "- plot:main",
      "",
      "## 遗忘日志",
      "- 旧伤状态已被新状态覆盖。"
    ].join("\n")
  );

  await rebuildMemoryAggregates(root);

  const global = await readText(paths.globalSummary);
  const openLoops = await readText(paths.openLoops);
  const characterState = await readText(paths.characterState);
  const entities = JSON.parse(await readText(paths.entities));
  const loops = JSON.parse(await readText(paths.structuredLoops));
  const warnings = JSON.parse(await readText(paths.continuityWarnings));
  const chapterIndex = JSON.parse(await readText(paths.chapterIndex));

  assert.equal((global.match(/黑塔与失踪案有关/g) || []).length, 1);
  assert.doesNotMatch(openLoops, /已公开/);
  assert.doesNotMatch(openLoops, /已回收/);
  assert.match(openLoops, /黑塔幕后资助者未明/);
  assert.match(characterState, /伤势恢复，转入主动布局/);
  assert.doesNotMatch(characterState, /轻伤，继续隐瞒/);
  assert.ok(entities.entities.some((item) => item.name === "主角" && /主动布局/.test(item.currentState)));
  assert.ok(entities.entities.some((item) => item.name === "主角" && item.timeline.length >= 2));
  assert.ok(loops.loops.some((item) => item.title.includes("黑塔幕后资助者未明") && item.status === "open"));
  assert.ok(warnings.warnings.some((item) => item.message.includes("主角")));
  assert.ok(chapterIndex.chapters.some((item) => item.chapterId === "002" && item.tags.includes("plot:main")));
});

test("chapter index supports tag and entity search", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-memory-search-"));
  const paths = await initProject(root, "memory-search-demo");

  await writeText(
    path.join(paths.memoryChaptersDir, "001.summary.md"),
    [
      "# 第001章记忆摘要",
      "",
      "## 章节摘要",
      "- 主角发现密信。",
      "",
      "## 长期摘要",
      "- 主线：密信指向城防司内鬼。",
      "",
      "## 未回收伏笔",
      "- 内鬼身份未明。",
      "",
      "## 人物状态",
      "- 主角：决定继续追查。",
      "",
      "## 世界状态",
      "- 城防司：封锁档案区。",
      "",
      "## 标签",
      "- clue",
      "- politics",
      "",
      "## 遗忘日志",
      "- 压缩环境描写。"
    ].join("\n")
  );

  await rebuildMemoryAggregates(root);

  const tags = await getChapterTags(root, "001");
  const byTag = await searchMemory(root, { tag: "clue" });
  const byEntity = await searchMemory(root, { entity: "主角" });

  assert.ok(tags.includes("clue"));
  assert.equal(byTag[0].chapterId, "001");
  assert.equal(byEntity[0].chapterId, "001");
});
