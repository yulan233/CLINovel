import { cleanupAiLeak, containsAiLeak } from "../ai-leak.js";
import { safeReadPath } from "../fs.js";
import { parseFrontmatter } from "../frontmatter.js";
import { describeLlmMode, generateText, streamText } from "../llm.js";
import { buildAssembledContext } from "../memory/context.js";
import { buildIntentContext } from "../plot.js";
import { normalizeDraftOutput } from "../prompts.js";

export function buildRuntime(options = {}) {
  return {
    print: options.print === false ? () => {} : options.print || ((line) => console.log(line)),
    emit: options.emit || (() => {}),
    signal: options.signal,
    stream: Boolean(options.stream),
    interactive: Boolean(options.interactive),
    rootDir: options.rootDir || process.cwd(),
    guideAnswers: options.guideAnswers || null
  };
}

export function emitRuntime(runtime, type, payload = {}) {
  runtime.emit({
    type,
    timestamp: new Date().toISOString(),
    ...payload
  });
}

export function printRuntime(runtime, output) {
  if (!output) {
    return;
  }
  runtime.print(output);
}

export async function requestGeneratedText(task, prompt, config, runtime, options = {}) {
  if (options.stream === false) {
    return (await generateText(task, prompt, config, { signal: runtime.signal })) || options.fallbackText || null;
  }

  if (!runtime.stream) {
    return generateText(task, prompt, config, { signal: runtime.signal });
  }

  return streamText(task, prompt, config, {
    signal: runtime.signal,
    fallbackText: options.fallbackText,
    onToken(chunk, fullText) {
      emitRuntime(runtime, "token", {
        task,
        chunk,
        fullText
      });
    }
  });
}

export async function normalizeDraftWithLeakGuard(task, chapterId, llmText, fallbackDraft, prompt, config, runtime) {
  let normalized = normalizeDraftOutput(chapterId, llmText, fallbackDraft);
  if (!containsAiLeak(normalized.body)) {
    return normalized;
  }

  emitRuntime(runtime, "warning", {
    task,
    chapterId,
    message: "Detected AI meta narration in draft output; retrying once."
  });
  const retryText = await requestGeneratedText(task, `${prompt}\n\n再次提醒：禁止输出任何元叙述、自我说明、思考过程。`, config, runtime, {
    fallbackText: fallbackDraft.body,
    stream: false
  });
  normalized = normalizeDraftOutput(chapterId, retryText, fallbackDraft);
  if (!containsAiLeak(normalized.body)) {
    return normalized;
  }

  emitRuntime(runtime, "warning", {
    task,
    chapterId,
    message: "AI meta narration persisted after retry; applying cleanup."
  });
  return {
    frontmatter: normalized.frontmatter,
    body: cleanupAiLeak(normalized.body) || fallbackDraft.body
  };
}

export function buildOutlineFallbackStream(fallback) {
  return [fallback.story, fallback.arcs, fallback.characters, fallback.world].filter(Boolean).join("\n\n");
}

export async function buildContextWithIntent(rootDir, chapterId) {
  const [assembled, intent] = await Promise.all([
    buildAssembledContext(rootDir, chapterId),
    buildIntentContext(rootDir, chapterId)
  ]);
  const sections = [...assembled.sections];
  if (intent.trim()) {
    sections.push({
      id: "intent",
      heading: "剧情意图",
      label: "剧情意图",
      text: intent.trim(),
      priority: "high",
      included: true,
      compressed: false
    });
  }
  return {
    budget: assembled.budget,
    sections,
    text: sections
      .filter((section) => section.included && section.text)
      .map((section) => `# ${section.heading}\n${section.text}`)
      .join("\n\n")
  };
}

export async function buildRewriteSupplementalContext(rootDir, items) {
  const sections = [];

  for (const item of items.slice(0, 4)) {
    const chapterSlug = String(item.chapterId).padStart(3, "0");
    for (const file of item.files) {
      let raw = "";
      let heading = "";
      if (file === "plan") {
        raw = await safeReadPath(rootDir, `chapters/${chapterSlug}.plan.md`, "");
        heading = `第${chapterSlug}章计划`;
      } else if (file === "draft") {
        raw = await safeReadPath(rootDir, `chapters/${chapterSlug}.draft.md`, "");
        heading = `第${chapterSlug}章正文`;
      } else if (file === "memory") {
        raw = await safeReadPath(rootDir, `memory/chapters/${chapterSlug}.summary.md`, "");
        heading = `第${chapterSlug}章记忆摘要`;
      }

      const text = file === "memory" ? raw.trim() : (raw ? parseFrontmatter(raw).content : "").trim();
      if (!text) {
        continue;
      }

      sections.push(`## ${heading}\n${text}`);
    }
  }

  return sections.join("\n\n");
}

export function requireChapterId(value, usage) {
  const normalized = String(value || "").trim();
  if (!/^\d+$/.test(normalized)) {
    throw new Error(usage || "Chapter id must be numeric.");
  }
  return normalized.padStart(3, "0");
}

export function requireNonEmptyText(value, usage) {
  const normalized = String(value || "").trim();
  if (!normalized) {
    throw new Error(usage || "Input must not be empty.");
  }
  return normalized;
}

export { describeLlmMode };
