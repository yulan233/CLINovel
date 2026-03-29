import test from "node:test";
import assert from "node:assert/strict";
import stringWidth from "string-width";
import {
  buildFatalTuiDiagnostic,
  buildContextUsageLines,
  buildAnimatedUsageFrame,
  detectRenderProfile,
  buildInputHelp,
  buildInspectorLines,
  buildPlotInspectorLines,
  buildSidebarPanels,
  buildSummaryLines,
  computeInputWidth,
  computeLayoutFrames,
  getSuggestionWindow,
  getTranscriptWindow,
  loadDetailsSnapshot,
  loadPlotSnapshot,
  loadProjectSnapshot,
  hasUsageDelta,
  runEventHandlerSafely,
  toggleInspectorView
} from "../src/lib/tui.js";

test("buildSummaryLines prioritizes focus, task, and latest result", () => {
  const lines = buildSummaryLines({
    cols: 80,
    currentChapterId: "003",
    project: {
      title: "Demo",
      model: "gpt-test",
      llmMode: "remote",
      contextBudget: 12000,
      statuses: [{ chapterId: "003", hasPlan: true, hasDraft: false, summaryStatus: "complete" }],
      stats: { planned: 1, drafted: 0, memoryDone: 1 }
    },
    plotState: { options: [], activeIntent: { title: "Raise the stakes" } },
    lastResult: "Generated chapter plan.",
    activeTask: "chapter-plan",
    taskPhase: "calling_model"
  });

  assert.equal(lines.length, 3);
  assert.match(lines[0], /focus 003/);
  assert.match(lines[0], /plan yes/);
  assert.match(lines[1], /task chapter-plan/);
  assert.match(lines[2], /Generated chapter plan/);
});

test("runEventHandlerSafely catches handler exceptions and forwards them", () => {
  let captured = null;
  const result = runEventHandlerSafely(
    { type: "artifact_written" },
    () => {
      throw new Error("boom");
    },
    (error, event) => {
      captured = { error, event };
    }
  );

  assert.equal(result, false);
  assert.equal(captured.error.message, "boom");
  assert.equal(captured.event.type, "artifact_written");
});

test("buildInspectorLines renders status and artifacts views", () => {
  const project = {
    title: "Demo",
    model: "gpt-test",
    llmMode: "remote",
    contextBudget: 12000,
    statuses: [
      { chapterId: "001", hasPlan: true, hasDraft: true, summaryStatus: "complete" },
      { chapterId: "002", hasPlan: true, hasDraft: false, summaryStatus: "pending" }
    ],
    stats: { planned: 2, drafted: 1, memoryDone: 1 }
  };

  const statusLines = buildInspectorLines({
    cols: 100,
    view: "status",
    currentChapterId: "002",
    project,
    details: { contextPreview: "", memoryPreview: "", contextUsage: { promptSections: [], referenceSections: [] } },
    plotState: { options: [], activeIntent: null },
    lastArtifacts: []
  });
  assert.match(statusLines[0], /title Demo/);
  assert.ok(statusLines.some((line) => line.includes("> 002")));

  const artifactLines = buildInspectorLines({
    cols: 100,
    view: "artifacts",
    currentChapterId: "002",
    project,
    details: { contextPreview: "", memoryPreview: "", contextUsage: { promptSections: [], referenceSections: [] } },
    plotState: { options: [], activeIntent: null },
    lastArtifacts: ["/tmp/demo/chapters/002.plan.md"]
  });
  assert.deepEqual(artifactLines, ["chapters/002.plan.md"]);

  const warningLines = buildInspectorLines({
    cols: 100,
    view: "warnings",
    currentChapterId: "002",
    project,
    details: { warningPreview: "- [warning] 主角状态已更新", contextUsage: { promptSections: [], referenceSections: [] } },
    plotState: { options: [], activeIntent: null },
    lastArtifacts: []
  });
  assert.match(warningLines[0], /主角状态已更新/);
});

test("buildPlotInspectorLines renders short plot ids for quick actions", () => {
  const lines = buildPlotInspectorLines(
    {
      activeIntent: { title: "Raise the stakes", summary: "主角被迫提前暴露底牌。" },
      options: [
        { id: "chapter-1", title: "提前摊牌", status: "suggested", chapterId: "002", scope: "chapter" },
        { id: "chapter-2", title: "先撤再战", status: "kept", chapterId: "002", scope: "chapter" }
      ]
    },
    "002",
    48,
    6,
    {
      items: [
        { index: 0, shortId: "1", optionId: "chapter-1" },
        { index: 1, shortId: "2", optionId: "chapter-2" }
      ],
      selectedIndex: 1
    }
  );

  assert.match(lines[0], /active Raise the stakes/);
  assert.ok(lines.some((line) => line.includes("1. [suggested] 提前摊牌")));
  assert.ok(lines.some((line) => line.includes("> 2. [kept] 先撤再战")));
});

test("computeInputWidth keeps the prompt inside the bordered panel", () => {
  assert.equal(computeInputWidth(120), 114);
  assert.equal(computeInputWidth(40), 34);
  assert.equal(computeInputWidth(10), 8);
});

