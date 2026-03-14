import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { runCommand } from "../src/lib/cli.js";
import { initProject, resolveProjectPaths } from "../src/lib/project.js";
import { writeText } from "../src/lib/fs.js";
import { rebuildMemoryAggregates } from "../src/lib/memory.js";

test("memory entity and warnings commands expose structured memory data", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-cli-memory-"));
  const paths = await initProject(root, "demo");
  const resolved = resolveProjectPaths(root);

  await writeText(
    path.join(paths.memoryChaptersDir, "001.summary.md"),
    [
      "# 第001章记忆摘要",
      "",
      "## 章节摘要",
      "- 主角接下任务。",
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
      "## 长期摘要",
      "- 主线：任务背后另有黑手。",
      "",
      "## 未回收伏笔",
      "- 内鬼具体身份未明。",
      "",
      "## 人物状态",
      "- 主角：右臂伤势基本恢复，开始主动布局。",
      "",
      "## 世界状态",
      "- 城防司：排查升级为封锁城门。",
      "",
      "## 遗忘日志",
      "- 压缩配角寒暄。"
    ].join("\n")
  );

  await rebuildMemoryAggregates(root);

  const entityResult = await runCommand(["memory", "entity", "主角"], {
    rootDir: root,
    print: false
  });
  const searchResult = await runCommand(["memory", "search", "--entity", "主角"], {
    rootDir: root,
    print: false
  });
  const warningResult = await runCommand(["memory", "warnings"], {
    rootDir: root,
    print: false
  });

  assert.match(entityResult.output, /主角/);
  assert.match(entityResult.output, /主动布局/);
  assert.match(entityResult.output, /recent_timeline/);
  assert.match(searchResult.output, /Memory search results/);
  assert.ok(warningResult.output.includes("Continuity warnings"));
  assert.ok(resolved.entities.endsWith("entities.json"));
});
