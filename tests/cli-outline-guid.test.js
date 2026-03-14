import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import { runCommand } from "../src/lib/cli.js";
import { initProject } from "../src/lib/project.js";
import { readText } from "../src/lib/fs.js";

test("outline accepts additional requirements and writes outline files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-outline-"));
  await initProject(root, "outline-demo");

  const result = await runCommand(["outline", "强化朝堂博弈与宿命感"], {
    rootDir: root,
    print: false
  });

  const story = await readText(path.join(root, "outline", "story.md"));

  assert.match(result.output, /Generated outline files/);
  assert.match(story, /故事总纲/);
});

test("guid writes outline artifacts from provided guided answers", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "ainovel-guid-"));
  await initProject(root, "guid-demo");

  const result = await runCommand(["guid"], {
    rootDir: root,
    print: false,
    guideAnswers: {
      genreAndTone: "东方玄幻权谋",
      worldAndRules: "王朝修行体系，借命晋升",
      protagonistAndSetup: "被废世子流落北境",
      goalAndCost: "夺回身份，代价是旧部不断牺牲",
      conflictAndEnding: "皇权与天命对撞，偏向苦尽甘来"
    }
  });

  const characters = await readText(path.join(root, "characters", "roster.md"));
  const world = await readText(path.join(root, "world", "rules.md"));

  assert.match(result.output, /Generated guided outline files/);
  assert.match(characters, /人物设定/);
  assert.match(world, /世界规则/);
});
