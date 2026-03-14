import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { runCommand } from "../src/lib/cli.js";
import { initProject } from "../src/lib/project.js";
import { readText, writeText } from "../src/lib/fs.js";

test("chapter rewrite writes a retrieval plan and rewrites the draft in fallback mode", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-rewrite-"));
  await initProject(root, "demo");

  await writeText(
    path.join(root, "chapters", "001.draft.md"),
    ["---", "chapter_id: 001", "status: draft", "summary_status: pending", "---", "# 第001章", "", "上一章正文"].join("\n")
  );
  await writeText(
    path.join(root, "memory", "chapters", "001.summary.md"),
    "# 第001章记忆摘要\n\n## 章节摘要\n- 上一章留下了新的驱动力。\n"
  );
  await writeText(
    path.join(root, "chapters", "002.plan.md"),
    ["---", "chapter_id: 002", "goal: 推进", "must_include: [冲突]", "continuity_notes: [承接上章]", "---", "# 第002章计划", "", "计划正文"].join("\n")
  );
  await writeText(
    path.join(root, "chapters", "002.draft.md"),
    ["---", "chapter_id: 002", "status: draft", "summary_status: pending", "---", "# 第002章", "", "原始正文"].join("\n")
  );

  const result = await runCommand(["chapter", "rewrite", "002", "强化上文承接"], {
    rootDir: root,
    print: false
  });

  const rewritePlan = await readText(path.join(root, "chapters", "002.rewrite-plan.md"));
  const rewrittenDraft = await readText(path.join(root, "chapters", "002.draft.md"));

  assert.match(result.output, /Rewrote chapter draft/);
  assert.match(result.output, /Rewrite plan:/);
  assert.match(rewritePlan, /第002章重写检索计划/);
  assert.match(rewritePlan, /第001章 \[draft, memory\]/);
  assert.match(rewrittenDraft, /修订备注|原始正文/);
});
