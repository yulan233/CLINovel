import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { safeListPath, safeReadPath, safeWritePath } from "../src/lib/fs.js";
import { initProject } from "../src/lib/project.js";

test("safe path helpers keep file access inside project root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-fs-safe-"));
  await initProject(root, "fs-safe-demo");

  const filePath = await safeWritePath(root, "chapters/001.plan.md", "# plan\n");
  const content = await safeReadPath(root, "chapters/001.plan.md", "");
  const files = await safeListPath(root, "chapters");

  assert.equal(filePath, path.join(root, "chapters", "001.plan.md"));
  assert.equal(content, "# plan\n");
  assert.deepEqual(files, ["001.plan.md"]);
});

test("safe path helpers reject traversal outside the project root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-fs-escape-"));
  await initProject(root, "fs-escape-demo");

  await assert.rejects(() => safeReadPath(root, "../secret.txt", ""), /Path escapes base directory/);
  await assert.rejects(() => safeWritePath(root, "../secret.txt", "nope"), /Path escapes base directory/);
  await assert.rejects(() => safeListPath(root, "../outside"), /Path escapes base directory/);
});
