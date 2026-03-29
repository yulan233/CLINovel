import process from "node:process";
import React, { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { render, Box, Text, useApp, useInput } from "ink";
import Spinner from "ink-spinner";
import TextInput from "ink-text-input";
import stringWidth from "string-width";
import { readText } from "./fs.js";
import { logError } from "./log.js";
import { getSlashSuggestions, interpretInput, updateInputState } from "./input.js";
import { describeLlmMode } from "./llm.js";
import { buildContextSections } from "./memory/context.js";
import { loadStructuredMemory } from "./memory/search.js";
import { buildIntentContext, loadPlotState } from "./plot.js";
import { loadProjectConfig, getChapterStatuses, resolveProjectPaths } from "./project.js";
import { buildTokenUsage } from "./token.js";
import { navigateCommandHistory, recordCommand } from "./tui/history.js";
import { createPlotSession, getSelectedPlotAction, movePlotSelection, syncPlotSession } from "./tui/plot-session.js";

const h = React.createElement;
const STREAMING_TASKS = new Set([
  "outline",
  "guid",
  "outline-revise",
  "chapter-plan",
  "draft",
  "chapter-revise",
  "chapter-rewrite",
  "plot-options"
]);
const INSPECTOR_VIEWS = ["status", "context", "memory", "plot", "artifacts", "loops", "warnings", "entity"];
const MAX_HISTORY_ITEMS = 80;
const MAX_MESSAGE_CHARS = 6000;
const MAX_SUGGESTION_ROWS = 4;
const PANEL_HORIZONTAL_CHROME = 4;
const INPUT_PROMPT = "> ";
const GUIDE_STEPS = [
  {
    key: "genreAndTone",
    title: "题材与基调",
    prompt: "第 1 步：输入题材、类型、基调，例：东方玄幻+权谋，整体压抑但要有热血反扑。"
  },
  {
    key: "worldAndRules",
    title: "世界观与规则",
    prompt: "第 2 步：输入世界观、力量体系或社会规则，重点写约束、代价、禁忌。"
  },
  {
    key: "protagonistAndSetup",
    title: "主角与处境",
    prompt: "第 3 步：输入主角是谁、现在处于什么局面、最初缺什么。"
  },
  {
    key: "goalAndCost",
    title: "目标与代价",
    prompt: "第 4 步：输入主线目标、阻碍和代价，最好写清楚失败会失去什么。"
  },
  {
    key: "conflictAndEnding",
    title: "冲突与结局倾向",
    prompt: "第 5 步：输入最大卖点、关键冲突、你偏好的结局走向。"
  }
];
const ANSI_ESCAPE_PATTERN = /\u001B(?:\[[0-9;?]*[ -/]*[@-~]|[@-Z\\-_])/g;
const CONTEXT_REFRESH_TASKS = new Set(["chapter-plan", "draft", "chapter-revise", "chapter-rewrite", "plot-options"]);
const DETAILS_POLL_INTERVAL_MS = 400;
const USAGE_ANIMATION_DURATION_MS = 160;
const USAGE_ANIMATION_INTERVAL_MS = 24;

export async function startTui({ runCommand, printHelp }) {
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    throw new Error("TUI requires an interactive terminal.");
  }

  const renderProfile = detectRenderProfile(process.env);
  let fatalState = null;
  let lastDiagnostics = null;
  let instance;
  instance = render(
    h(TuiErrorBoundary, {
      onFatalError(error, diagnostics) {
        fatalState = {
          error,
          diagnostics: diagnostics || lastDiagnostics
        };
        instance?.unmount();
      }
    },
    h(TuiApp, {
      runCommand,
      renderProfile,
      helpText: typeof printHelp === "function" ? printHelp() : "",
      onStateChange(diagnostics) {
        lastDiagnostics = diagnostics;
      }
    })),
    {
      exitOnCtrlC: false,
      patchConsole: false,
      incrementalRendering: renderProfile.incrementalRendering
    }
  );

  await instance.waitUntilExit();
  if (fatalState) {
    const diagnostic = buildFatalTuiDiagnostic(fatalState);
    console.error(diagnostic);
    const error = new Error(diagnostic);
    error.cause = fatalState.error;
    const logFile = logError(error, {
      type: "tui_fatal_error",
      context: {
        diagnostics: fatalState.diagnostics || null
      }
    });
    if (logFile) {
      console.error(`Log written to ${logFile}`);
    }
    throw error;
  }
}

function TuiApp({ runCommand, renderProfile, helpText, onStateChange }) {
  const { exit } = useApp();
  const [input, setInput] = useState("");
  const [inputVersion, setInputVersion] = useState(0);
  const [history, setHistory] = useState([
    {
      role: "system",
      text: buildWelcomeMessage(renderProfile),
      streaming: false
    }
  ]);
  const [uiState, dispatchUi] = useReducer(tuiStateReducer, undefined, createInitialTuiState);
  const {
    currentChapterId,
    activeTask,
    taskPhase,
    lastResult,
    lastArtifacts,
    project,
    details,
    displayUsage,
    detailsRefreshing,
    plotState,
    inspectorView,
    selectedEntity,
    plotSession,
    guideSession,
    transcriptScroll
  } = uiState;
  const setCurrentChapterId = createUiSetter(dispatchUi, "currentChapterId");
  const setActiveTask = createUiSetter(dispatchUi, "activeTask");
  const setTaskPhase = createUiSetter(dispatchUi, "taskPhase");
  const setLastResult = createUiSetter(dispatchUi, "lastResult");
  const setLastArtifacts = createUiSetter(dispatchUi, "lastArtifacts");
  const setProject = createUiSetter(dispatchUi, "project");
  const setDetails = createUiSetter(dispatchUi, "details");
  const setDisplayUsage = createUiSetter(dispatchUi, "displayUsage");
  const setDetailsRefreshing = createUiSetter(dispatchUi, "detailsRefreshing");
  const setPlotState = createUiSetter(dispatchUi, "plotState");
  const setInspectorView = createUiSetter(dispatchUi, "inspectorView");
  const setSelectedEntity = createUiSetter(dispatchUi, "selectedEntity");
  const [lastCommand, setLastCommand] = useState(null);
  const [suggestionIndex, setSuggestionIndex] = useState(0);
  const [commandHistory, setCommandHistory] = useState([]);
  const [historyCursor, setHistoryCursor] = useState(null);
  const [draftInput, setDraftInput] = useState("");
  const setTranscriptScroll = createUiSetter(dispatchUi, "transcriptScroll");
  const setPlotSession = createUiSetter(dispatchUi, "plotSession");
  const setGuideSession = createUiSetter(dispatchUi, "guideSession");
  const abortRef = useRef(null);
  const usageAnimationRef = useRef({ timer: null });
  const displayUsageRef = useRef(emptyUsage());
  const detailsRefreshRef = useRef({
    running: false,
    pendingChapterId: null,
    requestId: 0
  });
  const latestStateRef = useRef({
    currentChapterId: null,
    activeTask: null,
    taskPhase: "idle",
    lastResult: "Ready."
  });
  const softErrorRef = useRef(new Map());

  const visibleSuggestions = useMemo(() => {
    if (!input.trim().startsWith("/")) {
      return [];
    }
    return getSlashSuggestions(input, { currentChapterId });
  }, [input, currentChapterId]);

  useEffect(() => {
    latestStateRef.current = {
      currentChapterId,
      activeTask,
      taskPhase,
      lastResult
    };
    onStateChange?.(latestStateRef.current);
  }, [activeTask, currentChapterId, lastResult, taskPhase]);

  useEffect(() => {
    void refreshProject();
    void refreshPlotState();
  }, []);

  useEffect(() => {
    void scheduleDetailsRefresh(currentChapterId, "chapter-change");
  }, [currentChapterId]);

  useEffect(() => {
    if (suggestionIndex >= visibleSuggestions.length) {
      setSuggestionIndex(0);
    }
  }, [suggestionIndex, visibleSuggestions.length]);

  useEffect(() => {
    setPlotSession((current) => syncPlotSession(current, plotState));
  }, [plotState]);

  useEffect(() => {
    if (!activeTask || !CONTEXT_REFRESH_TASKS.has(activeTask)) {
      return undefined;
    }

    const timer = setInterval(() => {
      void scheduleDetailsRefresh(latestStateRef.current.currentChapterId, `poll:${activeTask}`);
    }, DETAILS_POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [activeTask]);

  useEffect(
    () => () => {
      if (usageAnimationRef.current.timer) {
        clearInterval(usageAnimationRef.current.timer);
      }
    },
    []
  );

  useInput((value, key) => {
    if (key.ctrl && value === "c") {
      if (abortRef.current) {
        abortRef.current.abort();
        pushMessage("event", "Stopped current generation.");
      } else {
        exit();
      }
      return;
    }

    if (key.ctrl && value === "o") {
      setInspectorView(toggleInspectorView);
      return;
    }

    if (key.escape) {
      if (visibleSuggestions.length > 0) {
        updateInputValue("");
        return;
      }
      if (guideSession) {
        setGuideSession(null);
        pushMessage("event", "Guided outline canceled.");
        setLastResult("Guided outline canceled.");
        return;
      }
      if (plotSession) {
        setPlotSession(null);
      }
      setInspectorView(null);
      return;
    }

    if (key.pageUp) {
      setTranscriptScroll((current) => current + 1);
      return;
    }

    if (key.pageDown) {
      setTranscriptScroll((current) => Math.max(0, current - 1));
      return;
    }

    if (key.tab && visibleSuggestions.length > 0) {
      updateInputValue(visibleSuggestions[suggestionIndex].preview, { resetCursor: true });
      return;
    }

    if (key.upArrow && visibleSuggestions.length > 0) {
      setSuggestionIndex((current) => (current === 0 ? visibleSuggestions.length - 1 : current - 1));
      return;
    }

    if (key.downArrow && visibleSuggestions.length > 0) {
      setSuggestionIndex((current) => (current + 1) % visibleSuggestions.length);
      return;
    }

    if (plotSession && !input.trim()) {
      if (key.upArrow) {
        setPlotSession((current) => movePlotSelection(current, -1));
        return;
      }

      if (key.downArrow) {
        setPlotSession((current) => movePlotSelection(current, 1));
        return;
      }

      if (/^\d$/.test(value)) {
        setPlotSession((current) => {
          if (!current?.items?.length) {
            return current;
          }
          const index = Number(value) - 1;
          if (index < 0 || index >= current.items.length) {
            return current;
          }
          return {
            ...current,
            selectedIndex: index
          };
        });
        return;
      }

      if (key.return || value === "a") {
        void handlePlotQuickAction("apply");
        return;
      }

      if (value === "k") {
        void handlePlotQuickAction("keep");
        return;
      }

      if (value === "d") {
        void handlePlotQuickAction("drop");
        return;
      }
    }

    if (key.upArrow) {
      navigateHistory("up");
      return;
    }

    if (key.downArrow) {
      navigateHistory("down");
      return;
    }

    if ((key.leftArrow || key.rightArrow) && inspectorView) {
      setInspectorView((current) => cycleInspectorView(current, key.rightArrow ? 1 : -1));
    }
  });

  async function refreshProject() {
    const { snapshot, error } = await loadProjectSnapshot(process.cwd());
    setProject(snapshot);
    if (!currentChapterId && snapshot.statuses.length > 0) {
      setCurrentChapterId(snapshot.statuses[snapshot.statuses.length - 1].chapterId);
    }
    reportSoftError("project", error, "Project status unavailable.");
  }

  async function refreshDetails(chapterId) {
    const { snapshot, error } = await loadDetailsSnapshot(process.cwd(), chapterId);
    return { snapshot, error };
  }

  async function scheduleDetailsRefresh(chapterId, reason = "manual") {
    const targetChapterId = chapterId || latestStateRef.current.currentChapterId;
    if (!targetChapterId) {
      const empty = emptyDetailsSnapshot();
      setDetails(empty);
      syncDisplayUsage(empty.contextUsage);
      return empty;
    }

    const state = detailsRefreshRef.current;
    state.pendingChapterId = targetChapterId;
    if (state.running) {
      return null;
    }

    state.running = true;
    setDetailsRefreshing(true);
    try {
      while (state.pendingChapterId) {
        const nextChapterId = state.pendingChapterId;
        state.pendingChapterId = null;
        const requestId = ++state.requestId;
        const { snapshot, error } = await refreshDetails(nextChapterId);
        if (requestId === state.requestId && nextChapterId === (latestStateRef.current.currentChapterId || nextChapterId)) {
          setDetails(snapshot);
          syncDisplayUsage(snapshot.contextUsage);
        }
        reportSoftError("details", error, "Context or memory details unavailable.");
      }
    } finally {
      state.running = false;
      setDetailsRefreshing(false);
    }

    return reason;
  }

  function syncDisplayUsage(nextUsage) {
    const targetUsage = nextUsage || emptyUsage();
    const currentUsage = displayUsageRef.current || emptyUsage();
    if (usageAnimationRef.current.timer) {
      clearInterval(usageAnimationRef.current.timer);
      usageAnimationRef.current.timer = null;
    }

    if (!hasUsageDelta(currentUsage, targetUsage)) {
      displayUsageRef.current = targetUsage;
      setDisplayUsage(targetUsage);
      return;
    }

    const startedAt = Date.now();
    const tick = () => {
      const progress = Math.min(1, (Date.now() - startedAt) / USAGE_ANIMATION_DURATION_MS);
      const frame = buildAnimatedUsageFrame(currentUsage, targetUsage, progress);
      displayUsageRef.current = frame;
      setDisplayUsage(frame);
      if (progress >= 1 && usageAnimationRef.current.timer) {
        clearInterval(usageAnimationRef.current.timer);
        usageAnimationRef.current.timer = null;
      }
    };

    tick();
    usageAnimationRef.current.timer = setInterval(tick, USAGE_ANIMATION_INTERVAL_MS);
  }

  async function refreshPlotState() {
    const { snapshot, error } = await loadPlotSnapshot(process.cwd());
    setPlotState(snapshot);
    reportSoftError("plot", error, "Plot state unavailable.");
  }

  async function handlePlotQuickAction(action) {
    const selected = getSelectedPlotAction(plotSession, plotState);
    if (!selected || activeTask) {
      return;
    }

    pushMessage("user", `/plot ${action} ${selected.shortId}`);
    setLastArtifacts([]);
    setActiveTask("plot");
    setTaskPhase(`quick-${action}`);

    try {
      const result = await runCommand(["plot", action, selected.optionId], {
        print: false,
        stream: false,
        interactive: true
      });
      if (result?.plotState) {
        setPlotState(result.plotState);
      }
      if (result?.output) {
        pushMessage("assistant", result.output);
        setLastResult(result.output);
      }
      setInspectorView("plot");
    } catch (error) {
      pushMessage("system", `Error: ${error.message}`);
      setLastResult(`Error: ${error.message}`);
    } finally {
      setActiveTask(null);
      setTaskPhase("idle");
      await refreshPlotState();
    }
  }

  function navigateHistory(direction) {
    const next = navigateCommandHistory({
      history: commandHistory,
      cursor: historyCursor,
      draftInput,
      currentInput: input,
      direction
    });

    if (!next.changed) {
      return;
    }

    setHistoryCursor(next.cursor);
    setDraftInput(next.draftInput);
    updateInputValue(next.input, { resetCursor: true, preserveHistoryState: true });
  }

  async function submitInput(value) {
    const raw = value.trim();
    let streamed = false;
    let effectiveRaw = raw;
    if (!raw) {
      return;
    }

    if (raw === "/exit" || raw === "exit" || raw === "quit") {
      exit();
      return;
    }

    if (raw === "/help") {
      pushMessage("system", helpText);
      updateInputValue("");
      return;
    }

    if (guideSession) {
      await handleGuideInput(raw);
      updateInputValue("");
      return;
    }

    try {
      setCommandHistory((current) => recordCommand(current, raw));
      setHistoryCursor(null);
      setDraftInput("");
      let argv = interpretInput(raw, { currentChapterId });

      if (argv[0] === "retry") {
        if (!lastCommand) {
          pushMessage("system", "No previous command to retry.");
          updateInputValue("");
          return;
        }
        argv = [...lastCommand];
        effectiveRaw = `retry ${argv.join(" ")}`;
        pushMessage("event", `Retrying ${argv.join(" ")}.`);
      }

      if (argv[0] === "continue") {
        if (!lastCommand || !["outline", "chapter"].includes(lastCommand[0])) {
          pushMessage("system", "No previous generation task to continue.");
          updateInputValue("");
          return;
        }
        argv = [...lastCommand];
        effectiveRaw = `continue ${argv.join(" ")}`;
        pushMessage("event", `Continuing ${argv.join(" ")}.`);
      }

      if (argv[0] === "focus") {
        if (!argv[1]) {
          pushMessage("system", "Usage: /focus <chapter-id>");
        } else if (argv[1] === "next" || argv[1] === "prev") {
          const chapterId = stepChapter(project.statuses, currentChapterId, argv[1] === "next" ? 1 : -1);
          if (!chapterId) {
            pushMessage("system", "No chapter available.");
          } else {
            setCurrentChapterId(chapterId);
            pushMessage("event", `Focused chapter ${chapterId}.`);
          }
        } else {
          const chapterId = String(argv[1]).padStart(3, "0");
          setCurrentChapterId(chapterId);
          pushMessage("event", `Focused chapter ${chapterId}.`);
        }
        updateInputValue("");
        return;
      }

      if (argv[0] === "guid") {
        pushMessage("user", effectiveRaw);
        setGuideSession(createGuideSession());
        setLastResult("Guided outline started.");
        pushMessage("assistant", buildGuideQuestion(0));
        updateInputValue("");
        return;
      }

      if (argv[0] === "init" && argv[1]) {
        pushMessage("system", "TUI 中的 /init 只支持当前目录；请先切到目标目录再执行 /init。");
        updateInputValue("");
        return;
      }

      if (argv[0] === "stop") {
        if (abortRef.current) {
          abortRef.current.abort();
          pushMessage("event", "Stopped current generation.");
        }
        updateInputValue("");
        return;
      }

      if (argv[0] === "inspect") {
        if (!argv[1]) {
          pushMessage("system", "Usage: /inspect <status|context|memory|plot|artifacts|loops|warnings|entity>");
        } else {
          setInspectorView(argv[1]);
          pushMessage("event", `Detail panel: ${argv[1]}.`);
        }
        updateInputValue("");
        return;
      }

      if (argv[0] === "close") {
        setInspectorView(null);
        pushMessage("event", "Detail panel closed.");
        updateInputValue("");
        return;
      }

      if (argv[0] === "memory" && argv[1] === "entity") {
        pushMessage("user", effectiveRaw);
        updateInputValue("");
        const result = await runCommand(argv, {
          print: false,
          stream: false,
          interactive: true
        });
        setSelectedEntity(result.entity || null);
        setInspectorView("entity");
        setLastResult(result?.output || "Entity loaded.");
        if (result?.output) {
          pushMessage("assistant", result.output);
        }
        return;
      }

      pushMessage("user", effectiveRaw);
      updateInputValue("");
      setLastArtifacts([]);
      setActiveTask("running");
      setTaskPhase("queued");
      const abortController = new AbortController();
      abortRef.current = abortController;

      const result = await runCommand(argv, {
        print: false,
        stream: true,
        interactive: true,
        signal: abortController.signal,
        emit(event) {
          handleEvent(event);
        }
      });

      if (!streamed && result?.output) {
        pushMessage("assistant", result.output);
      }

      if (result) {
        if (!["retry", "continue"].includes(argv[0])) {
          setLastCommand(argv);
        }
        const next = { currentChapterId };
        updateInputState(next, argv, result);
        if (next.currentChapterId) {
          setCurrentChapterId(next.currentChapterId);
        }
        if (result.plotOptions?.length) {
          setPlotSession(createPlotSession(result.plotOptions));
          setInspectorView("plot");
        }
        if (result.plotState) {
          setPlotState(result.plotState);
        }
      }

      setLastResult(result?.output || "Done.");
    } catch (error) {
      if (error.name === "AbortError" || error.message === "Generation aborted") {
        pushMessage("system", "Generation aborted.");
        setLastResult("Generation aborted.");
      } else {
        pushMessage("system", `Error: ${error.message}`);
        setLastResult(`Error: ${error.message}`);
      }
    } finally {
      abortRef.current = null;
      setActiveTask(null);
      setTaskPhase("idle");
      await refreshProject();
      await scheduleDetailsRefresh(latestStateRef.current.currentChapterId, "task-finally");
      await refreshPlotState();
    }

    function handleEvent(event) {
      runEventHandlerSafely(
        event,
        () => {
          switch (event.type) {
            case "task_started":
              setActiveTask(event.task || "running");
              setTaskPhase("started");
              pushMessage("event", formatTaskStarted(event.task));
              if (STREAMING_TASKS.has(event.task)) {
                streamed = true;
                pushMessage("assistant", "", { streaming: true });
              }
              break;
            case "phase_changed":
              setTaskPhase(event.phase);
              break;
            case "token":
              appendStreamingChunk(event.chunk || "");
              break;
            case "plot_option_generated":
              appendStreamingChunk(event.chunk || "");
              break;
            case "artifact_written":
              setLastArtifacts((current) => [...current, event.artifact].slice(-6));
              pushMessage("event", `Saved ${trimPath(event.artifact)}.`);
              if (/(chapters\/.+\.(plan|draft)\.md|memory\/)/.test(String(event.artifact || ""))) {
                void scheduleDetailsRefresh(latestStateRef.current.currentChapterId, "artifact-written");
              }
              break;
            case "memory_updated":
              pushMessage("event", "Memory updated.");
              void scheduleDetailsRefresh(event.chapterId || latestStateRef.current.currentChapterId, "memory-updated");
              break;
            case "plot_options_completed":
              pushMessage("event", "Plot options generated.");
              setInspectorView("plot");
              break;
            case "plot_option_status_changed":
              pushMessage("event", `Plot option updated: ${event.status}.`);
              void scheduleDetailsRefresh(latestStateRef.current.currentChapterId, "plot-status");
              break;
            case "plot_option_applied":
              pushMessage("event", `Active plot intent updated: ${event.activeIntent?.title || event.optionId}.`);
              void scheduleDetailsRefresh(latestStateRef.current.currentChapterId, "plot-applied");
              break;
            case "task_completed":
              setLastResult(event.output || "Done.");
              pushMessage("result", event.output || "Done.");
              break;
            default:
              break;
          }
        },
        (error, failedEvent) => {
          reportSoftError("runtime-event", error, `Runtime event handling failed: ${failedEvent?.type || "unknown"}.`);
        }
      );
    }
  }

  async function handleGuideInput(raw) {
    if (!raw) {
      pushMessage("system", "请输入当前步骤的内容；也可以输入 `跳过`、`/skip`、`取消` 或 `/cancel`。");
      return;
    }

    pushMessage("user", raw);

    if (raw === "/cancel" || raw === "取消") {
      setGuideSession(null);
      pushMessage("event", "Guided outline canceled.");
      setLastResult("Guided outline canceled.");
      return;
    }

    if (guideSession.phase === "confirm") {
      if (raw === "/back" || raw === "返回" || raw === "上一步") {
        const previousIndex = GUIDE_STEPS.length - 1;
        setGuideSession({
          ...guideSession,
          phase: "question",
          stepIndex: previousIndex
        });
        pushMessage("assistant", buildGuideQuestion(previousIndex, guideSession.answers));
        return;
      }

      if (["生成", "继续", "确认", "/generate", "/continue"].includes(raw)) {
        await runGuidedGeneration(guideSession.answers);
        return;
      }

      pushMessage("system", "输入 `生成` 开始生成大纲，输入 `/back` 返回上一题，或输入 `/cancel` 取消。");
      return;
    }

    const step = GUIDE_STEPS[guideSession.stepIndex];
    const nextAnswers = {
      ...guideSession.answers,
      [step.key]: raw === "/skip" || raw === "跳过" ? "" : raw
    };

    if (guideSession.stepIndex + 1 >= GUIDE_STEPS.length) {
      setGuideSession({
        stepIndex: guideSession.stepIndex,
        phase: "confirm",
        answers: nextAnswers
      });
      pushMessage("assistant", buildGuideConfirmation(nextAnswers));
      setLastResult("Guided outline answers collected.");
      return;
    }

    const nextIndex = guideSession.stepIndex + 1;
    setGuideSession({
      stepIndex: nextIndex,
      phase: "question",
      answers: nextAnswers
    });
    pushMessage("assistant", buildGuideQuestion(nextIndex, nextAnswers));
  }

  async function runGuidedGeneration(answers) {
    pushMessage("event", "Generating outline from guided answers.");
    setLastArtifacts([]);
    setActiveTask("running");
    setTaskPhase("queued");
    const abortController = new AbortController();
    abortRef.current = abortController;
    let streamed = false;

    try {
      const result = await runCommand(["guid"], {
        print: false,
        stream: true,
        interactive: true,
        signal: abortController.signal,
        guideAnswers: answers,
        emit(event) {
          handleEvent(event);
          if (event.type === "task_started" && STREAMING_TASKS.has(event.task)) {
            streamed = true;
          }
        }
      });

      if (!streamed && result?.output) {
        pushMessage("assistant", result.output);
      }

      setGuideSession(null);
      setLastCommand(["guid"]);
      setLastResult(result?.output || "Done.");
    } catch (error) {
      if (error.name === "AbortError" || error.message === "Generation aborted") {
        pushMessage("system", "Generation aborted.");
        setLastResult("Generation aborted.");
      } else {
        pushMessage("system", `Error: ${error.message}`);
        setLastResult(`Error: ${error.message}`);
      }
    } finally {
      abortRef.current = null;
      setActiveTask(null);
      setTaskPhase("idle");
      await refreshProject();
      await scheduleDetailsRefresh(latestStateRef.current.currentChapterId, "guided-task-finally");
      await refreshPlotState();
    }

    function handleEvent(event) {
      runEventHandlerSafely(
        event,
        () => {
          switch (event.type) {
            case "task_started":
              setActiveTask(event.task || "running");
              setTaskPhase("started");
              pushMessage("event", formatTaskStarted(event.task));
              if (STREAMING_TASKS.has(event.task)) {
                pushMessage("assistant", "", { streaming: true });
              }
              break;
            case "phase_changed":
              setTaskPhase(event.phase);
              break;
            case "token":
            case "plot_option_generated":
              appendStreamingChunk(event.chunk || "");
              break;
            case "artifact_written":
              setLastArtifacts((current) => [...current, event.artifact].slice(-6));
              pushMessage("event", `Saved ${trimPath(event.artifact)}.`);
              break;
            case "task_completed":
              setLastResult(event.output || "Done.");
              pushMessage("result", event.output || "Done.");
              break;
            default:
              break;
          }
        },
        (error, failedEvent) => {
          reportSoftError("guided-runtime-event", error, `Runtime event handling failed: ${failedEvent?.type || "unknown"}.`);
        }
      );
    }
  }

  function pushMessage(role, text, options = {}) {
    setHistory((current) => [...current, createHistoryItem(role, text, options)].slice(-MAX_HISTORY_ITEMS));
    setTranscriptScroll((current) => (current === 0 ? 0 : current));
  }

  function reportSoftError(scope, error, fallbackMessage) {
    if (!error) {
      softErrorRef.current.delete(scope);
      return;
    }

    const message = `${scope}:${error.message || fallbackMessage}`;
    if (softErrorRef.current.get(scope) === message) {
      return;
    }
    softErrorRef.current.set(scope, message);
    logError(error, {
      type: "tui_soft_error",
      context: {
        scope,
        fallbackMessage
      }
    });
    pushMessage("system", `Error: ${error.message || fallbackMessage}`);
    setLastResult(error.message || fallbackMessage);
  }

  function appendStreamingChunk(chunk) {
    if (!chunk) {
      return;
    }
    setHistory((current) => {
      const copy = [...current];
      const last = copy[copy.length - 1];
      if (!last || last.role !== "assistant" || !last.streaming) {
        copy.push(createHistoryItem("assistant", chunk, { streaming: true }));
      } else {
        copy[copy.length - 1] = {
          ...last,
          ...clampMessageText(`${last.text}${chunk}`)
        };
      }
      return copy.slice(-MAX_HISTORY_ITEMS);
    });
    setTranscriptScroll((current) => (current === 0 ? 0 : current));
  }

  return h(MainLayout, {
    renderProfile,
    input,
    inputVersion,
    onInputChange: handleInputChange,
    onSubmit: submitInput,
    visibleSuggestions,
    suggestionIndex,
    history,
    activeTask,
    taskPhase,
    lastResult,
    lastArtifacts,
    currentChapterId,
    project,
    details: {
      ...details,
      displayUsage,
      isRefreshing: detailsRefreshing
    },
    plotState,
    inspectorView,
    transcriptScroll,
    selectedEntity,
    plotSession,
    guideSession
  });

  function handleInputChange(nextValue) {
    setInput(nextValue);
    if (historyCursor !== null) {
      setHistoryCursor(null);
      setDraftInput("");
    }
  }

  function updateInputValue(nextValue, options = {}) {
    setInput(nextValue);
    if (options.resetCursor) {
      setInputVersion((current) => current + 1);
    }
    if (!options.preserveHistoryState) {
      setHistoryCursor(null);
      setDraftInput("");
    }
  }
}

function createInitialTuiState() {
  return {
    currentChapterId: null,
    activeTask: null,
    taskPhase: "idle",
    lastResult: "Ready.",
    lastArtifacts: [],
    project: emptyProjectSnapshot(),
    details: emptyDetailsSnapshot(),
    displayUsage: emptyUsage(),
    detailsRefreshing: false,
    plotState: { options: [], threads: [], activeThreadIds: [], activeIntent: null },
    inspectorView: null,
    selectedEntity: null,
    transcriptScroll: 0,
    plotSession: null,
    guideSession: null
  };
}

function tuiStateReducer(state, action) {
  if (action.type !== "set") {
    return state;
  }

  const nextValue = typeof action.updater === "function" ? action.updater(state[action.key]) : action.updater;
  if (state[action.key] === nextValue) {
    return state;
  }

  return {
    ...state,
    [action.key]: nextValue
  };
}

function createUiSetter(dispatch, key) {
  return (updater) => {
    dispatch({
      type: "set",
      key,
      updater
    });
  };
}

class TuiErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error) {
    this.props.onFatalError?.(error, null);
  }

  render() {
    if (this.state.error) {
      return h(
        Box,
        { borderStyle: "classic", borderColor: "red", paddingX: 1, flexDirection: "column" },
        h(Text, { color: "redBright", bold: true }, "AINOVEL TUI encountered a fatal error."),
        h(Text, { color: "gray" }, singleLine(this.state.error.message || "Unknown fatal error."))
      );
    }
    return this.props.children;
  }
}

export function runEventHandlerSafely(event, handler, onError = () => {}) {
  try {
    handler(event);
    return true;
  } catch (error) {
    onError(error, event);
    return false;
  }
}

export async function loadProjectSnapshot(
  rootDir,
  { loadProjectConfigFn = loadProjectConfig, getChapterStatusesFn = getChapterStatuses } = {}
) {
  try {
    const [config, statuses] = await Promise.all([loadProjectConfigFn(rootDir), getChapterStatusesFn(rootDir)]);
    const llm = describeLlmMode(config);
    return {
      snapshot: {
        title: config.title || "-",
        model: llm.model,
        llmMode: llm.remoteEnabled ? "remote" : "fallback-local",
        contextBudget: parseBudget(config.context_budget),
        statuses,
        stats: {
          planned: statuses.filter((item) => item.hasPlan).length,
          drafted: statuses.filter((item) => item.hasDraft).length,
          memoryDone: statuses.filter((item) => item.summaryStatus === "complete").length
        }
      },
      error: null
    };
  } catch (error) {
    return {
      snapshot: emptyProjectSnapshot(),
      error
    };
  }
}

export async function loadDetailsSnapshot(
  rootDir,
  chapterId,
  {
    buildContextSectionsFn = buildContextSections,
    buildIntentContextFn = buildIntentContext,
    loadStructuredMemoryFn = loadStructuredMemory,
    readTextFn = readText,
    loadProjectConfigFn = loadProjectConfig,
    resolveProjectPathsFn = resolveProjectPaths
  } = {}
) {
  if (!chapterId) {
    return {
      snapshot: emptyDetailsSnapshot(),
      error: null
    };
  }

  try {
    const paths = resolveProjectPathsFn(rootDir);
    const [contextSections, intent, memory, structured, config] = await Promise.all([
      buildContextSectionsFn(rootDir, chapterId),
      buildIntentContextFn(rootDir, chapterId),
      readTextFn(`${paths.memoryChaptersDir}/${chapterId}.summary.md`, ""),
      loadStructuredMemoryFn(rootDir),
      loadProjectConfigFn(rootDir)
    ]);
    const llm = describeLlmMode(config);
    const promptSections = contextSections
      .filter((section) => section.text)
      .map((section) => ({
        ...section,
        group: "prompt"
      }));

    if (intent.trim()) {
      promptSections.push({
        id: "intent",
        heading: "剧情意图",
        label: "剧情意图",
        text: intent.trim(),
        group: "prompt"
      });
    }

    const usage = buildTokenUsage(
      [
        ...promptSections,
        {
          id: "chapter_memory",
          heading: "章节记忆摘要",
          label: "章节记忆摘要",
          text: memory.trim(),
          group: "reference"
        }
      ],
      parseBudget(config.context_budget),
      llm.model
    );

    return {
      snapshot: {
        contextSections: promptSections,
        contextPreview: trimPreview(renderSectionsMarkdown(promptSections), 2800),
        memoryPreview: buildMemoryPreview(memory),
        loopPreview: buildLoopPreview(structured.openLoops),
        warningPreview: buildWarningPreview(structured.continuityWarnings),
        contextUsage: usage
      },
      error: null
    };
  } catch (error) {
    return {
      snapshot: {
        ...emptyDetailsSnapshot(),
        contextPreview: "Context unavailable.",
        memoryPreview: "Memory unavailable.",
        loopPreview: "Loops unavailable.",
        warningPreview: "Warnings unavailable."
      },
      error
    };
  }
}

export async function loadPlotSnapshot(rootDir, { loadPlotStateFn = loadPlotState } = {}) {
  try {
    return {
      snapshot: await loadPlotStateFn(rootDir),
      error: null
    };
  } catch (error) {
    return {
      snapshot: { options: [], threads: [], activeThreadIds: [], activeIntent: null },
      error
    };
  }
}

function MainLayout(props) {
  const {
    renderProfile,
    input,
    inputVersion,
    onInputChange,
    onSubmit,
    visibleSuggestions,
    suggestionIndex,
    history,
    activeTask,
    taskPhase,
    lastResult,
    lastArtifacts,
    currentChapterId,
    project,
    details,
    plotState,
    inspectorView,
    transcriptScroll,
    selectedEntity,
    plotSession,
    guideSession
  } = props;

  const cols = process.stdout.columns || 120;
  const rows = process.stdout.rows || 40;
  const layout = computeLayoutFrames({ rows, cols, suggestionCount: visibleSuggestions.length });
  const leftWidth = cols - layout.sidebarWidth;
  const transcriptContentWidth = getPanelContentWidth(leftWidth);
  const transcriptViewportHeight = Math.max(1, layout.bodyHeight - 2);
  const transcriptWindow = getTranscriptWindow(history, transcriptContentWidth, transcriptViewportHeight, transcriptScroll);
  const transcriptHeader = `Transcript ${transcriptWindow.hiddenAbove > 0 ? `↑${transcriptWindow.hiddenAbove} ` : ""}${transcriptWindow.hiddenBelow > 0 ? `↓${transcriptWindow.hiddenBelow}` : ""}`.trim();
  const summaryLines = buildSummaryLines({ cols, currentChapterId, project, plotState, lastResult, activeTask, taskPhase });
  const sidebarPanels = buildSidebarPanels({
    bodyHeight: layout.bodyHeight,
    cols: layout.sidebarWidth,
    currentChapterId,
    project,
    details,
    plotState,
    lastArtifacts,
    inspectorView,
    selectedEntity,
    plotSession
  });
  const suggestionWindow = getSuggestionWindow(visibleSuggestions, suggestionIndex, layout.suggestionRows);
  const visibleSuggestionsList = suggestionWindow.items;

  return h(
    Box,
    { flexDirection: "column", width: cols, height: rows },
    h(StatusBar, { activeTask, taskPhase, currentChapterId, project, renderProfile }),
    h(
      Box,
      { flexDirection: "row", width: cols, height: layout.bodyHeight },
      h(
        Box,
        {
          borderStyle: panelBorderStyle(renderProfile),
          borderColor: "blue",
          paddingX: 1,
          flexDirection: "column",
          width: leftWidth,
          height: layout.bodyHeight
        },
        h(Text, { color: "blueBright", bold: true }, transcriptHeader),
        ...transcriptWindow.lines.map((item, index) =>
          h(Text, { key: `${item.role}-${index}-${item.line}`, wrap: "truncate-end", color: messageColor(item.role) }, item.line)
        )
      ),
      h(
        Box,
        { flexDirection: "column", width: layout.sidebarWidth, height: layout.bodyHeight },
        ...sidebarPanels.map((panel) =>
          h(PanelBox, {
            key: panel.key,
            title: panel.title,
            color: panel.color,
            renderProfile,
            width: layout.sidebarWidth,
            height: panel.height,
            lines: panel.lines
          })
        )
      )
    ),
    h(
      Box,
      {
        borderStyle: panelBorderStyle(renderProfile),
        borderColor: "cyan",
        paddingX: 1,
        flexDirection: "column",
        width: cols,
        height: layout.inputHeight
      },
      ...summaryLines.map((line, index) => h(Text, { key: `summary-${index}`, color: index === 0 ? "cyan" : "gray" }, line)),
      h(
        Box,
        { flexDirection: "row", width: "100%" },
        h(Text, { color: "cyan", bold: true }, "> "),
        h(
          Box,
          { width: computeInputWidth(cols) },
          h(TextInput, {
            key: `input-${inputVersion}`,
            value: input,
            placeholder: "描述你想生成、修改或查看的内容",
            onChange: onInputChange,
            onSubmit
          })
        )
      ),
      visibleSuggestionsList.length > 0
        ? h(
            Box,
            { flexDirection: "column" },
            ...visibleSuggestionsList.map((item, index) =>
              h(
                Text,
                {
                  key: item.command,
                  color: item.index === suggestionIndex ? "black" : "green",
                  backgroundColor: item.index === suggestionIndex ? "green" : undefined,
                  wrap: "truncate-end"
                },
                `${item.preview}  ${item.description}`
              )
            )
          )
        : null,
      h(
        Text,
        { color: "gray", dimColor: true, wrap: "truncate-end" },
        buildInputHelp({ visibleSuggestionsCount: visibleSuggestionsList.length, plotSession, guideSession })
      )
    )
  );
}

function PanelBox({ title, color, renderProfile, width, height, lines }) {
  const visibleLines = (lines.length > 0 ? lines : ["-"]).slice(0, Math.max(1, height - 3));
  return h(
    Box,
    {
      borderStyle: panelBorderStyle(renderProfile),
      borderColor: color,
      paddingX: 1,
      flexDirection: "column",
      width,
      height
    },
    h(Text, { color, bold: true, wrap: "truncate-end" }, title),
    ...visibleLines.map((line, index) => h(Text, { key: `${title}-${index}`, wrap: "truncate-end" }, line))
  );
}

function StatusBar({ activeTask, taskPhase, currentChapterId, project, renderProfile }) {
  const taskText = activeTask ? `${activeTask} / ${taskPhase}` : "idle";
  const modeText = `${project.llmMode}:${project.model}`;
  const pulse = activeTask ? phasePulse(taskPhase) : "";
  return h(
    Box,
    {
      borderStyle: panelBorderStyle(renderProfile),
      borderColor: "gray",
      paddingX: 1,
      flexDirection: "row",
      justifyContent: "space-between",
      height: 3
    },
    h(
      Text,
      { color: activeTask ? "yellow" : "green", wrap: "truncate-end" },
      activeTask && !renderProfile.disableSpinner ? h(Spinner, { type: "dots" }) : activeTask ? "*" : "●",
      ` ${taskText}${pulse}`
    ),
    h(Text, { color: "gray", wrap: "truncate-end" }, `focus ${currentChapterId || "-"} | ${modeText}`)
  );
}

function phasePulse(taskPhase) {
  const frames = [".", "..", "..."];
  const index = Math.floor(Date.now() / 350) % frames.length;
  return taskPhase ? ` ${frames[index]}` : "";
}

export function buildSummaryLines({ cols = 120, currentChapterId, project, plotState, lastResult, activeTask, taskPhase }) {
  const focus = summarizeFocus(project, currentChapterId);
  const activeIntent = plotState?.activeIntent ? `plot ${plotState.activeIntent.title}` : "plot none";
  const task = activeTask ? `task ${activeTask}/${taskPhase}` : "task idle";
  const result = lastResult ? `last ${singleLine(lastResult)}` : "last -";
  const primary = [`focus ${focus.chapterId}`, `plan ${focus.plan}`, `draft ${focus.draft}`, `memory ${focus.memory}`, activeIntent];
  const secondary = [
    `chapters ${project.stats.planned}/${project.statuses.length} planned`,
    `drafted ${project.stats.drafted}`,
    `memory ${project.stats.memoryDone}`,
    `ctx ${project.contextBudget || 0}`,
    task
  ];

  return [
    truncateLine(primary.join(" | "), cols - 4),
    truncateLine(secondary.join(" | "), cols - 4),
    truncateLine(result, cols - 4)
  ];
}

export function buildInspectorLines({
  cols = 120,
  view,
  currentChapterId,
  project,
  details,
  plotState,
  lastArtifacts,
  selectedEntity,
  plotSession
}) {
  switch (view) {
    case "status":
      return buildStatusLines(project, currentChapterId, cols);
    case "context":
      return wrapPreview(details.contextPreview, cols, 10);
    case "memory":
      return wrapPreview(details.memoryPreview, cols, 10);
    case "plot":
      return buildPlotInspectorLines(plotState, currentChapterId, cols, 10, plotSession);
    case "artifacts":
      return lastArtifacts.length > 0 ? lastArtifacts.map((item) => truncateLine(trimPath(item), cols - 4)) : ["-"];
    case "loops":
      return wrapPreview(details.loopPreview, cols, 10);
    case "warnings":
      return wrapPreview(details.warningPreview, cols, 10);
    case "entity":
      return buildEntityLines(selectedEntity, cols);
    default:
      return buildOverviewLines({ cols, details, plotState, lastArtifacts, plotSession });
  }
}

export function buildContextUsageLines({ cols = 40, details }) {
  const usage = details.displayUsage || details.contextUsage || emptyUsage();
  const width = cols - 4;
  const lines = [
    truncateLine(
      `${details.isRefreshing ? "updating | " : ""}budget ${usage.budget || 0} | used ${usage.usedTokens} | left ${usage.remainingTokens} | ${usage.usagePercent}%`,
      width
    )
  ];

  if (usage.promptSections.length === 0) {
    lines.push("no assembled context");
  } else {
    lines.push(
      ...usage.promptSections.slice(0, 5).map((section) =>
        truncateLine(
          `${section.label} ${section.tokens} tok (${section.percentOfBudget}%)${section.priority ? ` ${section.priority}` : ""}${section.compressed ? " compressed" : ""}`,
          width
        )
      )
    );
  }

  if (usage.referenceSections.length > 0) {
    lines.push(
      ...usage.referenceSections.slice(0, 2).map((section) =>
        truncateLine(`${section.label} ref ${section.tokens} tok`, width)
      )
    );
  }

  return lines;
}

export function buildSidebarPanels({
  bodyHeight,
  cols,
  currentChapterId,
  project,
  details,
  plotState,
  lastArtifacts,
  inspectorView,
  selectedEntity,
  plotSession
}) {
  const panels = [];
  if (bodyHeight >= 15) {
    const heights = distributeHeights(bodyHeight, 3);
    panels.push({
      key: "status",
      title: "Status",
      color: "yellow",
      height: heights[0],
      lines: buildStatusLines(project, currentChapterId, cols)
    });
    panels.push({
      key: "usage",
      title: `Context Usage${details.isRefreshing ? " *" : ""}`,
      color: "magenta",
      height: heights[1],
      lines: buildContextUsageLines({ cols, details })
    });
    panels.push({
      key: "detail",
      title: `Detail / ${inspectorView || "overview"}`,
      color: "cyan",
      height: heights[2],
      lines: buildInspectorLines({
        cols,
        view: inspectorView || "overview",
        currentChapterId,
        project,
        details,
        plotState,
        lastArtifacts,
        selectedEntity,
        plotSession
      })
    });
    return panels;
  }

  const heights = distributeHeights(bodyHeight, 2);
  panels.push({
    key: "workspace",
    title: "Workspace",
    color: "yellow",
    height: heights[0],
    lines: [
      ...buildStatusLines(project, currentChapterId, cols),
      ...buildContextUsageLines({ cols, details })
    ]
  });
  panels.push({
    key: "detail",
    title: `Detail / ${inspectorView || "overview"}`,
    color: "cyan",
    height: heights[1],
    lines: buildInspectorLines({
      cols,
      view: inspectorView || "overview",
      currentChapterId,
      project,
      details,
      plotState,
      lastArtifacts,
      selectedEntity,
      plotSession
    })
  });
  return panels;
}

export function computeLayoutFrames({ rows = 40, suggestionCount = 0, cols = process.stdout.columns || 120 }) {
  const statusBarHeight = 3;
  const maxSuggestionRows = Math.max(0, Math.min(MAX_SUGGESTION_ROWS, rows - 12));
  const suggestionRows = Math.min(maxSuggestionRows, Math.max(0, suggestionCount));
  const inputHeight = 7 + suggestionRows;
  const bodyHeight = Math.max(4, rows - statusBarHeight - inputHeight);
  const sidebarWidth = Math.max(12, Math.min(48, Math.floor(cols * 0.38), cols - 20));
  return {
    statusBarHeight,
    suggestionRows,
    inputHeight,
    bodyHeight,
    sidebarWidth
  };
}

export function getSuggestionWindow(suggestions, activeIndex, maxRows) {
  const items = suggestions || [];
  const rows = Math.max(0, maxRows || 0);
  if (items.length === 0 || rows === 0) {
    return {
      items: [],
      hiddenAbove: 0,
      hiddenBelow: 0,
      start: 0,
      end: 0
    };
  }

  const safeIndex = Math.min(Math.max(0, activeIndex || 0), items.length - 1);
  const start = Math.min(Math.max(0, safeIndex - rows + 1), Math.max(0, items.length - rows));
  const end = Math.min(items.length, start + rows);

  return {
    items: items.slice(start, end).map((item, index) => ({
      ...item,
      index: start + index
    })),
    hiddenAbove: start,
    hiddenBelow: items.length - end,
    start,
    end
  };
}

export function toggleInspectorView(current) {
  return current ? null : "context";
}

export function computeInputWidth(cols = 120) {
  return Math.max(8, getPanelContentWidth(cols) - getVisibleWidth(INPUT_PROMPT));
}

export function buildInputHelp({ visibleSuggestionsCount = 0, plotSession = null, guideSession = null }) {
  if (visibleSuggestionsCount > 0) {
    return "Enter 提交，Tab 补全命令，上下键切换命令建议，PgUp/PgDn 滚动消息区，Ctrl+O 聚焦详情";
  }

  if (guideSession) {
    return guideSession.phase === "confirm"
      ? "输入 生成 开始大纲生成，/back 返回上一题，/cancel 取消，PgUp/PgDn 滚动消息区"
      : "当前为引导式大纲模式：直接输入答案，/skip 跳过当前题，/cancel 取消，PgUp/PgDn 滚动消息区";
  }

  if (plotSession?.items?.length) {
    return "Enter/a 应用，k 保留，d 放弃，1-3 或上下键切换剧情建议，PgUp/PgDn 滚动消息区，Esc 退出 plot 快捷态";
  }

  return "Enter 提交，输入 / 查看命令，上下键切换最近 10 条命令，PgUp/PgDn 滚动消息区，Ctrl+O 聚焦详情面板，左右键切换详情，Esc 退出详情，Ctrl+C 停止/退出";
}

export function getTranscriptWindow(history, width, height, scrollOffset = 0) {
  const allLines = buildTranscriptLines(history, width);
  const visibleHeight = Math.max(1, height);
  const maxScroll = Math.max(0, allLines.length - visibleHeight);
  const safeScroll = Math.min(Math.max(0, scrollOffset), maxScroll);
  const end = allLines.length - safeScroll;
  const start = Math.max(0, end - visibleHeight);
  return {
    lines: allLines.slice(start, end),
    hiddenAbove: start,
    hiddenBelow: allLines.length - end,
    scrollOffset: safeScroll,
    totalLines: allLines.length
  };
}

function buildTranscriptLines(history, width) {
  const lines = history.flatMap((item) =>
    wrapTextLines(formatTranscriptLine(item), width).map((line) => ({
      role: item.role,
      line
    }))
  );

  while (lines.length > 1 && isBlankLine(lines.at(-1)?.line)) {
    lines.pop();
  }

  return lines;
}

function buildStatusLines(project, currentChapterId, cols) {
  const width = cols - 4;
  return [
    truncateLine(`title ${project.title}`, width),
    truncateLine(
      `focus ${currentChapterId || "-"} | planned ${project.stats.planned} | drafted ${project.stats.drafted} | memory ${project.stats.memoryDone}`,
      width
    ),
    truncateLine(`llm ${project.llmMode}:${project.model} | budget ${project.contextBudget || 0}`, width),
    ...project.statuses.slice(-4).map((item) =>
      truncateLine(
        `${item.chapterId === currentChapterId ? ">" : " "} ${item.chapterId} plan:${boolFlag(item.hasPlan)} draft:${boolFlag(item.hasDraft)} memory:${item.summaryStatus || "-"}`,
        width
      )
    )
  ];
}

function buildOverviewLines({ cols, details, plotState, lastArtifacts, plotSession }) {
  return [
    ...wrapPreview(details.contextPreview || "No context preview.", cols, 4),
    ...buildPlotInspectorLines(plotState, null, cols, 3, plotSession),
    ...(lastArtifacts.length > 0 ? [truncateLine(`last ${trimPath(lastArtifacts.at(-1))}`, cols - 4)] : [])
  ];
}

export function buildPlotInspectorLines(plotState, currentChapterId, cols, maxLines = 6, plotSession = null) {
  const items = selectVisiblePlotOptions(plotState, currentChapterId);
  const quickMap = new Map((plotSession?.items || []).map((item) => [item.optionId, item]));
  const activeThreads = (plotState.threads || []).filter((item) => (plotState.activeThreadIds || []).includes(item.id));
  const lines = [];
  if (plotState.activeIntent) {
    lines.push(truncateLine(`active ${plotState.activeIntent.title}`, cols - 4));
    lines.push(...wrapPreview(plotState.activeIntent.summary, cols, 2));
  } else {
    lines.push("active none");
  }
  lines.push(
    ...activeThreads.slice(0, 2).map((item) =>
      truncateLine(`* ${item.title} [${item.status}] ${formatPlotThreadRange(item.appliesToChapters, item.originChapterId, item.scope)} / ${item.endCondition || "-"}`, cols - 4)
    )
  );
  if (items.length === 0) {
    lines.push(activeThreads.length ? "no recent plot options" : "no recent plot options");
    return lines.slice(0, maxLines);
  }
  return [
    ...lines,
    ...items.map((item) => {
      const quickItem = quickMap.get(item.id);
      const prefix = quickItem ? `${quickItem.index === plotSession?.selectedIndex ? ">" : " "} ${quickItem.shortId}.` : "-";
      return truncateLine(`${prefix} [${item.status}] ${item.title}`, cols - 4);
    })
  ].slice(0, maxLines);
}

function buildEntityLines(entity, cols) {
  if (!entity) {
    return ["No entity selected."];
  }
  return [
    truncateLine(`${entity.name} [${entity.type}]`, cols - 4),
    truncateLine(`latest ${entity.latestChapterId || "-"}`, cols - 4),
    truncateLine(`arc ${entity.arcStage || "-"}`, cols - 4),
    ...wrapPreview(entity.currentState || "-", cols, 2),
    ...wrapPreview(entity.arcSummary || "-", cols, 2),
    ...(entity.constraints?.length
      ? entity.constraints.slice(0, 2).map((item) => truncateLine(`- ${item}`, cols - 4))
      : ["- no constraints"])
  ].slice(0, 8);
}

function summarizeFocus(project, currentChapterId) {
  const item = project.statuses.find((entry) => entry.chapterId === currentChapterId);
  return {
    chapterId: currentChapterId || "-",
    plan: boolFlag(item?.hasPlan),
    draft: boolFlag(item?.hasDraft),
    memory: item?.summaryStatus || "-"
  };
}

function formatTranscriptLine(item) {
  const text = normalizeTranscriptText(item.text || (item.streaming ? "…" : ""));
  return `${roleLabel(item.role)} ${text}`;
}

function formatTaskStarted(task) {
  return `Running ${String(task || "task").replaceAll("-", " ")}.`;
}

function cycleInspectorView(current, step) {
  const index = INSPECTOR_VIEWS.indexOf(current);
  const next = index === -1 ? 0 : (index + step + INSPECTOR_VIEWS.length) % INSPECTOR_VIEWS.length;
  return INSPECTOR_VIEWS[next];
}

function distributeHeights(total, count) {
  const base = Math.floor(total / count);
  let remainder = total % count;
  return Array.from({ length: count }, () => {
    const height = base + (remainder > 0 ? 1 : 0);
    remainder = Math.max(0, remainder - 1);
    return height;
  });
}

function wrapPreview(text, cols, maxLines = 6) {
  const width = Math.max(8, cols - PANEL_HORIZONTAL_CHROME);
  const lines = wrapTextLines(trimPreview(text, Math.max(240, width * maxLines)), width);
  return lines.slice(0, maxLines);
}

function wrapTextLines(text, width) {
  const limit = Math.max(8, width || 0);
  const rawLines = normalizeTranscriptText(text).split("\n");
  const wrapped = [];

  for (const rawLine of rawLines) {
    const line = rawLine || "";
    if (line.length === 0) {
      wrapped.push("");
      continue;
    }

    let remaining = line;
    while (remaining) {
      const segment = sliceByVisibleWidth(remaining, limit);
      if (!segment) {
        break;
      }
      wrapped.push(segment);
      remaining = remaining.slice(segment.length);
    }
  }

  return wrapped;
}

function truncateLine(text, width) {
  const value = String(text || "").trim();
  if (!width || getVisibleWidth(value) <= width) {
    return value;
  }
  if (width <= 1) {
    return "…";
  }
  return `${sliceByVisibleWidth(value, width - 1).trimEnd()}…`;
}

function messageColor(role) {
  if (role === "user") {
    return "cyan";
  }
  if (role === "assistant") {
    return "white";
  }
  if (role === "result") {
    return "green";
  }
  if (role === "event") {
    return "yellow";
  }
  return "gray";
}

function selectVisiblePlotOptions(plotState, currentChapterId) {
  const chapterOptions = currentChapterId ? plotState.options.filter((item) => item.chapterId === currentChapterId) : [];
  const bookOptions = plotState.options.filter((item) => item.scope === "book");
  return [...chapterOptions.slice(-2), ...bookOptions.slice(-1)].slice(-3);
}

function formatPlotThreadRange(range, originChapterId, scope) {
  if (scope === "book" || range?.mode === "all_future") {
    return `${range?.start || originChapterId || "-"}+`;
  }
  if (range?.mode === "list") {
    return (range.chapters || []).join(",");
  }
  return [range?.start || originChapterId || "-", range?.end || ""].filter(Boolean).join("-");
}

function emptyProjectSnapshot() {
  return {
    title: "-",
    model: "-",
    llmMode: "unknown",
    contextBudget: 12000,
    statuses: [],
    stats: {
      planned: 0,
      drafted: 0,
      memoryDone: 0
    }
  };
}

function emptyDetailsSnapshot() {
  return {
    contextSections: [],
    contextPreview: "No chapter selected.",
    memoryPreview: "No memory summary yet.",
    loopPreview: "No open loops.",
    warningPreview: "No continuity warnings.",
    contextUsage: emptyUsage()
  };
}

function emptyUsage() {
  return {
    budget: 0,
    usedTokens: 0,
    remainingTokens: 0,
    usagePercent: 0,
    promptSections: [],
    referenceSections: []
  };
}

export function hasUsageDelta(previous = emptyUsage(), next = emptyUsage()) {
  return (
    Number(previous.budget || 0) !== Number(next.budget || 0) ||
    Number(previous.usedTokens || 0) !== Number(next.usedTokens || 0) ||
    Number(previous.remainingTokens || 0) !== Number(next.remainingTokens || 0) ||
    Number(previous.usagePercent || 0) !== Number(next.usagePercent || 0)
  );
}

export function buildAnimatedUsageFrame(previous = emptyUsage(), next = emptyUsage(), progress = 1) {
  const clamped = Math.max(0, Math.min(1, Number(progress) || 0));
  return {
    ...next,
    budget: interpolateUsageNumber(previous.budget, next.budget, clamped, 0),
    usedTokens: interpolateUsageNumber(previous.usedTokens, next.usedTokens, clamped, 0),
    remainingTokens: interpolateUsageNumber(previous.remainingTokens, next.remainingTokens, clamped, 0),
    usagePercent: interpolateUsageNumber(previous.usagePercent, next.usagePercent, clamped, 1)
  };
}

function interpolateUsageNumber(fromValue, toValue, progress, digits) {
  const from = Number(fromValue || 0);
  const to = Number(toValue || 0);
  const value = from + (to - from) * progress;
  return digits > 0 ? Number(value.toFixed(digits)) : Math.round(value);
}

function roleLabel(role) {
  if (role === "user") {
    return "you>";
  }
  if (role === "assistant") {
    return "ai >";
  }
  if (role === "event") {
    return "evt>";
  }
  if (role === "result") {
    return "ok >";
  }
  return "sys>";
}

function boolFlag(value) {
  return value ? "yes" : "no";
}

function trimPath(filePath) {
  return String(filePath || "").split("/").slice(-2).join("/");
}

function singleLine(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function trimPreview(text, limit) {
  const value = String(text || "").replace(/\n{3,}/g, "\n\n").trim();
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function buildMemoryPreview(memoryDoc) {
  const chapterSummary = extractMarkdownSection(memoryDoc, "章节摘要");
  const characterState = extractMarkdownSection(memoryDoc, "人物状态");
  const worldState = extractMarkdownSection(memoryDoc, "世界状态");
  const openLoops = extractMarkdownSection(memoryDoc, "未回收伏笔");
  const sections = [
    chapterSummary ? `# 章节摘要\n${chapterSummary}` : "",
    characterState ? `# 人物状态\n${characterState}` : "",
    worldState ? `# 世界状态\n${worldState}` : "",
    openLoops ? `# 未回收伏笔\n${openLoops}` : ""
  ].filter(Boolean);
  return trimPreview(sections.join("\n\n") || "No memory summary yet.", 2000);
}

function buildLoopPreview(items) {
  const active = (items || []).filter((item) => item.status !== "resolved");
  if (!active.length) {
    return "No open loops.";
  }
  return active.map((item) => `- ${item.title}（最新：第${item.latestChapterId}章）`).join("\n");
}

function buildWarningPreview(items) {
  if (!(items || []).length) {
    return "No continuity warnings.";
  }
  return items.map((item) => `- [${item.severity}] ${item.message}`).join("\n");
}

function extractMarkdownSection(doc, heading) {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = String(doc || "").match(new RegExp(`## ${escaped}\\n([\\s\\S]*?)(?=\\n## |$)`));
  return match ? match[1].trim() : "";
}

function getPanelContentWidth(width, paddingX = 1) {
  return Math.max(1, Math.floor(Number(width) || 0) - PANEL_HORIZONTAL_CHROME - Math.max(0, paddingX - 1) * 2);
}

function getVisibleWidth(text) {
  return stringWidth(String(text || ""));
}

function sliceByVisibleWidth(text, width) {
  const limit = Math.max(1, width || 0);
  let visible = 0;
  let result = "";

  for (const char of Array.from(String(text || ""))) {
    const nextWidth = getVisibleWidth(char);
    if (visible + nextWidth > limit && result) {
      break;
    }
    result += char;
    visible += nextWidth;
    if (visible >= limit) {
      break;
    }
  }

  return result;
}

function createHistoryItem(role, text, options = {}) {
  return {
    id: options.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    kind: options.kind || inferHistoryKind(role),
    createdAt: options.createdAt || new Date().toISOString(),
    streaming: Boolean(options.streaming),
    ...clampMessageText(text)
  };
}

function clampMessageText(text) {
  const value = normalizeTranscriptText(text);
  if (value.length <= MAX_MESSAGE_CHARS) {
    return { text: value };
  }

  const keep = Math.max(0, MAX_MESSAGE_CHARS - 28);
  return {
    text: `[earlier content omitted]\n${value.slice(-keep)}`
  };
}

function renderSectionsMarkdown(sections) {
  return sections
    .filter((section) => section.text)
    .map((section) => `# ${section.heading || section.label}\n${section.text}`)
    .join("\n\n");
}

function normalizeTranscriptText(text) {
  return stripAnsiControlCodes(String(text || ""))
    .replace(/\r\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n+$/g, "")
    .trimEnd();
}

export function detectRenderProfile(env = process.env) {
  const terminalProgram = String(env.TERM_PROGRAM || "");
  const forceSafe = env.AINOVEL_TUI_SAFE === "1";
  const appleTerminal = terminalProgram === "Apple_Terminal";
  return {
    terminalProgram,
    safeMode: forceSafe || appleTerminal,
    incrementalRendering: !(forceSafe || appleTerminal),
    disableSpinner: forceSafe || appleTerminal,
    asciiBorders: forceSafe || appleTerminal
  };
}

function buildWelcomeMessage(renderProfile) {
  const base =
    "AINOVEL TUI\n像和 agent 对话一样描述任务；输入 `/` 查看命令。可先用 `/init` 初始化项目，用 `/guid` 引导式生成大纲，或用 `/outline [要求]` 快速生成。右侧会持续显示状态和上下文占用。Ctrl+O 聚焦详情面板，Esc 关闭，Ctrl+C 停止/退出。";
  if (!renderProfile?.safeMode) {
    return base;
  }
  return `${base}\n已启用兼容模式：降低重绘频率并关闭动画，以避免 Apple Terminal 崩溃。`;
}

function panelBorderStyle(renderProfile) {
  return renderProfile?.asciiBorders ? "classic" : "round";
}

function stripAnsiControlCodes(text) {
  return text.replace(ANSI_ESCAPE_PATTERN, "");
}

function inferHistoryKind(role) {
  if (role === "event") {
    return "event";
  }
  if (role === "result") {
    return "result";
  }
  return "message";
}

function isBlankLine(text) {
  return !String(text || "").trim();
}

function stepChapter(statuses, currentChapterId, step) {
  const items = statuses || [];
  if (!items.length) {
    return null;
  }
  const index = Math.max(0, items.findIndex((item) => item.chapterId === currentChapterId));
  const nextIndex = Math.min(items.length - 1, Math.max(0, index + step));
  return items[nextIndex]?.chapterId || items[index]?.chapterId || null;
}

function parseBudget(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) ? parsed : 12000;
}

function createGuideSession() {
  return {
    stepIndex: 0,
    phase: "question",
    answers: {}
  };
}

function buildGuideQuestion(stepIndex, answers = {}) {
  const step = GUIDE_STEPS[stepIndex];
  const previous = GUIDE_STEPS.slice(0, stepIndex)
    .map((item) => {
      const value = String(answers[item.key] || "").trim() || "未指定";
      return `- ${item.title}：${value}`;
    })
    .join("\n");
  return [step.prompt, previous ? `\n已记录：\n${previous}` : "", "\n可输入 `跳过` / `/skip` 略过当前题。"].join("\n");
}

function buildGuideConfirmation(answers) {
  return [
    "已收集以下引导信息：",
    ...GUIDE_STEPS.map((step) => `- ${step.title}：${String(answers[step.key] || "").trim() || "未指定"}`),
    "",
    "输入 `生成` 开始生成大纲，输入 `/back` 返回上一题，或输入 `/cancel` 取消。"
  ].join("\n");
}

export function buildFatalTuiDiagnostic({ error, diagnostics } = {}) {
  const state = diagnostics || {};
  return [
    "AINOVEL TUI fatal error",
    `- message: ${singleLine(error?.message || "Unknown fatal error.")}`,
    `- active_task: ${state.activeTask || "none"}`,
    `- task_phase: ${state.taskPhase || "idle"}`,
    `- chapter: ${state.currentChapterId || "none"}`,
    `- last_result: ${singleLine(state.lastResult || "n/a")}`
  ].join("\n");
}
