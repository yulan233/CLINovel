# Repository Guidelines

## Project Structure & Module Organization
`src/` contains the CLI entrypoint and runtime modules. Use [`src/index.js`](/Users/yulan233/Desktop/project/ai_project/ainovel/src/index.js) for process startup, [`src/lib/cli.js`](/Users/yulan233/Desktop/project/ai_project/ainovel/src/lib/cli.js) for command dispatch, and [`src/lib/tui/`](/Users/yulan233/Desktop/project/ai_project/ainovel/src/lib/tui) for TUI-specific state such as history and plot sessions. Tests live in [`tests/`](/Users/yulan233/Desktop/project/ai_project/ainovel/tests), and reference docs live in [`docs/`](/Users/yulan233/Desktop/project/ai_project/ainovel/docs). Generated novel workspaces are separate from this repo and contain folders like `outline/`, `chapters/`, `memory/`, and `logs/`.

## Build, Test, and Development Commands
Run `npm install` once to install dependencies. Use `npm start` to launch the CLI from the repository root, or `node src/index.js help` for a direct entrypoint check. Run `npm test` to execute the full `node:test` suite. For local CLI usage during development, `npm link` exposes `ainovel` globally so commands like `ainovel doctor` and `ainovel tui` run against your local checkout.

## Coding Style & Naming Conventions
This project uses Node.js 20+, ES modules, semicolons, double quotes, and 2-space indentation. Prefer small focused modules under `src/lib/`. Use `camelCase` for variables and functions, `PascalCase` only for React/TUI components if introduced, and kebab-free descriptive test filenames such as `cli-memory.test.js` or `plot-session.test.js`. Keep file-driven paths and command names explicit; match existing patterns like `handleChapter`, `buildRuntime`, and `resolveProjectPaths`.

## Testing Guidelines
Tests use the built-in `node:test` runner with `node:assert/strict`. Add or update tests in [`tests/`](/Users/yulan233/Desktop/project/ai_project/ainovel/tests) for every CLI behavior change, especially command output, generated files, and memory/plot state transitions. Follow the existing `*.test.js` naming pattern. There is no published coverage gate here, so aim for targeted regression coverage around the changed command or module.

## Commit & Pull Request Guidelines
Git history is not available in this workspace snapshot, so no repository-specific commit convention can be verified. Use short imperative commit subjects such as `Add plot thread persistence test` and keep unrelated changes split into separate commits. Pull requests should summarize user-visible behavior changes, list test coverage (`npm test`), note any `.env` or model configuration impacts, and include terminal screenshots only when TUI output changed.

## Security & Configuration Tips
Copy `.env.example` to `.env` and keep secrets out of version control. Validate local setup with `ainovel doctor` before testing model-backed flows. Commit only source, docs, and intentional fixtures; exclude local noise such as `node_modules/`, `.env`, `tmp/`, and `*.log`.
