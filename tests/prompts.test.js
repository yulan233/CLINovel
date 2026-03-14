import test from "node:test";
import assert from "node:assert/strict";
import {
  buildChapterPlanPrompt,
  buildChapterRewritePlanPrompt,
  buildChapterRewritePrompt,
  buildChapterRevisionPrompt,
  buildDraftPrompt,
  buildGuidedOutlinePrompt,
  buildMemoryPrompt,
  buildOutlinePrompt,
  extractTaggedSections,
  normalizeDraftOutput,
  normalizePlanOutput
} from "../src/lib/prompts.js";

test("extractTaggedSections returns tagged markdown blocks", () => {
  const text = "<story># A</story>\n<world>- rule</world>";
  const sections = extractTaggedSections(text, ["story", "world"]);
  assert.equal(sections.story, "# A");
  assert.equal(sections.world, "- rule");
});

test("normalizePlanOutput merges llm frontmatter with fallback", () => {
  const normalized = normalizePlanOutput(
    "001",
    "---\nchapter_id: 001\ngoal: 新目标\nmust_include: [冲突, 钩子]\n---\n# 计划\n\n正文",
    {
      frontmatter: { chapter_id: "001", goal: "旧目标", must_include: ["旧"], continuity_notes: ["连续"] },
      body: "fallback"
    }
  );

  assert.equal(normalized.frontmatter.goal, "新目标");
  assert.deepEqual(normalized.frontmatter.must_include, ["冲突", "钩子"]);
  assert.equal(normalized.body, "# 计划\n\n正文");
});

test("normalizeDraftOutput preserves chapter id as zero-padded string", () => {
  const normalized = normalizeDraftOutput(
    "001",
    "---\nchapter_id: 1\nstatus: draft\nsummary_status: pending\n---\n# 正文",
    {
      frontmatter: { chapter_id: "001", status: "draft", summary_status: "pending" },
      body: "fallback"
    }
  );

  assert.equal(normalized.frontmatter.chapter_id, "001");
  assert.equal(normalized.body, "# 正文");
});

test("chapter and draft prompts emphasize continuity and concrete progression", () => {
  const planPrompt = buildChapterPlanPrompt("003", "# 上下文\n- 主角已暴露身份");
  const draftPrompt = buildDraftPrompt("003", "# 上下文\n- 主角已暴露身份");

  assert.match(planPrompt, /不能重置人物关系、设定状态或已发生事件/);
  assert.match(planPrompt, /不得回退到旧状态/);
  assert.match(planPrompt, /场景拆分必须写出每个场景的目标、阻碍、结果/);
  assert.match(draftPrompt, /不得无依据新增关键设定/);
  assert.match(draftPrompt, /不得写回旧状态/);
  assert.match(draftPrompt, /冲突、代价、选择必须具体/);
});

test("outline prompts include requirements and guided answers", () => {
  const outlinePrompt = buildOutlinePrompt(
    { title: "Demo", genre: "玄幻", target_length: "长篇" },
    "# 文风\n- 冷峻",
    "强化宿命感和朝堂博弈"
  );
  const guidedPrompt = buildGuidedOutlinePrompt(
    { title: "Demo", genre: "玄幻", target_length: "长篇" },
    {
      genreAndTone: "玄幻权谋，压抑中带反扑",
      worldAndRules: "王朝修行体系，越晋升代价越高",
      protagonistAndSetup: "废太子流落边城",
      goalAndCost: "夺回身份，但会牺牲旧部",
      conflictAndEnding: "皇权与天命冲突，偏苦尽甘来"
    },
    "# 文风\n- 冷峻"
  );

  assert.match(outlinePrompt, /用户补充要求/);
  assert.match(outlinePrompt, /强化宿命感和朝堂博弈/);
  assert.match(guidedPrompt, /引导式输入/);
  assert.match(guidedPrompt, /废太子流落边城/);
  assert.match(guidedPrompt, /<story>/);
  assert.match(guidedPrompt, /<world>/);
});

test("memory and revision prompts emphasize retention rules and minimal destructive edits", () => {
  const memoryPrompt = buildMemoryPrompt("003", "# 正文", "# 长期记忆");
  const revisionPrompt = buildChapterRevisionPrompt("003", "# 计划", "# 正文", "加重冲突", "# 上下文");

  assert.match(memoryPrompt, /已解决内容不要继续保留/);
  assert.match(memoryPrompt, /不要复述全文/);
  assert.match(memoryPrompt, /写最新有效版本/);
  assert.match(memoryPrompt, /旧状态被新状态覆盖/);
  assert.match(memoryPrompt, /已解决伏笔被移除/);
  assert.match(memoryPrompt, /story_threads/);
  assert.match(memoryPrompt, /entities/);
  assert.match(revisionPrompt, /优先只修改反馈明确涉及的层面/);
  assert.match(revisionPrompt, /不能直接推翻已成立事实/);
});

test("rewrite prompts require retrieval planning and structural rewrite constraints", () => {
  const planPrompt = buildChapterRewritePlanPrompt("003", "# 计划", "# 正文", "强化上文承接", "# 上下文");
  const rewritePrompt = buildChapterRewritePrompt(
    "003",
    "# 计划",
    "# 正文",
    "强化上文承接",
    "# 上下文",
    "## 检索策略\n- 核对上一章",
    "## 第002章正文\n..."
  );

  assert.match(planPrompt, /chapter_id\|files\|reason/);
  assert.match(planPrompt, /files 只能使用 `plan`、`draft`、`memory`/);
  assert.match(planPrompt, /最多 4 条/);
  assert.match(rewritePrompt, /允许重排场景顺序、信息揭示顺序和冲突节奏/);
  assert.match(rewritePrompt, /以前文已成立事实为准/);
  assert.match(rewritePrompt, /不要为了重写而平白新增关键设定/);
});
