import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { initProject } from "../src/lib/project.js";
import { writeText, exists } from "../src/lib/fs.js";
import { exportProject } from "../src/lib/exporter.js";

test("exportProject can write txt output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-txt-"));
  await initProject(root, "txt-demo");
  await writeText(path.join(root, "chapters", "001.draft.md"), "---\nchapter_id: 001\n---\n# 第001章\n\n正文");
  const target = await exportProject(root, path.join(root, "bundle.txt"), "txt");
  assert.equal(await exists(target), true);
});

test("exportProject can write epub output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-epub-"));
  await initProject(root, "epub-demo");
  await writeText(path.join(root, "chapters", "001.draft.md"), "---\nchapter_id: 001\n---\n# 第001章\n\n正文");
  const target = await exportProject(root, path.join(root, "bundle.epub"), "epub");
  assert.equal(await exists(target), true);
});
