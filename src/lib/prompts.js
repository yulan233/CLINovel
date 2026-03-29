import { parseFrontmatter } from "./frontmatter.js";
import { formatStyleForPrompt } from "./style.js";

export function buildOutlinePrompt(config, styleText, requirements = "") {
  return [
    "你是中文长篇小说策划助手。",
    "请严格输出 4 个区块，且每个区块都必须使用以下标签包裹：",
    "<story>...</story>",
    "<arcs>...</arcs>",
    "<characters>...</characters>",
    "<world>...</world>",
    "每个区块内部都只输出 Markdown，不要输出额外解释。",
    "",
    "写作要求：",
    "- 保持主线清晰，冲突持续推进。",
    "- 人物目标、阻碍、代价必须具体。",
    "- 卷纲要细到章级示例，至少给出 6 章。",
    "- 世界规则要强调约束、代价、隐藏规则。",
    "",
    "项目信息：",
    `- 标题：${safePromptInline(config.title, "未命名小说")}`,
    `- 类型：${safePromptInline(config.genre, "未定义")}`,
    `- 目标篇幅：${safePromptInline(config.target_length, "长篇")}`,
    "",
    "用户补充要求：",
    safePromptBlock(requirements, "无"),
    "",
    "文风配置：",
    safePromptBlock(formatStyleForPrompt(styleText), "无")
  ].join("\n");
}

export function buildGuidedOutlinePrompt(config, guideAnswers, styleText) {
  const answers = normalizeGuideAnswers(guideAnswers);
  return [
    "你是中文长篇小说策划助手。",
    "以下是用户通过引导式问答提供的小说种子，请基于这些信息生成完整大纲。",
    "请严格输出 4 个区块，且每个区块都必须使用以下标签包裹：",
    "<story>...</story>",
    "<arcs>...</arcs>",
    "<characters>...</characters>",
    "<world>...</world>",
    "每个区块内部都只输出 Markdown，不要输出额外解释。",
    "",
    "写作要求：",
    "- 保持主线清晰，冲突持续推进。",
    "- 人物目标、阻碍、代价必须具体。",
    "- 卷纲要细到章级示例，至少给出 6 章。",
    "- 世界规则要强调约束、代价、隐藏规则。",
    "- 必须优先吸收用户已经明确指定的设定和冲突，不要擅自偏题。",
    "",
    "项目信息：",
    `- 标题：${safePromptInline(config.title, "未命名小说")}`,
    `- 类型：${safePromptInline(config.genre, "未定义")}`,
    `- 目标篇幅：${safePromptInline(config.target_length, "长篇")}`,
    "",
    "引导式输入：",
    `- 题材与基调：${safePromptInline(answers.genreAndTone, "未指定")}`,
    `- 世界观与规则：${safePromptInline(answers.worldAndRules, "未指定")}`,
    `- 主角与初始处境：${safePromptInline(answers.protagonistAndSetup, "未指定")}`,
    `- 主线目标与代价：${safePromptInline(answers.goalAndCost, "未指定")}`,
    `- 冲突卖点与结局倾向：${safePromptInline(answers.conflictAndEnding, "未指定")}`,
    "",
    "文风配置：",
    safePromptBlock(formatStyleForPrompt(styleText), "无")
  ].join("\n");
}

export function buildChapterPlanPrompt(chapterId, context) {
  return [
    `你是中文小说章节策划助手，请为第${safePromptInline(chapterId, "000")}章生成章节计划。`,
    "请先输出 frontmatter，再输出 Markdown 正文。",
    "frontmatter 必须包含：chapter_id, goal, must_include, continuity_notes。",
    "正文必须包含：本章目标、冲突、场景拆分、关键转折、章末钩子。",
    "不要输出任何解释性前言。",
    "",
    "硬性要求：",
    "- 必须先承接已有上下文，不能重置人物关系、设定状态或已发生事件。",
    "- 若上下文中已经给出人物状态、世界状态、伏笔进度，必须以最新有效版本为准，不得回退到旧状态。",
    "- 本章必须有明确推进，至少推进主线、人物关系、信息揭示三者之一。",
    "- 场景拆分必须写出每个场景的目标、阻碍、结果，避免空转场景。",
    "- 已解决的冲突和已回收的伏笔不要重新当作未解决问题再开启；仍未解决的伏笔必须继续推进、加压或延后说明。",
    "- 如需新增设定、角色信息或世界规则，必须与现有连续性约束兼容，否则不要引入。",
    "- continuity_notes 只记录真正关键的连续性约束，不写空话。",
    "- must_include 必须具体到动作、冲突、线索、钩子，不要写泛泛而谈的词。",
    "",
    "写作上下文：",
    safePromptBlock(context, "(无上下文)")
  ].join("\n");
}

