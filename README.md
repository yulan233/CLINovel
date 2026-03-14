# ainovel

`ainovel` 是一个本地优先的 AI 小说命令行工具，覆盖大纲生成、章节规划、正文写作、长期记忆整理、剧情线程管理，以及全屏 TUI 写作工作流。

它的设计目标很直接：

- 用普通文本和 JSON 文件保存小说工程，而不是把数据锁进数据库
- 让 CLI 和 TUI 共用同一套项目结构与写作状态
- 有模型时走远程生成，无模型时也能用本地模板跑通流程

## 功能概览

- `outline` / `guid`：快速生成或引导式生成故事总纲、卷纲、人物设定、世界规则
- `chapter plan` / `write` / `revise` / `rewrite`：覆盖章节规划、正文生成、定向修订与重写
- `memory rebuild` / `search` / `tags`：维护滚动摘要、章节索引、实体与伏笔信息
- `plot generate` / `apply` / `resolve`：管理剧情建议、故事线程与回收状态
- `tui`：在终端内完成输入、观察上下文、查看状态与应用剧情建议
- `export`：导出当前项目内容

## 环境要求

- Node.js 20+
- macOS / Linux / 支持现代终端的环境

## 安装

仓库根目录执行：

```bash
npm install
npm link
```

也可以不全局链接，直接使用：

```bash
npm start -- help
node src/index.js help
```

## 快速开始

### 1. 初始化小说项目

```bash
ainovel init demo
cd demo
cp .env.example .env
```

### 2. 配置模型

`.env` 示例：

```bash
AINOVEL_API_KEY=your_api_key_here
AINOVEL_BASE_URL=https://api.openai.com/v1
AINOVEL_MODEL=gpt-4.1-mini
```

如果没有配置 API，`ainovel` 会回退到本地模板模式，适合验证目录结构、命令链路和测试流程。

### 3. 检查环境

```bash
ainovel doctor
ainovel config
```

### 4. 跑通一条基础写作链路

```bash
ainovel outline "强化朝堂博弈与宿命感"
ainovel chapter plan 001
ainovel chapter write 001
ainovel status
ainovel tui
```

如果你更想先把设定说清楚，再生成大纲：

```bash
ainovel guid
```

## 典型工作流

### 工作流 1：从 0 到首章

```bash
ainovel init my-novel
cd my-novel
cp .env.example .env
ainovel doctor
ainovel guid
ainovel chapter plan 001
ainovel chapter write 001
```

### 工作流 2：连续推进章节

```bash
ainovel chapter next plan
ainovel chapter next write
ainovel memory rebuild
ainovel chapter list
```

### 工作流 3：修订与重写

```bash
ainovel outline revise "主角动机还不够强"
ainovel chapter revise 003 "结尾悬念更强，去掉重复解释"
ainovel chapter rewrite 003 "强化和第二章的承接"
```

### 工作流 4：管理剧情线程

```bash
ainovel plot generate chapter 003
ainovel plot list
ainovel plot apply <option-id>
ainovel plot thread <thread-id>
ainovel plot resolve <thread-id> 004
```

## 常用命令

### 项目与诊断

```bash
ainovel init [name]
ainovel doctor
ainovel config
ainovel status
ainovel export --txt
ainovel export --epub
```

### 大纲与文风

```bash
ainovel outline
ainovel outline "强化权谋线与反转密度"
ainovel outline revise "压缩前期铺垫"
ainovel guid
ainovel style show
ainovel style template
```

### 章节写作

```bash
ainovel chapter list
ainovel chapter show 001
ainovel chapter plan 001
ainovel chapter write 001
ainovel chapter revise 001 "节奏更紧"
ainovel chapter rewrite 001 "强化冲突升级"
ainovel chapter next plan
ainovel chapter next write
```

### 记忆与上下文

```bash
ainovel memory rebuild
ainovel memory archive
ainovel memory tags
ainovel memory tags 001
ainovel memory search --tag clue
ainovel memory search --entity 主角
ainovel memory search --thread 皇位
ainovel context 001
```

### 剧情推荐

