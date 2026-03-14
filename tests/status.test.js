import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { getChapterStatuses, initProject } from "../src/lib/project.js";
import { writeText } from "../src/lib/fs.js";

test("getChapterStatuses reports plan and draft state", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-status-"));
  await initProject(root, "status-demo");
  await writeText(path.join(root, "chapters", "001.plan.md"), "---\nchapter_id: 001\n---\n# plan");
  await writeText(
    path.join(root, "chapters", "002.draft.md"),
    "---\nchapter_id: 002\nsummary_status: complete\n---\n# draft"
  );

  const statuses = await getChapterStatuses(root);
  assert.equal(statuses.length, 2);
  assert.equal(statuses[0].hasPlan, true);
  assert.equal(statuses[1].summaryStatus, "complete");
});