export function buildPlotOptionsPrompt({ scope, chapterId, activeIntent, context }) {
  return [
    "你是中文小说剧情策划助手。",
    `请围绕${scope === "book" ? "全书后续主线" : `第${safePromptInline(String(chapterId).padStart(3, "0"), "000")}章及其后续`}生成 3 条互相区分明显的剧情走向。`,
    "请严格输出 3 个区块：",
    "<option_1>...</option_1>",
    "<option_2>...</option_2>",
    "<option_3>...</option_3>",
    "每个区块内部必须包含：",
    "- 一个简短标题",
    "- 2 到 4 行剧情摘要",
    "- 一行“风险：...”说明该走向的代价或风险",
    "不要输出任何额外解释。",
    "",
    "当前写作上下文：",
    safePromptBlock(context, "暂无额外上下文。"),
    "",
    activeIntent
      ? `当前已采纳剧情意图：${safePromptInline(`${activeIntent.title || ""} ${activeIntent.summary || ""}`.trim(), "未命名")}`
      : "当前没有已采纳剧情意图。"
  ].join("\n");
}

export function buildDraftPrompt(chapterId, context) {
  return [
    `你是中文网络小说写作助手，请生成第${safePromptInline(chapterId, "000")}章正文。`,
    "请先输出 frontmatter，再输出 Markdown 正文。",
    "frontmatter 必须包含：chapter_id, status, summary_status。",
    "正文要求：",
    "- 严格延续已有设定、人物状态、剧情因果，不得无依据新增关键设定",
    "- 若上下文中存在同一人物/势力/地点的多个状态描述，以最新有效版本为准，不得写回旧状态",
    "- 每个场景都要有动作、阻碍、信息增量或情绪变化，不能只做解释",
    "- 每章都要有明确推进，不做空转",
    "- 冲突、代价、选择必须具体，避免空泛情绪堆砌",
    "- 已解决的伏笔不要重新写成未解决；未回收伏笔若继续保留，必须给出新的压力、线索或延迟理由",
    "- 新增设定必须兼容当前章节计划、人物状态、世界状态",
    "- 对白区分人物口吻",
    "- 章末保留下一章驱动力",
    "- 不要解释你是如何写的",
    "- 不要复述上下文，不要解释你是如何写的",
    "- 禁止出现“以下是”“我将”“我认为”“作为AI”“这里是”“我会”“思考过程”等元叙述",
    "- 禁止输出任何创作说明、策略说明、标签说明或自我评注",
    "",
    "写作上下文：",
    safePromptBlock(context, "(无上下文)")
  ].join("\n");
}

