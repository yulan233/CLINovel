import test from "node:test";
import assert from "node:assert/strict";
import { cleanupAiLeak, containsAiLeak } from "../src/lib/ai-leak.js";

test("containsAiLeak detects common meta narration markers", () => {
  assert.equal(containsAiLeak("以下是重写后的正文"), true);
  assert.equal(containsAiLeak("# 第001章\n\n正文开始。"), false);
});

test("cleanupAiLeak removes leaking lines and keeps body content", () => {
  const cleaned = cleanupAiLeak(["以下是正文", "# 第001章", "", "真正的内容。", "作为 AI 我会继续。"].join("\n"));
  assert.equal(cleaned, ["# 第001章", "", "真正的内容。"].join("\n"));
});
