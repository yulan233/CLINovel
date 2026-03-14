import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { initProject } from "../src/lib/project.js";
import { writeText, readText } from "../src/lib/fs.js";
import { exportProject } from "../src/lib/exporter.js";
import { generatePlotOptions, changePlotOptionStatus } from "../src/lib/plot.js";

test("exportProject writes a combined markdown bundle", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-export-"));
  await initProject(root, "export-demo");
  await writeText(path.join(root, "outline", "story.md"), "# 故事总纲\n\n故事");
  await writeText(path.join(root, "chapters", "001.draft.md"), "---\nchapter_id: 001\n---\n# 第001章\n\n正文");

  const target = await exportProject(root);
  const output = await readText(target);

  assert.match(output, /小说导出/);
  assert.match(output, /故事总纲/);
  assert.match(output, /第001章/);
});

test("exportProject includes plot suggestions", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-export-plot-"));
  await initProject(root, "export-plot-demo");
  const generated = await generatePlotOptions(root, "book", null, {});
  await changePlotOptionStatus(root, generated.options[0].id, "applied");

  const target = await exportProject(root);
  const output = await readText(target);
  assert.match(output, /剧情建议/);
  assert.match(output, /当前采纳/);
});