export function buildMemoryPrompt(chapterId, draftText, existingMemory) {
  return [
    `你是小说长期记忆整理助手，请总结第${safePromptInline(chapterId, "000")}章。`,
    "请严格输出以下 8 个标签区块，每个区块内部只写 Markdown 列表：",
    "<recent_summary>...</recent_summary>",
    "<global_summary>...</global_summary>",
    "<open_loops>...</open_loops>",
    "<character_state>...</character_state>",
    "<world_state>...</world_state>",
    "<story_threads>...</story_threads>",
    "<entities>...</entities>",
    "<forgetting_log>...</forgetting_log>",
    "<chapter_tags>...</chapter_tags>",
    "",
    "总结要求：",
    "- recent_summary：保留本章和近期推进，优先写本章新增动作、信息、关系变化。",
    "- global_summary：只保留长期主线事实，必须经得起后续多章复用。",
    "- open_loops：只记录未解决问题、伏笔、承诺、危险项；已解决内容不要继续保留。",
    "- character_state：只记录当前仍有效的关键人物状态变化，格式尽量使用“人物名：状态变化”。",
    "- world_state：只记录当前仍有效的规则、势力、环境变化，格式尽量使用“对象：变化”。",
    "- story_threads：只记录仍在推进中的主线、支线、关系线，每条都要说明最新推进点。",
    "- entities：记录本章涉及且后续仍有价值的人物、物品、地点、势力，格式尽量使用“对象：当前有效状态/约束”。",
    "- forgetting_log：说明哪些细节被压缩、哪些旧状态被新状态覆盖、哪些已解决伏笔被移除，以及为何可降权。",
    "- chapter_tags：输出 4 到 8 个标签，每行一个，优先使用 plot:main、plot:sub、character、relationship、secret、clue、foreshadowing、world_rule、emotion_turning、battle、politics 等稳定标签，可补充少量自由标签。",
    "- 不要复述全文，不要逐段摘要，不要记录没有后续价值的描写细节。",
    "- 同一信息不要在多个标签里重复堆砌；长期事实写入 global_summary，短期推进写入 recent_summary。",
    "- 若人物或世界状态被更新，写最新有效版本，不要同时保留旧版本。",
    "- 若本章解决了旧伏笔，不要把它继续写进 open_loops；必要时把“已解决/已兑现”的处理写进 forgetting_log。",
    "- 若同一事实有新旧两个版本，只保留最新版本；旧版本不再复述。",
    "",
    "已有长期记忆：",
    safePromptBlock(existingMemory, "(无已有长期记忆)"),
    "",
    "本章正文：",
    safePromptBlock(draftText, "(无正文)")
  ].join("\n");
}

export function buildOutlineRevisionPrompt(currentOutline, feedback, styleText) {
  return [
    "你是中文长篇小说编辑，请根据用户反馈修订当前大纲。",
    "请严格输出 4 个区块，且每个区块都必须使用以下标签包裹：",
    "<story>...</story>",
    "<arcs>...</arcs>",
    "<characters>...</characters>",
    "<world>...</world>",
    "只输出修订后的 Markdown，不要解释。",
    "",
    "用户反馈：",
    safePromptBlock(feedback, "(无反馈)"),
    "",
    "文风：",
    safePromptBlock(formatStyleForPrompt(styleText), "无"),
    "",
    "当前大纲：",
    safePromptBlock(currentOutline, "(无当前大纲)")
  ].join("\n");
}

export function buildChapterRevisionPrompt(chapterId, planText, draftText, feedback, context) {
  return [
    `你是中文小说编辑，请根据反馈修订第${safePromptInline(chapterId, "000")}章内容。`,
    "如果已提供正文，则输出修订后的正文；否则输出修订后的章节计划。",
    "请先输出 frontmatter，再输出 Markdown 正文。",
    "不要解释修改过程。",
    "优先只修改反馈明确涉及的层面，未被指出的问题不要随意重写。",
    "修订后必须继续兼容既有设定、人物状态、剧情因果。",
    "如果反馈与既有上下文冲突，优先做最小破坏调整，不能直接推翻已成立事实。",
    "",
    "用户反馈：",
    safePromptBlock(feedback, "(无反馈)"),
    "",
    "当前章节计划：",
    safePromptBlock(planText, "(无)"),
    "",
    "当前章节正文：",
    safePromptBlock(draftText, "(无)"),
    "",
    "写作上下文：",
    safePromptBlock(context, "(无上下文)")
  ].join("\n");
}

export function buildChapterRewritePlanPrompt(chapterId, planText, draftText, feedback, context) {
  return [
    `你是中文小说重写策划助手，请为第${safePromptInline(chapterId, "000")}章生成“先检索、再重写”的工作计划。`,
    "请严格输出以下 3 个标签区块，不要输出额外解释：",
    "<retrieval_plan>...</retrieval_plan>",
    "<retrieval_items>...</retrieval_items>",
    "<rewrite_focus>...</rewrite_focus>",
    "",
    "输出要求：",
    "- retrieval_plan：用 Markdown 列表概括本次重写的检索策略，说明要核对哪些前文结构问题。",
    "- retrieval_items：每行一条，格式固定为 `chapter_id|files|reason`。",
    "- files 只能使用 `plan`、`draft`、`memory`，多个值用逗号分隔。",
    "- 只列出真正需要补充检索的章节，优先前文章节，最多 4 条；如果不需要额外检索，输出 `none`。",
    "- rewrite_focus：列出本次重写最需要修复的结构目标、节奏问题、伏笔承接、人物动机或信息顺序。",
    "",
    "当前反馈：",
    safePromptBlock(feedback, "(无额外反馈，默认以提升结构承接与上文一致性为目标)"),
    "",
    "当前章节计划：",
    safePromptBlock(planText, "(无)"),
    "",
    "当前章节正文：",
    safePromptBlock(draftText, "(无)"),
    "",
    "当前写作上下文：",
    safePromptBlock(context, "(无上下文)")
  ].join("\n");
}

