# ainovel

`ainovel` 是一个本地优先的 AI 小说 CLI，覆盖大纲、章节规划、正文生成、长期记忆和全屏 TUI 写作工作流。

## Install

在仓库根目录执行：

```bash
npm install
npm link
```

然后可以在任意小说项目目录中使用 `ainovel`。

## Quick Start

```bash
ainovel init demo
cd demo
cp .env.example .env
# 编辑 .env
ainovel doctor
ainovel outline "强化朝堂博弈"
ainovel guid
ainovel chapter plan 001
ainovel chapter write 001
ainovel tui
```

示例 `.env`：

```bash
AINOVEL_API_KEY=your_api_key_here
AINOVEL_BASE_URL=https://api.openai.com/v1
AINOVEL_MODEL=gpt-4.1-mini
```

没有 API 配置时，`ainovel` 会回退到本地模板模式，便于离线验证流程。

## Core CLI Flow

常用命令：

```bash
ainovel doctor
ainovel config
ainovel status
ainovel outline
ainovel outline "强化宿命感和权谋线"
ainovel guid
ainovel outline revise "把主角动机改得更强"
ainovel chapter list
ainovel chapter plan 001
ainovel chapter write 001
ainovel chapter revise 001 "结尾悬念更强"
ainovel chapter rewrite 001 "强化冲突升级"
ainovel chapter next plan
ainovel chapter next write
ainovel memory rebuild
ainovel context 001
ainovel plot generate chapter 001
ainovel plot generate book
ainovel plot thread <thread-id>
ainovel plot resolve <thread-id> 003
ainovel memory tags 001
ainovel memory search --tag clue
ainovel export --txt
ainovel export --epub
ainovel tui
```

## TUI Guide

`ainovel tui` 提供左侧转录区、右侧状态/上下文/详情栏，以及底部输入区。

输入与导航：

- `Enter` 提交输入
- 输入 `/` 显示 slash 命令建议
- `Tab` 补全当前建议
- `↑/↓` 切换最近 10 条已提交命令
- `PgUp/PgDn` 滚动左侧消息区
- `Ctrl+O` 打开或关闭详情面板
- `←/→` 在详情视图之间切换
- `Esc` 关闭详情面板；如果处于 plot 快捷态，则先退出 plot 快捷态
- `Ctrl+C` 停止当前生成；空闲时退出 TUI

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

说明：

- `/init`：在当前 TUI 工作目录初始化项目
- `/guid`：按步骤引导输入世界观、主角、目标和冲突，最后统一生成大纲
- `/outline [要求]`：快速生成大纲，适合已经知道想强调什么的时候直接附加要求

## Plot Workflow

剧情推荐支持 CLI 和 TUI 两种用法。

CLI：

```bash
ainovel plot generate chapter 001
ainovel plot generate book
ainovel plot list
ainovel plot apply <option-id>
ainovel plot thread <thread-id>
ainovel plot resolve <thread-id> [chapter-id]
```

TUI：

1. 执行 `/plot chapter 001` 或 `/plot book`
2. 右侧 `Detail / plot` 会显示最近一组剧情建议，以及当前生效的剧情线程、作用章节和结束条件
3. 使用 `↑/↓` 或数字键 `1-3` 切换当前建议
4. 使用 `Enter` 或 `a` 应用，`k` 保留，`d` 放弃

这样在 TUI 里不需要再手输时间戳型长 `id`。

## Project Structure

仓库源码结构：

```text
src/
  index.js
  lib/
    cli.js
    input.js
    plot.js
    project.js
    tui.js
    tui/
      history.js
      plot-session.js
tests/
docs/
```

`ainovel init <name>` 生成的小说目录结构：

```text
project.yaml
style.md
outline/
chapters/
characters/
world/
memory/
  chapters/
  plot_options.json
logs/
```

更详细说明见：

- [docs/tui.md](/Users/yulan233/Desktop/project/ai_project/ainovel/docs/tui.md)
- [docs/project-structure.md](/Users/yulan233/Desktop/project/ai_project/ainovel/docs/project-structure.md)

## Development

运行测试：

```bash
npm test
```

建议忽略本地噪音文件：`node_modules/`、`.DS_Store`、测试临时目录和本地 `.env`。
