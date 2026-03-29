import process from "node:process";
import readline from "node:readline/promises";
import { safeReadPath, safeWritePath } from "../fs.js";
import { buildGuidedOutlinePrompt, buildOutlinePrompt, buildOutlineRevisionPrompt, extractTaggedSections } from "../prompts.js";
import { loadProjectConfig } from "../project.js";
import { buildFallbackOutline, buildFallbackOutlineRevision } from "../templates.js";
import { buildIntentContext } from "../plot.js";
import { loadEnv } from "../env.js";
import { buildOutlineFallbackStream, emitRuntime, printRuntime, requestGeneratedText, requireNonEmptyText } from "./runtime.js";

export async function handleOutline(action, feedback, runtime) {
  if (action === "revise") {
    return handleOutlineRevise(feedback, runtime);
  }

  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);
  const config = await loadProjectConfig(rootDir);
  const styleText = await safeReadPath(rootDir, "style.md", "");
  const plotIntent = await buildIntentContext(rootDir);
  const requirements = [action, feedback].filter(Boolean).join(" ").trim();
  const prompt = buildOutlinePrompt(config, [styleText, plotIntent].filter(Boolean).join("\n\n"), requirements);
  const fallback = buildFallbackOutline(config, styleText);

  emitRuntime(runtime, "task_started", { task: "outline" });
  emitRuntime(runtime, "phase_changed", { task: "outline", phase: "calling_model" });
  const llmText = await requestGeneratedText("outline", prompt, config, runtime, {
    fallbackText: buildOutlineFallbackStream(fallback)
  });

  emitRuntime(runtime, "phase_changed", { task: "outline", phase: "writing_files" });
  const artifacts = await writeOutlineArtifacts(rootDir, llmText, fallback, runtime, "outline");
  const output = "Generated outline files.";
  emitRuntime(runtime, "task_completed", { task: "outline", output });
  printRuntime(runtime, output);
  return {
    output,
    artifacts
  };
}

export async function handleGuid(runtime) {
  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);
  const config = await loadProjectConfig(rootDir);
  const styleText = await safeReadPath(rootDir, "style.md", "");
  const guideAnswers = runtime.guideAnswers || (await collectGuideAnswersInteractive());
  const prompt = buildGuidedOutlinePrompt(config, guideAnswers, styleText);
  const fallback = buildFallbackOutline(config, styleText);

  emitRuntime(runtime, "task_started", { task: "guid" });
  emitRuntime(runtime, "phase_changed", { task: "guid", phase: "calling_model" });
  const llmText = await requestGeneratedText("guid", prompt, config, runtime, {
    fallbackText: buildOutlineFallbackStream(fallback)
  });

  emitRuntime(runtime, "phase_changed", { task: "guid", phase: "writing_files" });
  const artifacts = await writeOutlineArtifacts(rootDir, llmText, fallback, runtime, "guid");
  const output = "Generated guided outline files.";
  emitRuntime(runtime, "task_completed", { task: "guid", output });
  printRuntime(runtime, output);
  return {
    output,
    artifacts,
    guideAnswers
  };
}

export async function handleOutlineRevise(feedback, runtime) {
  const normalizedFeedback = requireNonEmptyText(feedback, "Usage: ainovel outline revise <feedback>");

  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);
  const config = await loadProjectConfig(rootDir);
  const styleText = await safeReadPath(rootDir, "style.md", "");
  const plotIntent = await buildIntentContext(rootDir);
  const existingStory = await safeReadPath(rootDir, "outline/story.md", "");
  const existingArcs = await safeReadPath(rootDir, "outline/arcs.md", "");
  const existingCharacters = await safeReadPath(rootDir, "characters/roster.md", "");
  const existingWorld = await safeReadPath(rootDir, "world/rules.md", "");
  const currentOutline = [existingStory, existingArcs, existingCharacters, existingWorld].join("\n\n");
  const prompt = buildOutlineRevisionPrompt(currentOutline, normalizedFeedback, [styleText, plotIntent].filter(Boolean).join("\n\n"));

  emitRuntime(runtime, "task_started", { task: "outline-revise" });
  emitRuntime(runtime, "phase_changed", { task: "outline-revise", phase: "calling_model" });
  const llmText = await requestGeneratedText("outline-revise", prompt, config, runtime, {
    fallbackText: currentOutline || normalizedFeedback
  });

  emitRuntime(runtime, "phase_changed", { task: "outline-revise", phase: "writing_files" });
  const sections = extractTaggedSections(llmText || "", ["story", "arcs", "characters", "world"]);
  const writes = [
    ["outline/story.md", sections.story || buildFallbackOutlineRevision(existingStory, normalizedFeedback)],
    ["outline/arcs.md", sections.arcs || buildFallbackOutlineRevision(existingArcs, normalizedFeedback)],
    ["characters/roster.md", sections.characters || buildFallbackOutlineRevision(existingCharacters, normalizedFeedback)],
    ["world/rules.md", sections.world || buildFallbackOutlineRevision(existingWorld, normalizedFeedback)]
  ];
  const artifacts = [];

  for (const [target, content] of writes) {
    const filePath = await safeWritePath(rootDir, target, String(content || "").trim() + "\n");
    emitRuntime(runtime, "artifact_written", { task: "outline-revise", artifact: filePath });
    artifacts.push(filePath);
  }

  const output = "Revised outline files.";
  emitRuntime(runtime, "task_completed", { task: "outline-revise", output });
  printRuntime(runtime, output);
  return {
    output,
    artifacts
  };
}

export async function writeOutlineArtifacts(rootDir, llmText, fallback, runtime, task) {
  const sections = extractTaggedSections(llmText || "", ["story", "arcs", "characters", "world"]);
  const writes = [
    ["outline/story.md", sections.story || fallback.story],
    ["outline/arcs.md", sections.arcs || fallback.arcs],
    ["characters/roster.md", sections.characters || fallback.characters],
    ["world/rules.md", sections.world || fallback.world]
  ];

  const artifacts = [];
  for (const [target, content] of writes) {
    const filePath = await safeWritePath(rootDir, target, String(content || "").trim() + "\n");
    artifacts.push(filePath);
    emitRuntime(runtime, "artifact_written", { task, artifact: filePath });
  }

  return artifacts;
}

export async function collectGuideAnswersInteractive() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Usage: ainovel guid (interactive terminal required)");
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    try {
      return {
        genreAndTone: await rl.question("题材与基调："),
        worldAndRules: await rl.question("世界观与核心规则："),
        protagonistAndSetup: await rl.question("主角与初始处境："),
        goalAndCost: await rl.question("主线目标、阻碍与代价："),
        conflictAndEnding: await rl.question("关键冲突、卖点与结局倾向：")
      };
    } catch (error) {
      throw new Error(`Guided outline input failed: ${error.message}`);
    }
  } finally {
    rl.close();
  }
}
