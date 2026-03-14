import test from "node:test";
import assert from "node:assert/strict";
import { getSlashSuggestions, interpretInput, updateInputState } from "../src/lib/input.js";

test("interpretInput maps natural language to chapter plan", () => {
  assert.deepEqual(interpretInput("请帮我规划第 3 章"), ["chapter", "plan", "3"]);
});

test("interpretInput maps natural language to draft writing", () => {
  assert.deepEqual(interpretInput("写第12章"), ["chapter", "write", "12"]);
});

test("interpretInput accepts raw cli commands", () => {
  assert.deepEqual(interpretInput("memory rebuild"), ["memory", "rebuild"]);
  assert.deepEqual(interpretInput("plot generate book"), ["plot", "generate", "book"]);
  assert.deepEqual(interpretInput("outline 强化主角宿命感"), ["outline", "强化主角宿命感"]);
  assert.deepEqual(interpretInput("guid"), ["guid"]);
});

test("interpretInput maps natural language to chapter revision", () => {
  assert.deepEqual(interpretInput("修改第 7 章 节奏更快"), ["chapter", "revise", "7", "节奏更快"]);
});

test("interpretInput maps rewrite requests to chapter rewrite", () => {
  assert.deepEqual(interpretInput("重写第 7 章 强化上文承接"), ["chapter", "rewrite", "7", "强化上文承接"]);
  assert.deepEqual(interpretInput("/rewirte 007 强化冲突", { currentChapterId: "003" }), [
    "chapter",
    "rewrite",
    "007",
    "强化冲突"
  ]);
});

test("interpretInput supports next chapter shortcuts", () => {
  assert.deepEqual(interpretInput("写下一章"), ["chapter", "next", "write"]);
  assert.deepEqual(interpretInput("规划下一章"), ["chapter", "next", "plan"]);
});

test("interpretInput uses current chapter for slash commands", () => {
  assert.deepEqual(interpretInput("/plan", { currentChapterId: "003" }), ["chapter", "plan", "003"]);
  assert.deepEqual(interpretInput("/plot chapter", { currentChapterId: "003" }), [
    "plot",
    "generate",
    "chapter",
    "003"
  ]);
});

test("updateInputState stores the latest chapter id", () => {
  const state = { currentChapterId: null };
  updateInputState(state, ["chapter", "write", "7"]);
  assert.equal(state.currentChapterId, "007");
  updateInputState(state, ["chapter", "rewrite", "8"]);
  assert.equal(state.currentChapterId, "008");
});

test("getSlashSuggestions expands chapter placeholders", () => {
  const suggestions = getSlashSuggestions("/pl", { currentChapterId: "009" });
  assert.ok(suggestions.length > 0);
  assert.match(suggestions[0].preview, /009/);
});

test("interpretInput supports inspector slash commands", () => {
  assert.deepEqual(interpretInput("/inspect status"), ["inspect", "status"]);
  assert.deepEqual(interpretInput("/inspect loops"), ["inspect", "loops"]);
  assert.deepEqual(interpretInput("/loop list"), ["memory", "loops"]);
  assert.deepEqual(interpretInput("/entity 主角"), ["memory", "entity", "主角"]);
  assert.deepEqual(interpretInput("/next write"), ["chapter", "next", "write"]);
  assert.deepEqual(interpretInput("/outline 强化反转密度"), ["outline", "强化反转密度"]);
  assert.deepEqual(interpretInput("/guid"), ["guid"]);
  assert.deepEqual(interpretInput("/init"), ["init"]);
  assert.deepEqual(interpretInput("/retry"), ["retry"]);
  assert.deepEqual(interpretInput("/close"), ["close"]);
});
