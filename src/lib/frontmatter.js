export function parseFrontmatter(input) {
  if (!input.startsWith("---\n")) {
    return { data: {}, content: input.trimStart() };
  }

  const end = input.indexOf("\n---\n", 4);
  if (end === -1) {
    return { data: {}, content: input.trimStart() };
  }

  const rawMeta = input.slice(4, end).trim();
  const content = input.slice(end + 5).replace(/^\n+/, "");
  const data = {};

  for (const line of rawMeta.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf(":");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const rawValue = trimmed.slice(separator + 1).trim();

    if (rawValue.startsWith("[") && rawValue.endsWith("]")) {
      data[key] = rawValue
        .slice(1, -1)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    } else if (rawValue === "true" || rawValue === "false") {
      data[key] = rawValue === "true";
    } else if (/^(0|[1-9]\d*)$/.test(rawValue) && !(rawValue.length > 1 && rawValue.startsWith("0"))) {
      data[key] = Number(rawValue);
    } else {
      data[key] = rawValue;
    }
  }

  return { data, content };
}

export function stringifyFrontmatter(data, content) {
  const lines = ["---"];

  for (const [key, value] of Object.entries(data)) {
    if (value === undefined || value === null) {
      continue;
    }

    if (Array.isArray(value)) {
      lines.push(`${key}: [${value.join(", ")}]`);
    } else {
      lines.push(`${key}: ${String(value)}`);
    }
  }

  lines.push("---", "", content.trimEnd(), "");
  return lines.join("\n");
}
