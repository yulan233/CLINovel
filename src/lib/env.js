import path from "node:path";
import { exists, readText } from "./fs.js";

export async function loadEnv(rootDir = process.cwd()) {
  const candidates = [
    path.join(rootDir, ".env"),
    path.join(process.cwd(), ".env")
  ];

  for (const filePath of [...new Set(candidates)]) {
    if (!(await exists(filePath))) {
      continue;
    }

    const raw = await readText(filePath, "");
    applyEnvText(raw);
  }
}

export function applyEnvText(raw) {
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = stripQuotes(trimmed.slice(separator + 1).trim());

    if (!key || process.env[key]) {
      continue;
    }

    process.env[key] = value;
  }
}

function stripQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }

  return value;
}
