import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { initProject, loadProjectConfig } from "../src/lib/project.js";
import { exists, readText, writeText } from "../src/lib/fs.js";

test("initProject creates baseline files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-"));
  const paths = await initProject(root, "demo");

  assert.equal(await exists(paths.config), true);
  assert.equal(await exists(paths.style), true);
  assert.match(await readText(paths.style), /文风配置/);

  const config = await loadProjectConfig(root);
  assert.equal(config.title, "demo");
});

test("loadProjectConfig preserves values containing colons", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-project-config-"));
  const paths = await initProject(root, "demo");

  await writeText(
    paths.config,
    ["title: 三国：演义", "genre: 历史：战争", "target_length: 长篇"].join("\n") + "\n"
  );

  const config = await loadProjectConfig(root);
  assert.equal(config.title, "三国：演义");
  assert.equal(config.genre, "历史：战争");
});

test("loadProjectConfig parses multiline and array values", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-project-yaml-"));
  const paths = await initProject(root, "demo");

  await writeText(
    paths.config,
    [
      "title: demo",
      "notes:",
      "  第一行",
      "  第二行",
      "aliases:",
      "  - 北境",
      "  - 王城"
    ].join("\n") + "\n"
  );

  const config = await loadProjectConfig(root);
  assert.equal(config.notes, "第一行\n第二行");
  assert.deepEqual(config.aliases, ["北境", "王城"]);
});
