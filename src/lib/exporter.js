import path from "node:path";
import { constants as fsConstants } from "node:fs";
import { access, statfs, writeFile } from "node:fs/promises";
import { ensureDir, safeListPath, safeReadPath, writeText } from "./fs.js";
import { parseFrontmatter } from "./frontmatter.js";
import { resolveProjectPaths } from "./project.js";
import { safeResolve } from "./path-safe.js";

const MIN_EXPORT_FREE_SPACE_BYTES = 1_048_576;
const ZIP_LOCAL_FILE_HEADER = 0x04034b50;
const ZIP_CENTRAL_DIRECTORY_HEADER = 0x02014b50;
const ZIP_END_OF_CENTRAL_DIRECTORY = 0x06054b50;

export async function exportProject(rootDir, outputPath, format = "md") {
  const bundle = await buildExportBundle(rootDir);
  const target = outputPath || safeResolve(rootDir, defaultExportFileName(format));
  await validateExportTarget(target, bundle, format);

  if (format === "txt") {
    await writeText(target, renderTxtBundle(bundle));
    return target;
  }

  if (format === "epub") {
    await writeEpubBundle(bundle, target);
    return target;
  }

  await writeText(target, renderMarkdownBundle(bundle));
  return target;
}

async function buildExportBundle(rootDir) {
  const paths = resolveProjectPaths(rootDir);
  const chapterFiles = await safeListPath(rootDir, "chapters");
  const draftFiles = chapterFiles.filter((name) => name.endsWith(".draft.md")).sort();

  const [story, arcs, characters, world, recent, global, openLoops, archive, plotOptions] = await Promise.all([
    safeReadPath(rootDir, "outline/story.md", ""),
    safeReadPath(rootDir, "outline/arcs.md", ""),
    safeReadPath(rootDir, "characters/roster.md", ""),
    safeReadPath(rootDir, "world/rules.md", ""),
    safeReadPath(rootDir, "memory/recent_summary.md", ""),
    safeReadPath(rootDir, "memory/global_summary.md", ""),
    safeReadPath(rootDir, "memory/open_loops.md", ""),
    safeReadPath(rootDir, "memory/archive_summary.md", ""),
    safeReadPath(rootDir, "memory/plot_options.json", "")
  ]);
  const plotState = parsePlotOptions(plotOptions);

  const chapters = [];
  for (const draftFile of draftFiles) {
    const raw = await safeReadPath(rootDir, `chapters/${draftFile}`, "");
    const parsed = parseFrontmatter(raw);
    chapters.push({
      chapterId: parsed.data.chapter_id || draftFile.split(".")[0],
      content: parsed.content.trim() || "暂无内容。"
    });
  }

  return {
    title: "小说导出",
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
  const bookSections = buildBookSections(bundle);
  const entries = [
    { name: "mimetype", data: "application/epub+zip" },
    {
      name: "META-INF/container.xml",
      data: `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
    },
    {
      name: "OEBPS/book.xhtml",
      data: buildEpubXhtml(bundle, bookSections)
    },
    {
      name: "OEBPS/nav.xhtml",
      data: buildNavXhtml(bundle, bookSections)
    },
    {
      name: "OEBPS/content.opf",
      data: buildContentOpf(bundle)
    }
  ];

  await ensureDir(path.dirname(targetPath));
  await writeFile(targetPath, buildZipArchive(entries));
}

function buildBookSections(bundle) {
  return [
    { id: "story", title: "故事总纲", content: bundle.story },
    { id: "arcs", title: "卷纲与章纲", content: bundle.arcs },
    { id: "characters", title: "人物设定", content: bundle.characters },
    { id: "world", title: "世界规则", content: bundle.world },
    { id: "recent", title: "近期记忆", content: bundle.recent },
    { id: "global", title: "长期记忆", content: bundle.global },
    { id: "archive", title: "阶段归档", content: bundle.archive },
    { id: "open-loops", title: "未回收伏笔", content: bundle.openLoops },
    { id: "plot", title: "剧情建议", content: renderPlotOptionsMarkdown(bundle.plotState) },
    ...bundle.chapters.map((chapter, index) => ({
      id: `chapter-${chapter.chapterId || index + 1}`,
      title: `章节 ${chapter.chapterId}`,
      content: chapter.content
    }))
  ];
}

function buildEpubXhtml(bundle, sections) {
  const body = [
    `<h1>${escapeHtml(bundle.title)}</h1>`,
    ...sections.map((section) => sectionToHtml(section.title, section.content, section.id))
  ].join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" lang="zh-CN">
  <head>
    <meta charset="UTF-8"/>
    <title>${escapeHtml(bundle.title)}</title>
  </head>
  <body>
${indentHtml(body, 4)}
  </body>
</html>`;
}

function buildNavXhtml(bundle, sections) {
  const items = sections.map((section) => `      <li><a href="book.xhtml#${section.id}">${escapeHtml(section.title)}</a></li>`).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="zh-CN">
  <head>
    <meta charset="UTF-8"/>
    <title>${escapeHtml(bundle.title)}目录</title>
  </head>
  <body>
    <nav epub:type="toc" id="toc">
      <h1>目录</h1>
      <ol>
${items}
      </ol>
    </nav>
  </body>
</html>`;
}

function buildContentOpf(bundle) {
  const modifiedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">ainovel-export</dc:identifier>
    <dc:title>${escapeHtml(bundle.title)}</dc:title>
    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">${modifiedAt}</meta>
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

function sectionToHtml(title, markdown, id) {
  return [
    `<section id="${escapeHtml(id)}">`,
    `  <h2>${escapeHtml(title)}</h2>`,
    indentHtml(markdownToHtml(markdown), 2),
    "</section>"
  ].join("\n");
}

function markdownToHtml(markdown) {
  const lines = String(markdown || "").replace(/\r\n/g, "\n").split("\n");
  const html = [];
  let paragraph = [];
  let listType = null;
  let listItems = [];
  let codeFence = null;
  let codeLines = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    html.push(`<p>${paragraph.map((line) => renderInline(line)).join("<br/>")}</p>`);
    paragraph = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) {
      return;
    }
    html.push(`<${listType}>`);
    for (const item of listItems) {
      html.push(`  <li>${renderInline(item)}</li>`);
    }
    html.push(`</${listType}>`);
    listType = null;
    listItems = [];
  };

  const flushCode = () => {
    if (!codeFence) {
      return;
    }
    html.push(`<pre><code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
    codeFence = null;
    codeLines = [];
  };

  for (const line of lines) {
    if (line.trim().startsWith("```")) {
      if (codeFence) {
        flushCode();
      } else {
        flushParagraph();
        flushList();
        codeFence = "```";
      }
      continue;
    }

    if (codeFence) {
      codeLines.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = Math.min(6, heading[1].length);
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    const unordered = trimmed.match(/^[-*]\s+(.+)$/);
    if (unordered) {
      flushParagraph();
      if (!listType) {
        listType = "ul";
      }
      if (listType !== "ul") {
        flushList();
        listType = "ul";
      }
      listItems.push(unordered[1]);
      continue;
    }

    const ordered = trimmed.match(/^\d+\.\s+(.+)$/);
    if (ordered) {
      flushParagraph();
      if (!listType) {
        listType = "ol";
      }
      if (listType !== "ol") {
        flushList();
        listType = "ol";
      }
      listItems.push(ordered[1]);
      continue;
    }

    paragraph.push(trimmed);
  }

  flushCode();
  flushParagraph();
  flushList();
  return html.join("\n");
}

function renderInline(input) {
  return escapeHtml(String(input || ""))
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function stripMarkdown(input) {
  return String(input || "")
    .replace(/^#+\s*/gm, "")
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, "").trim())
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

function escapeHtml(input) {
  return String(input || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function indentHtml(input, spaces) {
  const prefix = " ".repeat(spaces);
  return String(input || "")
    .split("\n")
    .map((line) => `${prefix}${line}`)
    .join("\n");
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

async function validateExportTarget(targetPath, bundle, format) {
  const targetDir = path.dirname(targetPath);
  await ensureDir(targetDir);
  await access(targetDir, fsConstants.W_OK);

  const estimatedBytes = estimateExportSize(bundle, format);
  try {
    const stats = await statfs(targetDir);
    const availableBytes = Number(stats.bavail) * Number(stats.bsize);
    if (Number.isFinite(availableBytes) && availableBytes < Math.max(MIN_EXPORT_FREE_SPACE_BYTES, estimatedBytes * 2)) {
      throw new Error(`Insufficient disk space to export bundle to ${targetPath}`);
    }
  } catch (error) {
    if (error.message.startsWith("Insufficient disk space")) {
      throw error;
    }
  }
}

function estimateExportSize(bundle, format) {
  if (format === "txt") {
    return Buffer.byteLength(renderTxtBundle(bundle), "utf8");
  }
  if (format === "epub") {
    return Buffer.byteLength(renderMarkdownBundle(bundle), "utf8") + 32_768;
  }
  return Buffer.byteLength(renderMarkdownBundle(bundle), "utf8");
}

function defaultExportFileName(format) {
  if (format === "txt") {
    return "export.novel.txt";
  }
  if (format === "epub") {
    return "export.novel.epub";
  }
  return "export.novel.md";
}

function buildZipArchive(entries) {
  const fileParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of entries) {
    const fileName = Buffer.from(String(entry.name || "").replace(/\\/g, "/"), "utf8");
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(String(entry.data || ""), "utf8");
    const crc = crc32(data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(ZIP_LOCAL_FILE_HEADER, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(0, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc >>> 0, 14);
    localHeader.writeUInt32LE(data.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(fileName.length, 26);
    localHeader.writeUInt16LE(0, 28);

    fileParts.push(localHeader, fileName, data);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(ZIP_CENTRAL_DIRECTORY_HEADER, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(0, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc >>> 0, 16);
    centralHeader.writeUInt32LE(data.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(fileName.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(centralHeader, fileName);
    offset += localHeader.length + fileName.length + data.length;
  }

  const centralDirectoryOffset = offset;
  const centralDirectorySize = centralParts.reduce((total, part) => total + part.length, 0);
  const entryCount = entries.length;

  const endOfCentralDirectory = Buffer.alloc(22);
  endOfCentralDirectory.writeUInt32LE(ZIP_END_OF_CENTRAL_DIRECTORY, 0);
  endOfCentralDirectory.writeUInt16LE(0, 4);
  endOfCentralDirectory.writeUInt16LE(0, 6);
  endOfCentralDirectory.writeUInt16LE(entryCount, 8);
  endOfCentralDirectory.writeUInt16LE(entryCount, 10);
  endOfCentralDirectory.writeUInt32LE(centralDirectorySize, 12);
  endOfCentralDirectory.writeUInt32LE(centralDirectoryOffset, 16);
  endOfCentralDirectory.writeUInt16LE(0, 20);

  return Buffer.concat([...fileParts, ...centralParts, endOfCentralDirectory]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const CRC32_TABLE = buildCrc32Table();

function buildCrc32Table() {
  const table = [];
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value & 1) === 1 ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    }
    table.push(value >>> 0);
  }
  return table;
}
