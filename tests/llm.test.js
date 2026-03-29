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

  global.fetch = async (_, options = {}) => new Response(
    createTimedSseStream(options.signal, [
      { delayMs: 0, data: createContentEvent("开场") },
      { delayMs: 30, data: createContentEvent("后续") },
      { delayMs: 0, data: createDoneEvent(), close: true }
    ]),
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

test("streamText keeps streaming beyond the legacy request timeout while chunks keep arriving", async (t) => {
  const originalFetch = global.fetch;
  const originalEnv = {
    AINOVEL_API_KEY: process.env.AINOVEL_API_KEY,
    AINOVEL_BASE_URL: process.env.AINOVEL_BASE_URL,
    AINOVEL_MODEL: process.env.AINOVEL_MODEL
  };

  global.fetch = async (_, options = {}) => new Response(
    createTimedSseStream(options.signal, [
      { delayMs: 0, data: createContentEvent("第一段") },
      { delayMs: 18, data: createContentEvent("第二段") },
      { delayMs: 18, data: createDoneEvent(), close: true }
    ]),
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

  const text = await streamText("draft", "prompt", {}, {
    maxRetries: 0,
    timeoutMs: 20,
    streamConnectTimeoutMs: 20,
    streamIdleTimeoutMs: 40
  });

  assert.equal(text, "第一段第二段");
});

test("streamText aborts when the first stream chunk does not start in time", async (t) => {
  const originalFetch = global.fetch;
  const originalEnv = {
    AINOVEL_API_KEY: process.env.AINOVEL_API_KEY,
    AINOVEL_BASE_URL: process.env.AINOVEL_BASE_URL,
    AINOVEL_MODEL: process.env.AINOVEL_MODEL
  };

  global.fetch = async (_, options = {}) => new Response(
    createTimedSseStream(options.signal, [
      { delayMs: 25, data: createContentEvent("迟到首包") },
      { delayMs: 0, data: createDoneEvent(), close: true }
    ]),
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
    streamText("draft", "prompt", {}, {
      maxRetries: 0,
      timeoutMs: 100,
      streamConnectTimeoutMs: 10,
      streamIdleTimeoutMs: 40
    }),
    /LLM stream did not start/
  );
});

test("generateText still uses total request timeout for non-stream responses", async (t) => {
  const originalFetch = global.fetch;
  const originalEnv = {
    AINOVEL_API_KEY: process.env.AINOVEL_API_KEY,
    AINOVEL_BASE_URL: process.env.AINOVEL_BASE_URL,
    AINOVEL_MODEL: process.env.AINOVEL_MODEL
  };

  global.fetch = async (_, options = {}) =>
    new Promise((_, reject) => {
      if (options.signal?.aborted) {
        reject(options.signal.reason);
        return;
      }
      options.signal?.addEventListener(
        "abort",
        () => reject(options.signal.reason),
        { once: true }
      );
    });
  process.env.AINOVEL_API_KEY = "test-key";
  process.env.AINOVEL_BASE_URL = "https://example.com/v1";
  process.env.AINOVEL_MODEL = "gpt-4.1-mini";

  t.after(() => {
    global.fetch = originalFetch;
    restoreEnv(originalEnv);
  });

  await assert.rejects(
    generateText("outline", "prompt", {}, { maxRetries: 0, timeoutMs: 10 }),
    /LLM request timed out after 10ms/
  );
});

function createTimedSseStream(signal, steps) {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      let finished = false;

      const closeSafely = () => {
        if (finished) {
          return;
        }
        finished = true;
        controller.close();
      };

      const errorSafely = (error) => {
        if (finished) {
          return;
        }
        finished = true;
        controller.error(error);
      };

      if (signal) {
        if (signal.aborted) {
          errorSafely(signal.reason);
          return;
        }
        signal.addEventListener("abort", () => errorSafely(signal.reason), { once: true });
      }

      let elapsedMs = 0;
      for (const step of steps) {
        elapsedMs += step.delayMs;
        const timer = setTimeout(() => {
          if (finished || signal?.aborted) {
            return;
          }
          if (step.data) {
            controller.enqueue(encoder.encode(step.data));
          }
          if (step.close) {
            closeSafely();
          }
        }, elapsedMs);
        timer.unref?.();
      }
    }
  });
}

function createContentEvent(content) {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\n`;
}

function createDoneEvent() {
  return "data: [DONE]\n\n";
}

function restoreEnv(snapshot) {
  for (const [key, value] of Object.entries(snapshot)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}
