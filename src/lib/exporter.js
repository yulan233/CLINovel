import path from "node:path";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ensureDir, listFiles, readText, removeDir, writeText } from "./fs.js";
import { parseFrontmatter } from "./frontmatter.js";
import { resolveProjectPaths } from "./project.js";

const execFileAsync = promisify(execFile);

export async function exportProject(rootDir, outputPath, format = "md") {
  const bundle = await buildExportBundle(rootDir);

  if (format === "txt") {
    const target = outputPath || path.join(rootDir, "export.novel.txt");
    await writeText(target, renderTxtBundle(bundle));
    return target;
  }

  if (format === "epub") {
    const target = outputPath || path.join(rootDir, "export.novel.epub");
    await writeEpubBundle(bundle, target);
    return target;
  }

  const target = outputPath || path.join(rootDir, "export.novel.md");
  await writeText(target, renderMarkdownBundle(bundle));
  return target;
}

async function buildExportBundle(rootDir) {
  const paths = resolveProjectPaths(rootDir);
  const chapterDir = path.join(rootDir, "chapters");
  const chapterFiles = await listFiles(chapterDir);
  const draftFiles = chapterFiles.filter((name) => name.endsWith(".draft.md")).sort();

  const [story, arcs, characters, world, recent, global, openLoops, archive, plotOptions] = await Promise.all([
    readText(paths.outlineStory, ""),
    readText(paths.outlineArcs, ""),
    readText(paths.characters, ""),
    readText(paths.world, ""),
    readText(paths.recentSummary, ""),
    readText(paths.globalSummary, ""),
    readText(paths.openLoops, ""),
    readText(paths.archiveSummary, ""),
    readText(paths.plotOptions, "")
  ]);
  const plotState = parsePlotOptions(plotOptions);

  const chapters = [];
  for (const draftFile of draftFiles) {
    const raw = await readText(path.join(chapterDir, draftFile), "");
    const parsed = parseFrontmatter(raw);
    chapters.push({
      chapterId: parsed.data.chapter_id || draftFile.split(".")[0],
      content: parsed.content.trim() || "暂无内容。"
    });
  }

  return {
    story: story.trim() || "暂无内容。",
    arcs: arcs.trim() || "暂无内容。",
    characters: characters.trim() || "暂无内容。",
    world: world.trim() || "暂无内容。",
    recent: recent.trim() || "暂无内容。",
    global: global.trim() || "暂无内容。",
    openLoops: openLoops.trim() || "暂无内容。",
    archive: archive.trim() || "暂无内容。",
    plotState,
    chapters
  };
}

function renderMarkdownBundle(bundle) {
  const sections = [
    "# 小说导出",
    "",
    "## 故事总纲",
    bundle.story,
    "",
    "## 卷纲与章纲",
    bundle.arcs,
    "",
    "## 人物设定",
    bundle.characters,
    "",
    "## 世界规则",
    bundle.world,
    "",
    "## 近期记忆",
    bundle.recent,
    "",
    "## 长期记忆",
    bundle.global,
    "",
    "## 阶段归档",
    bundle.archive,
    "",
    "## 未回收伏笔",
    bundle.openLoops,
    "",
    "## 剧情建议",
    renderPlotOptionsMarkdown(bundle.plotState),
    ""
  ];

  for (const chapter of bundle.chapters) {
    sections.push(`## 章节 ${chapter.chapterId}`);
    sections.push(chapter.content);
    sections.push("");
  }

  return sections.join("\n");
}

function renderTxtBundle(bundle) {
  const sections = [
    "小说导出",
    "====================",
    "",
    "[故事总纲]",
    stripMarkdown(bundle.story),
    "",
    "[卷纲与章纲]",
    stripMarkdown(bundle.arcs),
    "",
    "[人物设定]",
    stripMarkdown(bundle.characters),
    "",
    "[世界规则]",
    stripMarkdown(bundle.world),
    "",
    "[近期记忆]",
    stripMarkdown(bundle.recent),
    "",
    "[长期记忆]",
    stripMarkdown(bundle.global),
    "",
    "[阶段归档]",
    stripMarkdown(bundle.archive),
    "",
    "[未回收伏笔]",
    stripMarkdown(bundle.openLoops),
    "",
    "[剧情建议]",
    stripMarkdown(renderPlotOptionsMarkdown(bundle.plotState)),
    ""
  ];

  for (const chapter of bundle.chapters) {
    sections.push(`[章节 ${chapter.chapterId}]`);
    sections.push(stripMarkdown(chapter.content));
    sections.push("");
  }

  return sections.join("\n");
}

