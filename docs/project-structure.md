# Project Structure

## Repository

```text
src/
  index.js              CLI 入口
  lib/
    cli.js              命令分发与主流程
    input.js            自然语言和 slash 命令解析
    plot.js             剧情推荐持久化与状态变更
    project.js          项目初始化与路径解析
    tui.js              TUI 主入口与公共渲染工具
    tui/
      history.js        命令历史浏览逻辑
      plot-session.js   plot 短编号与快捷态管理
tests/                  单元测试
docs/                   使用与结构文档
```

## Generated Novel Workspace

`ainovel init <name>` 会创建一个文件驱动的小说工程：

```text
project.yaml
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
  plot_options.json
  story_threads.json
  entities.json
  open_loops.json
  continuity_warnings.json
  chapters/
logs/
```

设计原则：

- 源码仓库和小说工作区分离
- 小说数据全部保存在普通文本或 JSON 文件中
- TUI 专属状态不写入磁盘，plot 推荐结果和采纳意图才持久化
