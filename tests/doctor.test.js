import test from "node:test";
import assert from "node:assert/strict";
import { describeLlmMode } from "../src/lib/llm.js";

test("describeLlmMode reports fallback when api key missing", () => {
  delete process.env.AINOVEL_API_KEY;
  delete process.env.AINOVEL_MODEL;
  delete process.env.AINOVEL_BASE_URL;

  const llm = describeLlmMode({ default_model: "fallback-local" });
  assert.equal(llm.remoteEnabled, false);
  assert.equal(llm.model, "fallback-local");
  assert.equal(llm.maskedApiKey, "(not set)");
});
