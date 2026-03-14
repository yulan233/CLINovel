import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { logError, resolveLogFile } from "../src/lib/log.js";
import { readText } from "../src/lib/fs.js";

test("logError writes stack and context to the project log file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-log-"));
  const error = new Error("boom");
  const logFile = logError(error, {
    type: "test_failure",
    rootDir: root,
    context: {
      chapterId: "003",
      phase: "draft"
    }
  });

  assert.equal(logFile, resolveLogFile(root));

  const raw = await readText(logFile);
  assert.match(raw, /\] test_failure/);
  assert.match(raw, /chapterId: 003/);
  assert.match(raw, /phase: draft/);
  assert.match(raw, /message: boom/);
  assert.match(raw, /stack:/);
});

test("logError normalizes non-Error rejections", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-log-"));
  const logFile = logError("string failure", {
    type: "unhandledRejection",
    rootDir: root
  });

  const raw = await readText(logFile);
  assert.match(raw, /unhandledRejection/);
  assert.match(raw, /message: string failure/);
});
