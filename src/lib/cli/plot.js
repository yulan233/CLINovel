import { loadEnv } from "../env.js";
import {
  changePlotOptionStatus,
  changePlotThreadStatus,
  generatePlotOptions,
  getPlotOptions,
  getPlotThread
} from "../plot.js";
import { emitRuntime, printRuntime, requireChapterId } from "./runtime.js";

export async function handlePlot(action, target, rest, runtime) {
  const rootDir = runtime.rootDir;
  await loadEnv(rootDir);

  if (action === "generate") {
    if (!["chapter", "book"].includes(target)) {
      throw new Error("Usage: ainovel plot generate <chapter|book> [chapter-id]");
    }
    const chapterId = target === "chapter" ? targetChapter(target, rest) : null;
    emitRuntime(runtime, "task_started", { task: "plot-options", scope: target, chapterId });
    emitRuntime(runtime, "plot_options_started", { scope: target, chapterId });
    const result = await generatePlotOptions(rootDir, target, chapterId, runtime);
    emitRuntime(runtime, "plot_options_completed", {
      scope: target,
      chapterId,
      count: result.options.length,
      artifact: result.artifact
    });
    const output = formatPlotOptionsOutput(result.options, result.plotState.activeThreads || [], result.plotState.activeIntent);
    printRuntime(runtime, output);
    return {
      output,
      currentChapterId: chapterId || null,
      plotOptions: result.options,
      artifacts: [result.artifact]
    };
  }

  if (["keep", "drop", "apply"].includes(action)) {
    if (!target) {
      throw new Error(`Usage: ainovel plot ${action} <option-id>`);
    }
    const status = action === "keep" ? "kept" : action === "drop" ? "dropped" : "applied";
    const result = await changePlotOptionStatus(rootDir, target, status);
    emitRuntime(runtime, "plot_option_status_changed", { optionId: target, status, artifact: result.artifact });
    if (status === "applied") {
      emitRuntime(runtime, "plot_option_applied", {
        optionId: target,
        artifact: result.artifact,
        activeIntent: result.plotState.activeIntent
      });
    }
    const output = status === "applied" && result.thread
      ? `Plot option ${target} marked as ${status}. Thread ${result.thread.id} is now active.`
      : `Plot option ${target} marked as ${status}.`;
    printRuntime(runtime, output);
    return {
      output,
      plotState: result.plotState,
      artifacts: [result.artifact]
    };
  }

  if (["resolve", "pause", "resume"].includes(action)) {
    if (!target) {
      throw new Error(`Usage: ainovel plot ${action} <thread-id> [chapter-id]`);
    }
    const nextStatus = action === "resolve" ? "resolved" : action === "pause" ? "paused" : "active";
    const chapterId = firstWord(rest) ? requireChapterId(firstWord(rest), `Usage: ainovel plot ${action} <thread-id> [chapter-id]`) : null;
    const result = await changePlotThreadStatus(rootDir, target, nextStatus, chapterId);
    const output = `Plot thread ${target} marked as ${nextStatus}.`;
    printRuntime(runtime, output);
    return { output, plotState: result.plotState, artifacts: [result.artifact] };
  }

  if (action === "thread") {
    if (!target) {
      throw new Error("Usage: ainovel plot thread <thread-id>");
    }
    const thread = await getPlotThread(rootDir, target);
    if (!thread) {
      throw new Error(`Plot thread not found: ${target}`);
    }
    const output = formatPlotThreadOutput(thread);
    printRuntime(runtime, output);
    return { output, thread };
  }

  if (!action || action === "list") {
    const scope = target === "chapter" || target === "book" ? target : null;
    const chapterId = scope === "chapter" && firstWord(rest)
      ? requireChapterId(firstWord(rest), "Usage: ainovel plot list [chapter <chapter-id>|book]")
      : null;
    const result = await getPlotOptions(rootDir, {
      scope,
      chapterId
    });
    const output = formatPlotOptionsOutput(result.options, result.activeThreads, result.activeIntent, result.threads);
    printRuntime(runtime, output);
    return { output, plotState: result };
  }

  throw new Error("Usage: ainovel plot <generate|list|keep|drop|apply|thread|resolve|pause|resume> ...");
}

function formatPlotOptionsOutput(options, activeThreads = [], activeIntent = null, threads = []) {
  if (!options || options.length === 0) {
    const threadLines = activeThreads.length
      ? activeThreads.map((item) => `- ${item.id} [${item.status}] ${item.title} / ${item.endCondition || "-"}`)
      : threads.length
        ? threads.map((item) => `- ${item.id} [${item.status}] ${item.title}`).slice(0, 6)
        : [];
    return [
      activeIntent ? `Active intent: ${activeIntent.title} - ${activeIntent.summary}` : "Active intent: none",
      activeThreads.length ? "Active threads:" : "Active threads: none",
      ...threadLines
    ].join("\n");
  }

  return [
    activeIntent ? `Active intent: ${activeIntent.title} - ${activeIntent.summary}` : "Active intent: none",
    activeThreads.length ? "Active threads:" : "Active threads: none",
    ...activeThreads.map((item) => `- ${item.id} [${item.status}] ${item.title} / ${item.endCondition || "-"}`),
    ...options.map(
      (item) =>
        `- ${item.id} [${item.status}] ${item.title}\n  ${item.summary.replace(/\n/g, " ")}\n  range: ${formatPlotRange(item)}\n  end: ${item.endCondition || "-"}\n  risk: ${item.risk_or_tradeoff}`
    )
  ].join("\n");
}

function formatPlotThreadOutput(thread) {
  return [
    `# ${thread.title}`,
    `- id: ${thread.id}`,
    `- scope: ${thread.scope}`,
    `- status: ${thread.status}`,
    `- origin: ${thread.originChapterId || "-"}`,
    `- range: ${formatPlotRange(thread)}`,
    `- end_condition: ${thread.endCondition || "-"}`,
    `- tags: ${(thread.tags || []).join(", ") || "-"}`,
    `- related_entities: ${(thread.relatedEntityIds || []).join(", ") || "-"}`,
    "",
    thread.summary || "",
    "",
    "## history",
    ...((thread.history || []).map((item) => `- ${item.at}: ${item.action}${item.chapterId ? ` @ ${item.chapterId}` : ""}`) || ["- none"])
  ].join("\n");
}

function formatPlotRange(item) {
  const range = item.appliesToChapters || {};
  if (item.scope === "book" || range.mode === "all_future") {
    return `${range.start || item.originChapterId || item.chapterId || "-"}+`;
  }
  if (range.mode === "list") {
    return (range.chapters || []).join(",");
  }
  return [range.start || item.originChapterId || item.chapterId || "-", range.end || ""].filter(Boolean).join("-");
}

function targetChapter(target, rest) {
  if (target !== "chapter") {
    return null;
  }
  const value = firstWord(rest);
  if (!value) {
    throw new Error("Usage: ainovel plot generate chapter <chapter-id>");
  }
  return requireChapterId(value, "Usage: ainovel plot generate chapter <chapter-id>");
}

function firstWord(text) {
  return String(text || "").trim().split(/\s+/)[0] || "";
}