```bash
ainovel plot generate chapter 001
ainovel plot generate book
ainovel plot list
ainovel plot apply <option-id>
ainovel plot keep <option-id>
ainovel plot drop <option-id>
ainovel plot pause <thread-id>
ainovel plot resume <thread-id>
ainovel plot resolve <thread-id> [chapter-id]
```

## TUI 使用

运行：

```bash
ainovel tui
```

界面分为三块：

- 左侧转录区：显示命令、事件和流式输出
- 右侧状态区：显示项目状态、上下文与详情视图
- 底部输入区：输入自然语言或 slash 命令

常用按键：

- `Enter`：提交输入
- `Tab`：补全当前 slash 建议
- `↑/↓`：浏览最近 10 条历史命令
- `PgUp/PgDn`：滚动转录区
- `Ctrl+O`：打开或关闭详情面板
- `←/→`：切换详情视图
- `Esc`：关闭详情面板；如果处于 plot 快捷态则先退出快捷态
- `Ctrl+C`：停止当前任务；空闲时退出 TUI

常用 slash 命令：

```bash
/init
/guid
/outline
/outline 强化宿命感和反转密度
/plan 001
/write 001
/next plan
/next write
/revise 001 节奏更紧
/rewrite 001 强化承接
/inspect status
/inspect context
/inspect memory
/inspect plot
/plot chapter 001
/plot book
/status
/export --txt
```

plot 快捷态下：

- `↑/↓` 或数字键 `1-3`：切换当前建议
- `Enter` 或 `a`：应用建议
- `k`：保留建议
- `d`：放弃建议

更多细节见 [docs/tui.md](/Users/yulan233/Desktop/project/ai_project/ainovel/docs/tui.md)。

## 配置说明

### `.env`

支持的环境变量：

| 变量 | 说明 | 默认值 |
| --- | --- | --- |
| `AINOVEL_API_KEY` | 远程模型 API Key | 空 |
| `AINOVEL_BASE_URL` | API Base URL | `https://api.openai.com/v1` |
| `AINOVEL_MODEL` | 默认模型名 | 读取项目配置，否则回退到 `fallback-local` |

### `project.yaml`

初始化项目后会生成：

```yaml
title: demo
genre: 未定义
target_length: 长篇
default_model: fallback-local
context_budget: 12000
summary_policy: chapter+rolling
```

常用字段：

- `title`：项目标题
- `genre`：题材
- `target_length`：目标篇幅
- `default_model`：项目默认模型
- `context_budget`：上下文预算，默认 `12000`
- `summary_policy`：摘要策略

## 生成的小说工程结构

`ainovel init <name>` 会创建一个文件驱动的小说工作区：

```text
project.yaml
.env.example
style.md
outline/
  story.md
  arcs.md
chapters/
characters/
  roster.md
world/
  rules.md
memory/
  recent_summary.md
  global_summary.md
  archive_summary.md
  chapter_index.json
  plot_options.json
  story_threads.json
  entities.json
  open_loops.json
  continuity_warnings.json
  open_loops.md
  character_state.md
  world_state.md
  forgetting_log.md
  chapters/
logs/
```

项目源码结构见 [docs/project-structure.md](/Users/yulan233/Desktop/project/ai_project/ainovel/docs/project-structure.md)。

## 开发

安装依赖：

```bash
npm install
```

运行 CLI：

```bash
npm start
node src/index.js help
```

运行测试：

```bash
npm test
```

测试使用 Node 内置 `node:test`。修改 CLI 行为、项目文件写入逻辑、记忆与 plot 状态流转时，建议补对应回归测试到 [`tests/`](/Users/yulan233/Desktop/project/ai_project/ainovel/tests)。

## 文档

- [docs/tui.md](/Users/yulan233/Desktop/project/ai_project/ainovel/docs/tui.md)
- [docs/project-structure.md](/Users/yulan233/Desktop/project/ai_project/ainovel/docs/project-structure.md)
- [docs/prompt-input-flow.md](/Users/yulan233/Desktop/project/ai_project/ainovel/docs/prompt-input-flow.md)

## 注意事项

- 建议将 `.env`、`logs/`、临时测试目录和本地生成文件排除出版本控制
- 这是一个文件驱动项目，日常备份和版本管理都可以直接使用 Git
- 如果 README 与命令行为不一致，以 `ainovel help` 和源码实现为准
