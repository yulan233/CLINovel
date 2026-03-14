import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { archiveMemory, rebuildMemory } from "../src/lib/memory.js";
import { initProject, resolveProjectPaths } from "../src/lib/project.js";
import { stringifyFrontmatter } from "../src/lib/frontmatter.js";
import { readText, writeText } from "../src/lib/fs.js";

test("archiveMemory writes archive summary for older chapters", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-archive-"));
  const paths = resolveProjectPaths(root);
  await initProject(root, "archive-demo");

  for (const chapterId of ["001", "002", "003", "004"]) {
    await writeText(
      path.join(root, "chapters", `${chapterId}.draft.md`),
      stringifyFrontmatter(
        { chapter_id: chapterId, status: "draft", summary_status: "pending" },
        `# 第${chapterId}章\n\n剧情推进。`
      )
    );
  }

  await rebuildMemory(root);
  const result = await archiveMemory(root);
  const archiveDoc = await readText(paths.archiveSummary);

  assert.equal(result.archivedCount, 1);
  assert.match(archiveDoc, /已归档章节/);
  assert.match(archiveDoc, /第001章/);
});