export function buildChapterRewritePrompt(chapterId, planText, draftText, feedback, context, retrievalPlan, supplementalContext) {
  return [
    `你是中文小说重写助手，请重写第${safePromptInline(chapterId, "000")}章内容。`,
    "如果已提供正文，则输出重写后的正文；否则输出重写后的章节计划。",
    "请先输出 frontmatter，再输出 Markdown 正文。",
    "不要解释修改过程，不要输出标签。",
    "",
    "重写要求：",
    "- 这不是局部润色，而是允许重排场景顺序、信息揭示顺序和冲突节奏，但必须保持既有事实成立。",
    "- 优先修复承接断层、动机不清、伏笔错位、节奏空转、冲突推进不足等结构问题。",
    "- 检索到的前文信息若与当前章节冲突，必须以前文已成立事实为准，并做最小必要改写。",
    "- 重写后要让本章与前文因果链更顺，章末驱动力更明确。",
    "- 不要为了重写而平白新增关键设定、角色关系或世界规则。",
    "- 禁止出现“以下是”“我将”“我认为”“作为AI”“这里是”“我会”“思考过程”等元叙述。",
    "",
    "用户补充要求：",
    safePromptBlock(feedback, "(无额外反馈，默认优化上文承接、结构推进和信息组织)"),
    "",
    "检索规划：",
    safePromptBlock(retrievalPlan, "(无额外检索规划)"),
    "",
    "补充检索上下文：",
    safePromptBlock(supplementalContext, "(无额外补充内容)"),
    "",
    "当前章节计划：",
    safePromptBlock(planText, "(无)"),
    "",
    "当前章节正文：",
    safePromptBlock(draftText, "(无)"),
    "",
    "全局写作上下文：",
    safePromptBlock(context, "(无上下文)")
  ].join("\n");
}

export function extractTaggedSections(text, tags) {
  const result = {};

  for (const tag of tags) {
    const match = text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`, "i"));
    if (match) {
      result[tag] = match[1].trim();
    }
  }

  return result;
}

export function normalizePlanOutput(chapterId, llmText, fallbackPlan) {
  if (!llmText) {
    return fallbackPlan;
  }

  const parsed = parseFrontmatter(llmText);
  const data = {
    ...fallbackPlan.frontmatter,
    ...parsed.data
  };
  const body = parsed.content.trim() || fallbackPlan.body;

  return { frontmatter: data, body };
}

export function normalizeDraftOutput(chapterId, llmText, fallbackDraft) {
  if (!llmText) {
    return fallbackDraft;
  }

  const parsed = parseFrontmatter(llmText);
  const data = {
    ...fallbackDraft.frontmatter,
    ...parsed.data,
    chapter_id: String(parsed.data.chapter_id || chapterId).padStart(3, "0")
  };
  const body = parsed.content.trim() || fallbackDraft.body;

  return { frontmatter: data, body };
}

function normalizeGuideAnswers(guideAnswers = {}) {
  return {
    genreAndTone: String(guideAnswers.genreAndTone || "").trim() || "未指定",
    worldAndRules: String(guideAnswers.worldAndRules || "").trim() || "未指定",
    protagonistAndSetup: String(guideAnswers.protagonistAndSetup || "").trim() || "未指定",
    goalAndCost: String(guideAnswers.goalAndCost || "").trim() || "未指定",
    conflictAndEnding: String(guideAnswers.conflictAndEnding || "").trim() || "未指定"
  };
}

function safePromptInline(value, fallback = "") {
  const normalized = escapePromptText(value).replace(/\s+/g, " ").trim();
  return normalized || fallback;
}

function safePromptBlock(value, fallback = "") {
  const normalized = escapePromptText(value).trim();
  return normalized || fallback;
}

function escapePromptText(value) {
  return String(value || "")
    .normalize("NFC")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
