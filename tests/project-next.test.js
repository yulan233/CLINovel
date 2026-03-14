import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { initProject, getNextChapterId } from "../src/lib/project.js";
import { writeText } from "../src/lib/fs.js";

test("getNextChapterId finds the next numeric chapter id", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-next-"));
  await initProject(root, "next-demo");
  await writeText(path.join(root, "chapters", "001.plan.md"), "x");
  await writeText(path.join(root, "chapters", "002.draft.md"), "x");

  const nextId = await getNextChapterId(root);
  assert.equal(nextId, "003");
});

