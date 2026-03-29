import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { runCommand } from "../src/lib/cli.js";
import { initProject } from "../src/lib/project.js";
import { writeText } from "../src/lib/fs.js";

test("doctor reports the loaded env file path", async (t) => {
  const originalEnv = {
    AINOVEL_API_KEY: process.env.AINOVEL_API_KEY,
    AINOVEL_BASE_URL: process.env.AINOVEL_BASE_URL,
    AINOVEL_MODEL: process.env.AINOVEL_MODEL,
    AINOVEL_REQUEST_TIMEOUT_MS: process.env.AINOVEL_REQUEST_TIMEOUT_MS,
    AINOVEL_STREAM_CONNECT_TIMEOUT_MS: process.env.AINOVEL_STREAM_CONNECT_TIMEOUT_MS,
    AINOVEL_STREAM_IDLE_TIMEOUT_MS: process.env.AINOVEL_STREAM_IDLE_TIMEOUT_MS
  };
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-doctor-env-"));
  await initProject(root, "doctor-demo");
  await writeText(path.join(root, ".env"), "AINOVEL_MODEL=gpt-4.1-mini\n");

  delete process.env.AINOVEL_API_KEY;
  delete process.env.AINOVEL_BASE_URL;
  delete process.env.AINOVEL_MODEL;

  t.after(() => restoreEnv(originalEnv));

  const result = await runCommand(["doctor"], {
    rootDir: root,
    print: false
  });

  assert.match(result.output, new RegExp(`${escapeRegex(path.join(root, ".env"))}`));
});

test("doctor reports stream timeout configuration", async (t) => {
  const originalEnv = {
    AINOVEL_API_KEY: process.env.AINOVEL_API_KEY,
    AINOVEL_BASE_URL: process.env.AINOVEL_BASE_URL,
    AINOVEL_MODEL: process.env.AINOVEL_MODEL,
    AINOVEL_REQUEST_TIMEOUT_MS: process.env.AINOVEL_REQUEST_TIMEOUT_MS,
    AINOVEL_STREAM_CONNECT_TIMEOUT_MS: process.env.AINOVEL_STREAM_CONNECT_TIMEOUT_MS,
    AINOVEL_STREAM_IDLE_TIMEOUT_MS: process.env.AINOVEL_STREAM_IDLE_TIMEOUT_MS
  };
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-doctor-timeout-"));
  await initProject(root, "doctor-timeout-demo");

  process.env.AINOVEL_MODEL = "gpt-4.1-mini";
  process.env.AINOVEL_REQUEST_TIMEOUT_MS = "90000";
  process.env.AINOVEL_STREAM_CONNECT_TIMEOUT_MS = "45000";
  process.env.AINOVEL_STREAM_IDLE_TIMEOUT_MS = "25000";

  t.after(() => restoreEnv(originalEnv));

  const result = await runCommand(["doctor"], {
    rootDir: root,
    print: false
  });

  assert.match(result.output, /LLM timeout_ms: 90000/);
  assert.match(result.output, /LLM stream_connect_timeout_ms: 45000/);
  assert.match(result.output, /LLM stream_idle_timeout_ms: 25000/);
});

test("export rejects output paths outside the project root", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-export-safety-"));
  await initProject(root, "export-safety-demo");

  await assert.rejects(
    runCommand(["export", "../escape.md"], {
      rootDir: root,
      print: false
    }),
    /Path escapes base directory/
  );
});

test("chapter commands reject non-numeric chapter ids", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-chapter-id-"));
  await initProject(root, "chapter-id-demo");

  await assert.rejects(
    runCommand(["chapter", "plan", "abc"], {
      rootDir: root,
      print: false
    }),
    /Usage: ainovel chapter plan <chapter-id>/
  );
});

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
