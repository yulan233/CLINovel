import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { initProject, loadProjectConfig } from "../src/lib/project.js";
import { exists, readText } from "../src/lib/fs.js";

test("initProject creates baseline files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-"));
  const paths = await initProject(root, "demo");

  assert.equal(await exists(paths.config), true);
  assert.equal(await exists(paths.style), true);
  assert.match(await readText(paths.style), /文风配置/);

  const config = await loadProjectConfig(root);
  assert.equal(config.title, "demo");
});