test("buildInputHelp switches messaging for suggestions and plot quick actions", () => {
  assert.match(buildInputHelp({ visibleSuggestionsCount: 2 }), /Tab 补全命令/);
  assert.match(buildInputHelp({ guideSession: { phase: "question" } }), /引导式大纲模式/);
  assert.match(buildInputHelp({ guideSession: { phase: "confirm" } }), /输入 生成 开始大纲生成/);
  assert.match(buildInputHelp({ plotSession: { items: [{ shortId: "1" }] } }), /Enter\/a 应用/);
  assert.match(buildInputHelp({}), /最近 10 条命令/);
});

test("toggleInspectorView makes Ctrl+O open and close the inspector", () => {
  assert.equal(toggleInspectorView(null), "context");
  assert.equal(toggleInspectorView("context"), null);
  assert.equal(toggleInspectorView("memory"), null);
});

test("computeLayoutFrames stays within the terminal height budget", () => {
  const layout = computeLayoutFrames({ rows: 28, cols: 100, suggestionCount: 6 });
  assert.equal(layout.statusBarHeight + layout.bodyHeight + layout.inputHeight, 28);
  assert.equal(layout.suggestionRows, 4);
});

test("detectRenderProfile enables safe mode for Apple Terminal", () => {
  const profile = detectRenderProfile({ TERM_PROGRAM: "Apple_Terminal" });
  assert.equal(profile.safeMode, true);
  assert.equal(profile.incrementalRendering, false);
  assert.equal(profile.disableSpinner, true);
  assert.equal(profile.asciiBorders, true);
});

test("getSuggestionWindow scrolls slash commands around the active item", () => {
  const suggestions = Array.from({ length: 8 }, (_, index) => ({
    command: `/cmd${index + 1}`,
    preview: `/cmd${index + 1}`,
    description: `item ${index + 1}`
  }));

  const window = getSuggestionWindow(suggestions, 6, 4);

  assert.equal(window.hiddenAbove, 3);
  assert.equal(window.hiddenBelow, 1);
  assert.deepEqual(
    window.items.map((item) => item.index),
    [3, 4, 5, 6]
  );
});

test("buildContextUsageLines summarizes token usage by section", () => {
  const lines = buildContextUsageLines({
    cols: 48,
    details: {
      contextUsage: {
        budget: 12000,
        usedTokens: 3600,
        remainingTokens: 8400,
        usagePercent: 30,
        promptSections: [
          { label: "故事总纲", tokens: 1800, percentOfBudget: 15 },
          { label: "近期记忆", tokens: 900, percentOfBudget: 7.5 }
        ],
        referenceSections: [{ label: "章节记忆摘要", tokens: 420, percentOfBudget: 0 }]
      }
    }
  });

  assert.match(lines[0], /budget 12000/);
  assert.match(lines[1], /故事总纲 1800 tok/);
  assert.match(lines.at(-1), /章节记忆摘要 ref 420 tok/);
});

test("buildContextUsageLines shows refreshing prefix and animated display usage", () => {
  const lines = buildContextUsageLines({
    cols: 56,
    details: {
      isRefreshing: true,
      contextUsage: {
        budget: 12000,
        usedTokens: 3600,
        remainingTokens: 8400,
        usagePercent: 30,
        promptSections: [],
        referenceSections: []
      },
      displayUsage: {
        budget: 12000,
        usedTokens: 2400,
        remainingTokens: 9600,
        usagePercent: 20,
        promptSections: [],
        referenceSections: []
      }
    }
  });

  assert.match(lines[0], /updating/);
  assert.match(lines[0], /used 2400/);
});

test("usage animation helpers detect deltas and interpolate frames", () => {
  const previous = {
    budget: 12000,
    usedTokens: 1000,
    remainingTokens: 11000,
    usagePercent: 8.3,
    promptSections: [],
    referenceSections: []
  };
  const next = {
    budget: 12000,
    usedTokens: 3000,
    remainingTokens: 9000,
    usagePercent: 25,
    promptSections: [],
    referenceSections: []
  };

  assert.equal(hasUsageDelta(previous, next), true);
  assert.equal(hasUsageDelta(next, next), false);

  const frame = buildAnimatedUsageFrame(previous, next, 0.5);
  assert.equal(frame.usedTokens, 2000);
  assert.equal(frame.remainingTokens, 10000);
  assert.equal(frame.usagePercent, 16.6);
});

test("buildSidebarPanels keeps status and usage visible in normal layouts", () => {
  const panels = buildSidebarPanels({
    bodyHeight: 18,
    cols: 40,
    currentChapterId: "002",
    project: {
      title: "Demo",
      model: "gpt-test",
      llmMode: "remote",
      contextBudget: 12000,
      statuses: [{ chapterId: "002", hasPlan: true, hasDraft: false, summaryStatus: "pending" }],
      stats: { planned: 1, drafted: 0, memoryDone: 0 }
    },
    details: {
      contextPreview: "preview",
      memoryPreview: "memory",
      contextUsage: {
        budget: 12000,
        usedTokens: 2000,
        remainingTokens: 10000,
        usagePercent: 16.7,
        promptSections: [{ label: "卷纲", tokens: 1000, percentOfBudget: 8.3 }],
        referenceSections: []
      }
    },
    plotState: { options: [], activeIntent: null },
    lastArtifacts: [],
    inspectorView: "context"
  });

  assert.equal(panels.length, 3);
  assert.equal(panels[0].title, "Status");
  assert.equal(panels[1].title, "Context Usage");
});

