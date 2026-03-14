import { encodingForModel, getEncoding } from "js-tiktoken";

const FALLBACK_ENCODING = "o200k_base";

export function countTokens(text, model = "gpt-4o-mini") {
  const encoder = getModelEncoder(model);
  return encoder.encode(String(text || "")).length;
}

export function buildTokenUsage(sections, budget, model) {
  const encoder = getModelEncoder(model);
  const normalizedBudget = Number.isFinite(Number(budget)) ? Number(budget) : 0;
  const items = sections.map((section) => {
    const text = String(section.text || "");
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
