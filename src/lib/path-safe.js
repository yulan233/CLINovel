import path from "node:path";

export function safeResolve(baseDir, target = ".") {
  const normalizedBase = path.resolve(baseDir);
  const resolvedTarget = path.resolve(normalizedBase, target || ".");

  if (!isPathWithin(normalizedBase, resolvedTarget)) {
    throw new Error(`Path escapes base directory: ${target}`);
  }

  return resolvedTarget;
}

export function isPathWithin(baseDir, targetPath) {
  const relative = path.relative(path.resolve(baseDir), path.resolve(targetPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
