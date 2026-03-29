import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { safeResolve } from "./path-safe.js";

export async function ensureDir(dirPath) {
  await mkdir(dirPath, { recursive: true });
}

export async function writeText(filePath, content) {
  await ensureDir(path.dirname(filePath));
  await writeFile(filePath, content, "utf8");
}

export async function readText(filePath, fallback = "") {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

export async function exists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

export async function listFiles(dirPath, suffix = ".md") {
  try {
    const entries = await readdir(dirPath, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(suffix))
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

export async function removeDir(targetPath) {
  await rm(targetPath, { recursive: true, force: true });
}

export async function safeReadPath(baseDir, target, fallback = "") {
  return readText(safeResolve(baseDir, target), fallback);
}

export async function safeWritePath(baseDir, target, content) {
  const filePath = safeResolve(baseDir, target);
  await writeText(filePath, content);
  return filePath;
}

export async function safeListPath(baseDir, target = ".", suffix = ".md") {
  return listFiles(safeResolve(baseDir, target), suffix);
}
