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
  assert.equal(llm.contextWindow, null);
});

test("describeLlmMode reports known context windows for supported models", () => {
  delete process.env.AINOVEL_MODEL;
  const llm = describeLlmMode({ default_model: "gpt-4.1-mini" });
  assert.equal(llm.contextWindow, 1047576);
});

test("describeLlmMode exposes stream timeout configuration", (t) => {
  const originalEnv = {
    AINOVEL_REQUEST_TIMEOUT_MS: process.env.AINOVEL_REQUEST_TIMEOUT_MS,
    AINOVEL_STREAM_CONNECT_TIMEOUT_MS: process.env.AINOVEL_STREAM_CONNECT_TIMEOUT_MS,
    AINOVEL_STREAM_IDLE_TIMEOUT_MS: process.env.AINOVEL_STREAM_IDLE_TIMEOUT_MS
  };
  process.env.AINOVEL_REQUEST_TIMEOUT_MS = "90000";
  process.env.AINOVEL_STREAM_CONNECT_TIMEOUT_MS = "45000";
  process.env.AINOVEL_STREAM_IDLE_TIMEOUT_MS = "25000";

  t.after(() => {
    restoreEnv(originalEnv);
  });

  const llm = describeLlmMode({ default_model: "gpt-4.1-mini" });
  assert.equal(llm.timeoutMs, 90000);
  assert.equal(llm.streamConnectTimeoutMs, 45000);
  assert.equal(llm.streamIdleTimeoutMs, 25000);
});

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