test("buildSidebarPanels forwards plot quick session to detail panel", () => {
  const panels = buildSidebarPanels({
    bodyHeight: 18,
    cols: 40,
    currentChapterId: "002",
    project: {
      title: "Demo",
      model: "gpt-test",
      llmMode: "remote",
      contextBudget: 12000,
      statuses: [{ chapterId: "002", hasPlan: true, hasDraft: false, summaryStatus: "pending" }],
      stats: { planned: 1, drafted: 0, memoryDone: 0 }
    },
    details: {
      contextPreview: "preview",
      memoryPreview: "memory",
      contextUsage: { budget: 0, usedTokens: 0, remainingTokens: 0, usagePercent: 0, promptSections: [], referenceSections: [] }
    },
    plotState: {
      options: [{ id: "chapter-1", title: "提前摊牌", status: "suggested", chapterId: "002", scope: "chapter" }],
      activeIntent: null
    },
    lastArtifacts: [],
    inspectorView: "plot",
    plotSession: {
      items: [{ index: 0, shortId: "1", optionId: "chapter-1" }],
      selectedIndex: 0
    }
  });

  assert.ok(panels[2].lines.some((line) => line.includes("1. [suggested] 提前摊牌")));
});

test("getTranscriptWindow returns a scrollable slice of wrapped transcript lines", () => {
  const history = [
    { role: "system", text: "\u001b[31mready\u001b[39m", streaming: false },
    { role: "assistant", text: "abcdefghijklmnopqrstuvwxyz", streaming: false }
  ];

  const latest = getTranscriptWindow(history, 10, 3, 0);
  assert.equal(latest.lines.length, 3);
  assert.equal(latest.hiddenAbove, 2);
  assert.equal(latest.hiddenBelow, 0);
  assert.equal(latest.lines.at(-1).line, "z");

  const older = getTranscriptWindow(history, 10, 3, 2);
  assert.equal(older.hiddenAbove, 0);
  assert.equal(older.hiddenBelow, 2);
  assert.equal(older.lines[0].line, "sys> ready");
});

test("getTranscriptWindow wraps mixed-width CJK text within viewport width", () => {
  const history = [{ role: "assistant", text: "对齐修复abc继续观察", streaming: false }];
  const window = getTranscriptWindow(history, 8, 6, 0);

  assert.ok(window.lines.length > 1);
  for (const item of window.lines) {
    assert.ok(stringWidth(item.line) <= 8);
  }
});

test("getTranscriptWindow trims trailing blank transcript lines", () => {
  const history = [{ role: "assistant", text: "第一段\n\n\n", streaming: false }];
  const window = getTranscriptWindow(history, 12, 6, 0);

  assert.equal(window.totalLines, 1);
  assert.equal(window.lines[0].line, "ai > 第一段");
});

test("loadProjectSnapshot falls back safely when project refresh fails", async () => {
  const { snapshot, error } = await loadProjectSnapshot("/tmp/demo", {
    async loadProjectConfigFn() {
      throw new Error("project exploded");
    }
  });

  assert.equal(snapshot.title, "-");
  assert.equal(snapshot.stats.planned, 0);
  assert.match(error.message, /project exploded/);
});

test("loadDetailsSnapshot returns fallback preview when detail loading fails", async () => {
  const { snapshot, error } = await loadDetailsSnapshot("/tmp/demo", "003", {
    buildContextSectionsFn: async () => {
      throw new Error("detail exploded");
    }
  });

  assert.equal(snapshot.contextPreview, "Context unavailable.");
  assert.equal(snapshot.memoryPreview, "Memory unavailable.");
  assert.match(error.message, /detail exploded/);
});

test("loadPlotSnapshot falls back to empty plot state on errors", async () => {
  const { snapshot, error } = await loadPlotSnapshot("/tmp/demo", {
    async loadPlotStateFn() {
      throw new Error("plot exploded");
    }
  });

  assert.deepEqual(snapshot, { options: [], threads: [], activeThreadIds: [], activeIntent: null });
  assert.match(error.message, /plot exploded/);
});

test("buildFatalTuiDiagnostic includes recent runtime context", () => {
  const output = buildFatalTuiDiagnostic({
    error: new Error("render failed"),
    diagnostics: {
      activeTask: "draft",
      taskPhase: "calling_model",
      currentChapterId: "007",
      lastResult: "Streaming..."
    }
  });

  assert.match(output, /render failed/);
  assert.match(output, /active_task: draft/);
  assert.match(output, /chapter: 007/);
});
