import { encodingForModel, getEncoding } from "js-tiktoken";

const FALLBACK_ENCODING = "o200k_base";
const MODEL_CONTEXT_WINDOWS = new Map([
  ["gpt-4.1", 1047576],
  ["gpt-4.1-mini", 1047576],
  ["gpt-4.1-nano", 1047576],
  ["gpt-4o", 128000],
  ["gpt-4o-mini", 128000],
  ["gpt-4", 8192]
]);

export function countTokens(text, model = "gpt-4o-mini") {
  const encoder = getModelEncoder(model);
  return encoder.encode(normalizeTokenText(text)).length;
}

export function buildTokenUsage(sections, budget, model) {
  const encoder = getModelEncoder(model);
  const normalizedBudget = Number.isFinite(Number(budget)) ? Number(budget) : 0;
  const items = sections.map((section) => {
    const text = normalizeTokenText(section.text);
    const tokens = text ? encoder.encode(text).length : 0;
    return {
      ...section,
      chars: text.length,
      tokens,
      percentOfBudget: normalizedBudget > 0 ? Number(((tokens / normalizedBudget) * 100).toFixed(1)) : 0
    };
  });

  const promptSections = items
    .filter((item) => item.group !== "reference")
    .sort((left, right) => right.tokens - left.tokens || left.label.localeCompare(right.label));
  const referenceSections = items
    .filter((item) => item.group === "reference")
    .sort((left, right) => right.tokens - left.tokens || left.label.localeCompare(right.label));
  const usedTokens = promptSections.reduce((total, item) => total + item.tokens, 0);

  return {
    budget: normalizedBudget,
    usedTokens,
    remainingTokens: Math.max(0, normalizedBudget - usedTokens),
    usagePercent: normalizedBudget > 0 ? Number(((usedTokens / normalizedBudget) * 100).toFixed(1)) : 0,
    promptSections,
    referenceSections
  };
}

export function trimTextToTokenBudget(text, budget, model = "gpt-4o-mini", suffix = "\n[已截断]") {
  const encoder = getModelEncoder(model);
  const normalizedText = normalizeTokenText(text);
  const normalizedBudget = Number.parseInt(String(budget ?? ""), 10);
  if (!normalizedText || !Number.isFinite(normalizedBudget) || normalizedBudget <= 0) {
    return "";
  }

  if (encoder.encode(normalizedText).length <= normalizedBudget) {
    return normalizedText;
  }

  const normalizedSuffix = normalizeTokenText(suffix);
  const suffixTokens = encoder.encode(normalizedSuffix).length;
  const availableBudget = suffixTokens < normalizedBudget ? normalizedBudget - suffixTokens : normalizedBudget;

  let low = 0;
  let high = normalizedText.length;
  let best = "";

  while (low <= high) {
    const middle = Math.floor((low + high) / 2);
    const candidate = normalizedText.slice(0, middle).trimEnd();
    if (!candidate) {
      low = middle + 1;
      continue;
    }

    if (encoder.encode(candidate).length <= availableBudget) {
      best = candidate;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  if (!best) {
    return "";
  }

  const withSuffix = suffixTokens < normalizedBudget ? `${best}${normalizedSuffix}` : best;
  if (encoder.encode(withSuffix).length <= normalizedBudget) {
    return withSuffix;
  }

  return best;
}

export function getModelContextWindow(model) {
  const rawValue = String(model || "").trim();
  if (!rawValue || rawValue === "fallback-local") {
    return null;
  }
  const normalized = normalizeModelName(rawValue);

  for (const [prefix, contextWindow] of MODEL_CONTEXT_WINDOWS.entries()) {
    if (normalized === prefix || normalized.startsWith(`${prefix}-`)) {
      return contextWindow;
    }
  }

  return null;
}

function getModelEncoder(model) {
  const normalized = normalizeModelName(model);
  try {
    return encodingForModel(normalized);
  } catch {
    return getEncoding(FALLBACK_ENCODING);
  }
}

function normalizeModelName(model) {
  const value = String(model || "").trim();
  if (!value || value === "fallback-local") {
    return "gpt-4o-mini";
  }

  return value.includes("/") ? value.split("/").at(-1) : value;
}

function normalizeTokenText(text) {
  return String(text || "").normalize("NFC");
}
