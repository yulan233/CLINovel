const AI_LEAK_PATTERN = /以下是|我将|我会|我认为|作为ai|作为 AI|这里是|思考过程|创作说明|写作说明/;

export function containsAiLeak(text) {
  return AI_LEAK_PATTERN.test(String(text || ""));
}

export function cleanupAiLeak(text) {
  return String(text || "")
    .split("\n")
    .filter((line) => !AI_LEAK_PATTERN.test(line))
    .join("\n")
    .trim();
}
