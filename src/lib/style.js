export function parseStyleText(styleText) {
  const lines = styleText.split("\n");
  const structured = {};
  const freeform = [];

  for (const line of lines) {
    const trimmed = line.trim();
    const bullet = trimmed.replace(/^-+\s*/, "");
    const separator = bullet.indexOf("：");

    if (trimmed.startsWith("-") && separator !== -1) {
      const key = bullet.slice(0, separator).trim();
      const value = bullet.slice(separator + 1).trim();
      if (key && value) {
        structured[key] = value;
        continue;
      }
    }

    if (trimmed && !trimmed.startsWith("#")) {
      freeform.push(trimmed);
    }
  }

  return { structured, freeform };
}

export function formatStyleForPrompt(styleText) {
  const { structured, freeform } = parseStyleText(styleText);
  const lines = ["## 结构化文风约束"];

  if (Object.keys(structured).length === 0) {
    lines.push("- 未提供结构化字段");
  } else {
    for (const [key, value] of Object.entries(structured)) {
      lines.push(`- ${key}：${value}`);
    }
  }

  lines.push("", "## 自由文本补充");
  lines.push(freeform.length ? freeform.join("\n") : "- 无");
  return lines.join("\n");
}