async function writeEpubBundle(bundle, targetPath) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "ainovel-epub-"));
  const oebpsDir = path.join(tempDir, "OEBPS");
  const metaInfDir = path.join(tempDir, "META-INF");
  await ensureDir(oebpsDir);
  await ensureDir(metaInfDir);

  try {
    await writeText(path.join(tempDir, "mimetype"), "application/epub+zip");
    await writeText(
      path.join(metaInfDir, "container.xml"),
      `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
    );
    await writeText(path.join(oebpsDir, "book.xhtml"), buildEpubXhtml(bundle));
    await writeText(path.join(oebpsDir, "nav.xhtml"), buildNavXhtml());
    await writeText(path.join(oebpsDir, "content.opf"), buildContentOpf());

    await execFileAsync("zip", ["-X0", targetPath, "mimetype"], { cwd: tempDir });
    await execFileAsync("zip", ["-Xr9D", targetPath, "META-INF", "OEBPS"], { cwd: tempDir });
  } finally {
    await removeDir(tempDir);
  }
}

function buildEpubXhtml(bundle) {
  const body = [
    "<h1>小说导出</h1>",
    sectionToHtml("故事总纲", bundle.story),
    sectionToHtml("卷纲与章纲", bundle.arcs),
    sectionToHtml("人物设定", bundle.characters),
    sectionToHtml("世界规则", bundle.world),
    sectionToHtml("近期记忆", bundle.recent),
    sectionToHtml("长期记忆", bundle.global),
    sectionToHtml("阶段归档", bundle.archive),
    sectionToHtml("未回收伏笔", bundle.openLoops),
    sectionToHtml("剧情建议", renderPlotOptionsMarkdown(bundle.plotState)),
    ...bundle.chapters.map((chapter) => sectionToHtml(`章节 ${chapter.chapterId}`, chapter.content))
  ].join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">
  <head><title>小说导出</title></head>
  <body>${body}</body>
</html>`;
}

function buildNavXhtml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN">
  <head><title>目录</title></head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>目录</h1>
      <ol><li><a href="book.xhtml">小说导出</a></li></ol>
    </nav>
  </body>
</html>`;
}

function buildContentOpf() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">ainovel-export</dc:identifier>
    <dc:title>小说导出</dc:title>
    <dc:language>zh-CN</dc:language>
  </metadata>
  <manifest>
    <item id="book" href="book.xhtml" media-type="application/xhtml+xml"/>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
  </manifest>
  <spine>
    <itemref idref="book"/>
  </spine>
</package>`;
}

function sectionToHtml(title, markdown) {
  const html = escapeHtml(stripMarkdown(markdown)).replace(/\n/g, "<br/>");
  return `<section><h2>${escapeHtml(title)}</h2><p>${html}</p></section>`;
}

function stripMarkdown(input) {
  return input
    .replace(/^#+\s*/gm, "")
    .replace(/\*\*/g, "")
    .trim();
}

function escapeHtml(input) {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

function parsePlotOptions(raw) {
  try {
    const parsed = JSON.parse(raw || "{}");
    return {
      activeIntent: parsed.activeIntent || null,
      options: Array.isArray(parsed.options) ? parsed.options : []
    };
  } catch {
    return { activeIntent: null, options: [] };
  }
}

function renderPlotOptionsMarkdown(plotState) {
  const lines = [];
  if (plotState.activeIntent) {
    lines.push(`- 当前采纳：${plotState.activeIntent.title}`);
    lines.push(`  ${plotState.activeIntent.summary}`);
  } else {
    lines.push("- 当前采纳：无");
  }

  const saved = plotState.options.filter((item) => item.status !== "dropped").slice(-5);
  if (saved.length === 0) {
    lines.push("- 最近建议：无");
  } else {
    for (const item of saved) {
      lines.push(`- [${item.status}] ${item.title}`);
      lines.push(`  ${item.summary.replace(/\n/g, " ")}`);
    }
  }
  return lines.join("\n");
}
