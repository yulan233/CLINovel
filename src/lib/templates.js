function slugChapter(chapterId) {
  return String(chapterId).padStart(3, "0");
}

function compressContext(context) {
  return context
    .split("\n")
    .filter((line) => line.startsWith("# ") || line.startsWith("- "))
    .slice(0, 16)
    .join("\n");
}

export function buildFallbackOutline(config, styleText) {
  const title = config.title || "未命名小说";
  return {
    story: [
      `# 故事总纲`,
      ``,
      `## 项目`,
      `- 标题：${title}`,
      `- 类型：${config.genre || "未定义"}`,
      `- 目标篇幅：${config.target_length || "长篇"}`,
      ``,
      `## 核心命题`,
      `主角在不断被迫选择的过程中，重新定义自己真正想守护的东西。`,
      ``,
      `## 主线`,
      `1. 主角因一次失控事件进入更大的阴谋中心。`,
      `2. 主角在盟友、敌人、旧秩序之间摇摆，逐步发现真相。`,
      `3. 故事后半段围绕代价、背叛、牺牲与重建展开。`,
      ``,
      `## 文风提醒`,
      styleText.trim()
    ].join("\n"),
    arcs: [
      "# 卷纲与章纲",
      "",
      "## 第一卷：失控的引线",
      "- 第001章：异常出现，主角被迫卷入",
      "- 第002章：第一次试探与损失",
      "- 第003章：关键线索浮现",
      "",
      "## 第二卷：秩序的裂缝",
      "- 第004章：新的同盟与新的代价",
      "- 第005章：冲突升级，伏笔显形",
      "- 第006章：阶段性真相揭露"
    ].join("\n"),
    characters: [
      "# 人物设定",
      "",
      "## 主角",
      "- 当前定位：被动卷入主线的核心行动者",
      "- 主要欲望：保护重要之人，同时证明自己不是棋子",
      "- 内在矛盾：渴望控制局面，但常因情感冲动打破计划",
      "",
      "## 关键配角",
      "- 盟友：提供专业能力，但立场并不稳定",
      "- 对手：代表既有秩序，对主角持续施压"
    ].join("\n"),
    world: [
      "# 世界规则",
      "",
      "- 公开秩序与真实运作规则存在明显偏差。",
      "- 权力的获取伴随代价，使用越深，反噬越强。",
      "- 每一次关键抉择都会留下可追溯的后果。"
    ].join("\n")
  };
}

export function buildFallbackChapterPlan(chapterId, context) {
  const chapter = slugChapter(chapterId);
  return {
    frontmatter: {
      chapter_id: chapter,
      goal: "推进主线并制造新的不确定性",
      must_include: [
        "主角的明确目标",
        "至少一次对抗或试探",
        "一个新的信息增量",
        "章末悬念"
      ],
      continuity_notes: ["衔接上一章结果", "维护人物既有口吻"]
    },
    body: [
      `# 第${chapter}章计划`,
      "",
      "## 本章目标",
      "让主角从被动反应转为主动试探，同时暴露更深层的冲突。",
      "",
      "## 场景拆分",
      "1. 开场承接上一章余波，主角确认新的威胁。",
      "2. 中段通过行动或对话获取信息，并引发摩擦。",
      "3. 结尾抛出更高风险的问题，推动下一章。",
      "",
      "## 连贯性提示",
      compressContext(context)
    ].join("\n")
  };
}

export function buildFallbackDraft(chapterId, planBody, styleText) {
  const chapter = slugChapter(chapterId);
  return {
    frontmatter: {
      chapter_id: chapter,
      status: "draft",
      summary_status: "pending"
    },
    body: [
      `# 第${chapter}章`,
      "",
      "夜色压得很低，像一张即将收拢的网。",
      "",
      "主角站在局势的边缘，看见每个人都像提前排好了位置，只有自己还在被逼着做选择。他知道再退一步就会失去主动，于是决定先出手试探。这个决定并不漂亮，却足够及时。",
      "",
      "行动展开后，新的线索迅速浮上水面，但线索本身也带来了更糟的答案。盟友的沉默、对手的让步、以及看似偶然的细节，都说明局面远没有表面那么简单。",
      "",
      "当他终于抓住一个接近真相的机会时，代价也随之出现。旧问题并未结束，新问题却已经堵在前面，逼得他必须在下一步里赌上更多筹码。",
      "",
      "## 本章使用的文风提示",
      styleText.trim(),
      "",
      "## 本章依据的计划",
      planBody.trim()
    ].join("\n")
  };
}

export function buildFallbackMemory(chapterId, draftText) {
  const excerpt = draftText
    .split("\n")
    .filter(Boolean)
    .slice(0, 6)
    .join(" ")
    .slice(0, 240);

  return {
    chapterSummary: `- 第${chapterId}章：主角主动试探局势，获得线索，同时确认冲突升级。`,
    recentSummary: `- 最近章节推进：${excerpt}`,
    globalSummary: "- 长期主线更新：主角开始从被动卷入转向主动介入。",
    openLoops: "- 未回收伏笔：线索来源、盟友真实立场、对手让步原因。",
    characterState: "- 主角状态：警惕提升，行动意志更强，但承受的风险增加。",
    worldState: "- 世界状态：隐藏规则开始显露，公开秩序的可信度进一步下降。",
    storyThreads: "- 主线推进：主角开始主动试探局势，冲突进入更高风险阶段。",
    entities: "- 主角：行动意志更强，但风险与暴露概率同步上升。",
    forgettingLog: `- 已压缩第${chapterId}章的措辞与重复描写，仅保留主线事实、人物变化、伏笔与状态变更。`
  };
}

export function buildFallbackOutlineRevision(currentOutline, feedback) {
  return `${currentOutline.trim()}\n\n## 修订备注\n- ${feedback.trim()}\n`;
}

export function buildFallbackChapterRevision(currentBody, feedback) {
  return `${currentBody.trim()}\n\n## 修订备注\n- ${feedback.trim()}\n`;
}

export function buildFallbackPlotOptions(scope, chapterId) {
  const chapter = scope === "chapter" ? slugChapter(chapterId) : null;
  const basis = scope === "book" ? "全书主线" : `第${chapter}章`;

  return [
    {
      id: makePlotId(scope, chapter, 0),
      scope,
      chapterId: chapter,
      title: `${basis}走向一：主动试探`,
      summary: "主角决定提前出手，主动测试敌我边界，并逼出隐藏阵营的反应。",
      risk_or_tradeoff: "会更早暴露主角底牌，但推进节奏最快。",
      status: "suggested",
      createdAt: new Date().toISOString()
    },
    {
      id: makePlotId(scope, chapter, 1),
      scope,
      chapterId: chapter,
      title: `${basis}走向二：代价交换`,
      summary: "主角通过让出一项短期利益换取更深层的情报或盟友支持。",
      risk_or_tradeoff: "人物关系会更复杂，后续偿还代价压力更大。",
      status: "suggested",
      createdAt: new Date().toISOString()
    },
    {
      id: makePlotId(scope, chapter, 2),
      scope,
      chapterId: chapter,
      title: `${basis}走向三：误导反转`,
      summary: "表面线索指向一个看似明确的敌人，但真正的突破来自主角识破误导后的反转行动。",
      risk_or_tradeoff: "铺垫要求更高，若处理不好会削弱读者信任。",
      status: "suggested",
      createdAt: new Date().toISOString()
    }
  ];
}

function makePlotId(scope, chapterId, index) {
  return `${scope}-${chapterId || "book"}-${index + 1}`;
}
