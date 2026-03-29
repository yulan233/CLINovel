import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { initProject } from "../src/lib/project.js";
import {
  buildIntentContext,
  changePlotOptionStatus,
  changePlotThreadStatus,
  generatePlotOptions,
  getPlotThread,
  loadPlotState
} from "../src/lib/plot.js";

test("generatePlotOptions persists three options and apply creates active thread", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-plot-"));
  await initProject(root, "plot-demo");

  const generated = await generatePlotOptions(root, "chapter", "001", {});
  assert.equal(generated.options.length, 3);

  const first = generated.options[0];
  const applied = await changePlotOptionStatus(root, first.id, "applied");
  assert.equal(applied.plotState.activeIntent.plotOptionId, first.id);
  assert.equal(applied.plotState.threads.length, 1);
  assert.equal(applied.plotState.activeThreadIds.length, 1);

  const intentContext = await buildIntentContext(root, "001");
  assert.match(intentContext, /剧情线程/);
  assert.match(intentContext, new RegExp(first.title));

  const saved = await loadPlotState(root);
  assert.equal(saved.options.length, 3);
  assert.equal(saved.activeIntent.plotOptionId, first.id);
  assert.equal(saved.threads[0].status, "active");
});

test("plot thread status transitions remove resolved thread from intent context", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-plot-thread-"));
  await initProject(root, "plot-thread-demo");

  const generated = await generatePlotOptions(root, "chapter", "003", {});
  const applied = await changePlotOptionStatus(root, generated.options[0].id, "applied");
  const threadId = applied.thread.id;

  let thread = await getPlotThread(root, threadId);
  assert.equal(thread.status, "active");

  await changePlotThreadStatus(root, threadId, "resolved", "004");
  thread = await getPlotThread(root, threadId);
  assert.equal(thread.status, "resolved");
  assert.equal(thread.resolvedInChapterId, "004");

  const intentContext = await buildIntentContext(root, "005");
  assert.equal(intentContext, "");
});

test("reapplying a plot option updates the persisted active intent", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-plot-reapply-"));
  await initProject(root, "plot-reapply-demo");

  const generated = await generatePlotOptions(root, "chapter", "002", {});
  const first = generated.options[0];
  const second = generated.options[1];

  await changePlotOptionStatus(root, first.id, "applied");
  const secondApplied = await changePlotOptionStatus(root, second.id, "applied");

  const saved = await loadPlotState(root);
  assert.equal(saved.activeIntent.plotOptionId, second.id);
  assert.equal(saved.activeIntent.threadId, secondApplied.thread.id);
});

test("dropping an applied option clears stale activeIntent option references", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-plot-drop-"));
  await initProject(root, "plot-drop-demo");

  const generated = await generatePlotOptions(root, "chapter", "002", {});
  const first = generated.options[0];
  const second = generated.options[1];

  await changePlotOptionStatus(root, first.id, "applied");
  await changePlotOptionStatus(root, second.id, "applied");
  await changePlotOptionStatus(root, second.id, "dropped");

  const saved = await loadPlotState(root);
  assert.notEqual(saved.activeIntent?.plotOptionId, second.id);
});
