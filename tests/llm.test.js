import test from "node:test";
import assert from "node:assert/strict";
import { generateText, streamText } from "../src/lib/llm.js";

test("generateText retries retryable 429 responses", async (t) => {
  const originalFetch = global.fetch;
  const originalEnv = {
    AINOVEL_API_KEY: process.env.AINOVEL_API_KEY,
    AINOVEL_BASE_URL: process.env.AINOVEL_BASE_URL,
    AINOVEL_MODEL: process.env.AINOVEL_MODEL
  };

  let attempts = 0;
  global.fetch = async () => {
    attempts += 1;
    if (attempts === 1) {
      return new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "0" }
      });
    }

    return new Response(JSON.stringify({ choices: [{ message: { content: "生成成功" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };
  process.env.AINOVEL_API_KEY = "test-key";
  process.env.AINOVEL_BASE_URL = "https://example.com/v1";
  process.env.AINOVEL_MODEL = "gpt-4.1-mini";

  t.after(() => {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  });

  const text = await generateText("outline", "prompt", {}, { maxRetries: 1, retryDelayMs: 0, timeoutMs: 50 });
  assert.equal(text, "生成成功");
  assert.equal(attempts, 2);
});

test("streamText aborts when the stream stalls between chunks", async (t) => {
  const originalFetch = global.fetch;
  const originalEnv = {
    AINOVEL_API_KEY: process.env.AINOVEL_API_KEY,
    AINOVEL_BASE_URL: process.env.AINOVEL_BASE_URL,
    AINOVEL_MODEL: process.env.AINOVEL_MODEL
  };

  global.fetch = async () =>
    new Response(
      new ReadableStream({
        start() {}
      }),
      {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      }
    );
  process.env.AINOVEL_API_KEY = "test-key";
  process.env.AINOVEL_BASE_URL = "https://example.com/v1";
  process.env.AINOVEL_MODEL = "gpt-4.1-mini";

  t.after(() => {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  });

  await assert.rejects(
    streamText("draft", "prompt", {}, { maxRetries: 0, timeoutMs: 100, streamChunkTimeoutMs: 10 }),
    /LLM stream stalled/
  );
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
