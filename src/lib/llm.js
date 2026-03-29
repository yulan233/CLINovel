import { getModelContextWindow } from "./token.js";

const DEFAULT_MODEL = process.env.AINOVEL_MODEL || "fallback-local";
const DEFAULT_BASE_URL = process.env.AINOVEL_BASE_URL || "https://api.openai.com/v1";
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_STREAM_IDLE_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 400;
const RETRYABLE_STATUS_CODES = new Set([408, 425, 429, 500, 502, 503, 504]);

export function getLlmConfig(projectConfig = {}) {
  const timeoutMs = readPositiveInt(process.env.AINOVEL_REQUEST_TIMEOUT_MS || projectConfig.request_timeout_ms, DEFAULT_REQUEST_TIMEOUT_MS);
  return {
    model: process.env.AINOVEL_MODEL || projectConfig.default_model || DEFAULT_MODEL,
    apiKey: process.env.AINOVEL_API_KEY || "",
    baseUrl: process.env.AINOVEL_BASE_URL || DEFAULT_BASE_URL,
    timeoutMs,
    streamConnectTimeoutMs: readPositiveInt(
      process.env.AINOVEL_STREAM_CONNECT_TIMEOUT_MS || projectConfig.stream_connect_timeout_ms,
      timeoutMs
    ),
    streamIdleTimeoutMs: readPositiveInt(
      process.env.AINOVEL_STREAM_IDLE_TIMEOUT_MS || projectConfig.stream_idle_timeout_ms,
      DEFAULT_STREAM_IDLE_TIMEOUT_MS
    )
  };
}

export function describeLlmMode(projectConfig = {}) {
  const config = getLlmConfig(projectConfig);
  const remoteEnabled = Boolean(config.apiKey) && config.model !== "fallback-local";

  return {
    ...config,
    contextWindow: getModelContextWindow(config.model),
    remoteEnabled,
    maskedApiKey: config.apiKey ? `${config.apiKey.slice(0, 4)}***` : "(not set)"
  };
}

export async function generateText(task, prompt, projectConfig = {}, options = {}) {
  if (options.stream) {
    return streamText(task, prompt, projectConfig, options);
  }

  const config = getLlmConfig(projectConfig);
  if (!config.apiKey || config.model === "fallback-local") {
    return null;
  }

  return executeChatCompletionRequest(task, prompt, config, options, async (response) => {
    let payload;
    try {
      payload = await response.json();
    } catch {
      const body = await response.text();
      throw new Error(`LLM returned invalid JSON for task "${task}": ${body}`);
    }

    const text = payload?.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error(`LLM returned empty content for task "${task}"`);
    }

    return text;
  });
}

export async function streamText(task, prompt, projectConfig = {}, observer = {}) {
  const config = getLlmConfig(projectConfig);
  const signal = observer.signal;
  const onToken = observer.onToken || (() => {});
  const onComplete = observer.onComplete || (() => {});
  const onStart = observer.onStart || (() => {});
  const streamConnectTimeoutMs = readPositiveInt(
    observer.streamConnectTimeoutMs ?? observer.timeoutMs,
    config.streamConnectTimeoutMs
  );
  const streamIdleTimeoutMs = readPositiveInt(
    observer.streamChunkTimeoutMs ?? observer.streamIdleTimeoutMs,
    config.streamIdleTimeoutMs
  );

  onStart({
    model: config.model,
    remoteEnabled: Boolean(config.apiKey) && config.model !== "fallback-local",
    streamConnectTimeoutMs,
    streamIdleTimeoutMs
  });

  if (!config.apiKey || config.model === "fallback-local") {
    const fallback = observer.fallbackText ?? "";
    const streamed = await streamFallbackText(fallback, { onToken, signal });
    onComplete(streamed);
    return streamed;
  }

  return executeChatCompletionRequest(task, prompt, config, { ...observer, stream: true }, async (response, request) => {
    if (!response.body) {
      throw new Error("LLM response did not include a stream body");
    }

    let reader;
    try {
      reader = response.body.getReader();
    } catch (error) {
      throw new Error(`Failed to open LLM response stream: ${error.message}`);
    }

    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    let hasReceivedChunk = false;

    request.clearTimeout();

    try {
      while (true) {
        if (signal?.aborted) {
          throw abortError();
        }

        const { value, done } = await readStreamChunkWithTimeout(
          reader,
          hasReceivedChunk ? streamIdleTimeoutMs : streamConnectTimeoutMs,
          request,
          hasReceivedChunk ? "idle" : "connect"
        );
        if (done) {
          break;
        }
        hasReceivedChunk = true;

        buffer += decoder.decode(value, { stream: true });
        const chunks = buffer.split("\n\n");
        buffer = chunks.pop() || "";

        for (const chunk of chunks) {
          const parsed = parseSseChunk(chunk);
          for (const entry of parsed) {
            if (entry === "[DONE]") {
              onComplete(text);
              return text;
            }

            try {
              const payload = JSON.parse(entry);
              const delta = payload?.choices?.[0]?.delta?.content || "";
              if (delta) {
                text += delta;
                onToken(delta, text);
              }
            } catch {
              // Ignore unknown stream frames from compatible providers.
            }
          }
        }
      }
    } catch (error) {
      if (text.trim()) {
        error.retryable = false;
      }
      throw error;
    } finally {
      try {
        await reader.cancel();
      } catch {
        // Ignore stream close errors during cleanup.
      }
    }

    if (buffer.trim()) {
      const trailing = parseSseChunk(buffer);
      for (const entry of trailing) {
        if (entry === "[DONE]") {
          onComplete(text);
          return text;
        }
      }
    }

    if (!text.trim()) {
      throw new Error(`LLM returned empty content for task "${task}"`);
    }

    onComplete(text);
    return text;
  });
}

