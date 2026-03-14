import test from "node:test";
import assert from "node:assert/strict";
import { streamText } from "../src/lib/llm.js";

test("streamText simulates streaming in fallback-local mode", async () => {
  const chunks = [];
  const text = await streamText(
    "draft",
    "prompt",
    { default_model: "fallback-local" },
    {
      fallbackText: "第一段。\n第二段。",
      onToken(chunk) {
        chunks.push(chunk);
      }
    }
  );

  assert.equal(text, "第一段。\n第二段。");
  assert.ok(chunks.length >= 1);
  assert.equal(chunks.join(""), text);
});
