import test from "node:test";
import assert from "node:assert/strict";
import { formatStyleForPrompt, parseStyleText } from "../src/lib/style.js";

test("parseStyleText extracts structured fields and freeform text", () => {
  const parsed = parseStyleText(
    [
      "# 文风配置",
      "- 叙事视角：第一人称",
      "- 节奏：快",
      "",
      "补充说明：整体更压抑。"
    ].join("\n")
  );

  assert.equal(parsed.structured["叙事视角"], "第一人称");
  assert.equal(parsed.structured["节奏"], "快");
  assert.match(parsed.freeform.join("\n"), /补充说明/);
});

test("formatStyleForPrompt renders structured and freeform sections", () => {
  const promptText = formatStyleForPrompt("- 叙事视角：第三人称\n补充说明：更冷峻");
  assert.match(promptText, /结构化文风约束/);
  assert.match(promptText, /第三人称/);
  assert.match(promptText, /自由文本补充/);
});