async function executeChatCompletionRequest(task, prompt, config, options, consumeResponse) {
  const url = `${config.baseUrl.replace(/\/$/, "")}/chat/completions`;
  const timeoutMs = readPositiveInt(options.timeoutMs, config.timeoutMs);
  const maxRetries = readPositiveInt(options.maxRetries, DEFAULT_MAX_RETRIES);
  const retryDelayMs = readPositiveInt(options.retryDelayMs, DEFAULT_RETRY_DELAY_MS);
  let attempt = 0;

  while (true) {
    attempt += 1;
    const request = createRequestContext(options.signal, timeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${config.apiKey}`
        },
        signal: request.signal,
        body: JSON.stringify(buildChatRequest(task, prompt, config.model, options.stream === true))
      });

      if (!response.ok) {
        if (attempt <= maxRetries && shouldRetryStatus(response.status)) {
          await waitBeforeRetry(attempt, response.headers.get("retry-after"), retryDelayMs, options.signal);
          continue;
        }
        throw await buildHttpError(response);
      }

      return await consumeResponse(response, request);
    } catch (error) {
      const normalized = normalizeRequestError(error, request.signal, options.signal);
      if (normalized.name === "AbortError" && !isTimeoutError(normalized)) {
        throw normalized;
      }
      if (attempt > maxRetries || !shouldRetryError(normalized)) {
        throw normalized;
      }
      await waitBeforeRetry(attempt, null, retryDelayMs, options.signal);
    } finally {
      request.cleanup();
    }
  }
}

function buildChatRequest(task, prompt, model, stream) {
  return {
    model: model === "fallback-local" ? "gpt-4o-mini" : model,
    stream,
    temperature: task === "draft" ? 0.9 : 0.5,
    messages: [
      {
        role: "system",
        content:
          "You are an AI novelist assistant. Return clean markdown only. Stay consistent with prior plot facts."
      },
      {
        role: "user",
        content: prompt
      }
    ]
  };
}

async function buildHttpError(response) {
  const body = await response.text();
  return new Error(`LLM request failed (${response.status}): ${body}`);
}

async function readStreamChunkWithTimeout(reader, timeoutMs, request, stage = "idle") {
  if (!timeoutMs) {
    return reader.read();
  }

  let timeoutId = null;
  const stalledError = timeoutError(
    stage === "connect"
      ? `LLM stream did not start after ${timeoutMs}ms`
      : `LLM stream stalled for ${timeoutMs}ms`
  );
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = setTimeout(() => {
      request.abort(stalledError);
      Promise.resolve(reader.cancel(stalledError)).catch(() => {});
      reject(stalledError);
    }, timeoutMs);
    timeoutId.unref?.();
  });

  return Promise.race([reader.read(), timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function createRequestContext(externalSignal, timeoutMs) {
  const controller = new AbortController();
  const cleanupFns = [];
  let timeoutId = null;

  const abort = (reason) => {
    if (!controller.signal.aborted) {
      controller.abort(reason);
    }
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      abort(normalizeAbortReason(externalSignal.reason));
    } else {
      const onAbort = () => abort(normalizeAbortReason(externalSignal.reason));
      externalSignal.addEventListener("abort", onAbort, { once: true });
      cleanupFns.push(() => externalSignal.removeEventListener("abort", onAbort));
    }
  }

  const clearTimeoutHandle = () => {
    if (timeoutId) {
      clearTimeout(timeoutId);
      timeoutId = null;
    }
  };

  const setTimeoutHandle = (ms, reason) => {
    clearTimeoutHandle();
    if (ms > 0) {
      timeoutId = setTimeout(() => abort(reason), ms);
      timeoutId.unref?.();
    }
  };

  if (timeoutMs > 0) {
    setTimeoutHandle(timeoutMs, timeoutError(`LLM request timed out after ${timeoutMs}ms`));
  }

  return {
    signal: controller.signal,
    abort,
    clearTimeout: clearTimeoutHandle,
    setTimeout(ms, reason) {
      setTimeoutHandle(ms, reason);
    },
    cleanup() {
      clearTimeoutHandle();
      for (const fn of cleanupFns) {
        fn();
      }
    }
  };
}

function normalizeRequestError(error, requestSignal, externalSignal) {
  if (externalSignal?.aborted) {
    return abortError();
  }

  if (requestSignal?.aborted) {
    return normalizeAbortReason(requestSignal.reason);
  }

  return error instanceof Error ? error : new Error(String(error));
}

function normalizeAbortReason(reason) {
  if (reason instanceof Error) {
    return reason;
  }

  return abortError();
}

function shouldRetryStatus(status) {
  return RETRYABLE_STATUS_CODES.has(Number(status));
}

function shouldRetryError(error) {
  if (error?.retryable === false) {
    return false;
  }

  if (isTimeoutError(error)) {
    return true;
  }

  if (error?.name === "AbortError") {
    return false;
  }

  if (error?.name === "TypeError") {
    return true;
  }

  const causeCode = error?.cause?.code || error?.code;
  return ["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "UND_ERR_CONNECT_TIMEOUT"].includes(causeCode);
}

async function waitBeforeRetry(attempt, retryAfterHeader, retryDelayMs, signal) {
  const retryAfterMs = parseRetryAfterMs(retryAfterHeader);
  const backoffMs = retryAfterMs ?? Math.min(8_000, retryDelayMs * (2 ** Math.max(0, attempt - 1)));
  if (backoffMs > 0) {
    await delay(backoffMs, signal);
  }
}

function parseRetryAfterMs(headerValue) {
  if (!headerValue) {
    return null;
  }

  const seconds = Number.parseFloat(headerValue);
  if (Number.isFinite(seconds)) {
    return Math.max(0, Math.round(seconds * 1000));
  }

  const timestamp = Date.parse(headerValue);
  if (Number.isNaN(timestamp)) {
    return null;
  }

  return Math.max(0, timestamp - Date.now());
}

async function streamFallbackText(text, { onToken, signal }) {
  let output = "";
  const chunks = chunkText(text || "", 48);

  for (const chunk of chunks) {
    if (signal?.aborted) {
      throw abortError();
    }
    if (chunk) {
      output += chunk;
      onToken(chunk, output);
    }
    await delay(12, signal);
  }

  return output;
}

function parseSseChunk(chunk) {
  return chunk
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trim())
    .filter(Boolean);
}

function chunkText(text, size) {
  if (!text) {
    return [];
  }

  const chunks = [];
  for (let index = 0; index < text.length; index += size) {
    chunks.push(text.slice(index, index + size));
  }
  return chunks;
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    function onAbort() {
      clearTimeout(timer);
      reject(abortError());
    }

    const timer = setTimeout(() => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
      resolve();
    }, ms);
    timer.unref?.();

    if (!signal) {
      return;
    }

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError() {
  const error = new Error("Generation aborted");
  error.name = "AbortError";
  return error;
}

function timeoutError(message) {
  const error = new Error(message);
  error.name = "TimeoutError";
  return error;
}

function isTimeoutError(error) {
  return error?.name === "TimeoutError";
}

function readPositiveInt(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
