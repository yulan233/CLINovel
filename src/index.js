#!/usr/bin/env node

import process from "node:process";
import { loadEnv } from "./lib/env.js";
import { runCli } from "./lib/cli.js";
import { installGlobalErrorLogging, logError } from "./lib/log.js";

installGlobalErrorLogging();

loadEnv()
  .then(() => runCli(process.argv.slice(2)))
  .catch((error) => {
    const logFile = logError(error, {
      type: "startup_failure",
      context: {
        pid: process.pid
      }
    });
    console.error(`Error: ${error.message}`);
    if (logFile) {
      console.error(`Log written to ${logFile}`);
    }
    process.exitCode = 1;
  });
