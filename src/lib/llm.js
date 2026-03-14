const DEFAULT_MODEL = process.env.AINOVEL_MODEL || "fallback-local";
const DEFAULT_BASE_URL = process.env.AINOVEL_BASE_URL || "https://api.openai.com/v1";

export function getLlmConfig(projectConfig = {}) {
  return {
    model: process.env.AINOVEL_MODEL || projectConfig.default_model || DEFAULT_MODEL,
    apiKey: process.env.AINOVEL_API_KEY || "",
    baseUrl: process.env.AINOVEL_BASE_URL || DEFAULT_BASE_URL
  };
}

export function describeLlmMode(projectConfig = {}) {
  const config = getLlmConfig(projectConfig);
  const remoteEnabled = Boolean(config.apiKey) && config.model !== "fallback-local";

  return {
    ...config,
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

  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
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
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${body}`);
  }

  const payload = await response.json();
  const text = payload?.choices?.[0]?.message?.content?.trim();
  if (!text) {
    throw new Error(`LLM returned empty content for task "${task}"`);
  }
  return text;
}

export async function streamText(task, prompt, projectConfig = {}, observer = {}) {
  const config = getLlmConfig(projectConfig);
  const signal = observer.signal;
  const onToken = observer.onToken || (() => {});
  const onComplete = observer.onComplete || (() => {});
  const onStart = observer.onStart || (() => {});

  onStart({
    model: config.model,
    remoteEnabled: Boolean(config.apiKey) && config.model !== "fallback-local"
  });

  if (!config.apiKey || config.model === "fallback-local") {
    const fallback = observer.fallbackText ?? "";
    const streamed = await streamFallbackText(fallback, { onToken, signal });
    onComplete(streamed);
    return streamed;
  }

  const response = await fetch(`${config.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    signal,
    body: JSON.stringify({
      model: config.model,
      temperature: task === "draft" ? 0.9 : 0.5,
      stream: true,
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
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`LLM request failed (${response.status}): ${body}`);
  }

  if (!response.body) {
    throw new Error("LLM response did not include a stream body");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";

  while (true) {
    if (signal?.aborted) {
      throw abortError();
    }

    const { value, done } = await reader.read();
    if (done) {
      break;
    }

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

  if (!text.trim()) {
    throw new Error(`LLM returned empty content for task "${task}"`);
  }

  onComplete(text);
  return text;
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
    await delay(12);
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

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function abortError() {
  const error = new Error("Generation aborted");
  error.name = "AbortError";
  return error;
}
