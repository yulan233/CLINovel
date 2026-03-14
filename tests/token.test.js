import test from "node:test";
import assert from "node:assert/strict";
import { buildTokenUsage, countTokens } from "../src/lib/token.js";

test("countTokens returns a stable positive token count", () => {
  const tokens = countTokens("第001章\n林雾推开了门。", "gpt-4.1-mini");
  assert.ok(tokens > 0);
});

test("buildTokenUsage separates prompt and reference sections", () => {
  const usage = buildTokenUsage(
    [
      { id: "story", label: "故事总纲", text: "主角踏上旅程。".repeat(20), group: "prompt" },
      { id: "recent", label: "近期记忆", text: "队伍刚离开边城。".repeat(8), group: "prompt" },
      { id: "memory", label: "章节记忆摘要", text: "上一章发生了冲突。".repeat(6), group: "reference" }
    ],
    12000,
    "gpt-4.1-mini"
  );

  assert.equal(usage.budget, 12000);
  assert.ok(usage.usedTokens > 0);
  assert.equal(usage.promptSections.length, 2);
  assert.equal(usage.referenceSections.length, 1);
  assert.ok(usage.promptSections[0].tokens >= usage.promptSections[1].tokens);
  assert.equal(usage.remainingTokens, 12000 - usage.usedTokens);
});

test("buildTokenUsage falls back for unknown models", () => {
  const usage = buildTokenUsage([{ id: "style", label: "文风", text: "冷峻、克制。", group: "prompt" }], 2000, "custom-model");
  assert.ok(usage.usedTokens > 0);
});
