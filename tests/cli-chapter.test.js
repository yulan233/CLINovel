import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { runCommand } from "../src/lib/cli.js";
import { initProject } from "../src/lib/project.js";
import { readText } from "../src/lib/fs.js";

test("chapter plan and write use the shared fallback flow successfully", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-cli-chapter-"));
  await initProject(root, "chapter-demo");

  const planResult = await runCommand(["chapter", "plan", "001"], {
    rootDir: root,
    print: false
  });
  const writeResult = await runCommand(["chapter", "write", "001"], {
    rootDir: root,
    print: false
  });

  const planDoc = await readText(path.join(root, "chapters", "001.plan.md"));
  const draftDoc = await readText(path.join(root, "chapters", "001.draft.md"));

  assert.match(planResult.output, /Generated chapter plan/);
  assert.match(writeResult.output, /Generated chapter draft/);
  assert.match(planDoc, /chapter_id: 001/);
  assert.match(draftDoc, /summary_status: complete/);
});

test("chapter revise updates the draft through the shared draft completion flow", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-cli-revise-"));
  await initProject(root, "chapter-revise-demo");

  await runCommand(["chapter", "plan", "001"], {
    rootDir: root,
    print: false
  });
  await runCommand(["chapter", "write", "001"], {
    rootDir: root,
    print: false
  });

  const reviseResult = await runCommand(["chapter", "revise", "001", "强化结尾钩子"], {
    rootDir: root,
    print: false
  });
  const revisedDraft = await readText(path.join(root, "chapters", "001.draft.md"));

  assert.match(reviseResult.output, /Revised chapter draft/);
  assert.match(revisedDraft, /修订备注|第001章/);
  assert.match(revisedDraft, /summary_status: complete/);
});
