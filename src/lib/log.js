import process from "node:process";
import path from "node:path";
import { appendFileSync, mkdirSync } from "node:fs";

const LOG_FILE_NAME = "ainovel-error.log";
let globalHandlersInstalled = false;

export function resolveLogFile(rootDir = process.cwd()) {
  return path.join(rootDir, "logs", LOG_FILE_NAME);
}

export function logError(error, { type = "error", rootDir = process.cwd(), context = {} } = {}) {
  const logFile = resolveLogFile(rootDir);
  const lines = [
    `[${new Date().toISOString()}] ${type}`,
    `cwd: ${process.cwd()}`,
    `argv: ${JSON.stringify(process.argv)}`,
    ...formatContext(context),
    ...formatError(error),
    ""
  ];

  try {
    mkdirSync(path.dirname(logFile), { recursive: true });
    appendFileSync(logFile, `${lines.join("\n")}\n`, "utf8");
    return logFile;
  } catch {
    return null;
  }
}

export function installGlobalErrorLogging({ rootDir = process.cwd() } = {}) {
  if (globalHandlersInstalled) {
    return;
  }
  globalHandlersInstalled = true;

  process.on("uncaughtException", (error) => {
    logError(error, {
      type: "uncaughtException",
      rootDir,
      context: {
        pid: process.pid
      }
    });
  });

  process.on("unhandledRejection", (reason) => {
    logError(normalizeError(reason), {
      type: "unhandledRejection",
      rootDir,
      context: {
        pid: process.pid,
        rejectionType: typeof reason
      }
    });
  });

  for (const signal of ["SIGINT", "SIGTERM"]) {
    process.on(signal, () => {
      logError(new Error(`Process received ${signal}`), {
        type: "signal",
        rootDir,
        context: {
          pid: process.pid,
          signal
        }
      });
      process.exit(128 + signalNumber(signal));
    });
  }
}

function normalizeError(value) {
  if (value instanceof Error) {
    return value;
  }
  return new Error(typeof value === "string" ? value : JSON.stringify(value));
}

function formatContext(context) {
  return Object.entries(context).map(([key, value]) => `${key}: ${safeSerialize(value)}`);
}

function formatError(error) {
  const normalized = normalizeError(error);
  const lines = [`name: ${normalized.name}`, `message: ${normalized.message}`];

  if (normalized.stack) {
    lines.push("stack:");
    lines.push(normalized.stack);
  }

  if (normalized.cause) {
    lines.push(`cause: ${safeSerialize(normalized.cause instanceof Error ? {
      name: normalized.cause.name,
      message: normalized.cause.message,
      stack: normalized.cause.stack
    } : normalized.cause)}`);
  }

  return lines;
}

function safeSerialize(value) {
  if (typeof value === "string") {
    return value;
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function signalNumber(signal) {
  switch (signal) {
    case "SIGINT":
      return 2;
    case "SIGTERM":
      return 15;
    default:
      return 1;
  }
}
