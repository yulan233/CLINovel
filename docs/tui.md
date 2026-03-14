# TUI Guide

## Layout

- 左侧：转录区，显示用户输入、系统事件、流式输出
- 右侧：状态、上下文 token 使用、详情面板
- 底部：摘要栏、输入框、slash 建议

## Key Bindings

- `Enter`: 提交输入
- `Tab`: 补全当前 slash 建议
- `↑/↓`: 浏览最近 10 条命令历史
- `PgUp/PgDn`: 滚动转录区
- `Ctrl+O`: 打开/关闭详情面板
- `←/→`: 切换详情视图
- `Esc`: 关闭详情面板；如果 plot 快捷态打开，则先退出 plot 快捷态
- `Ctrl+C`: 停止当前任务；空闲时退出

## Init And Outline

- `/init`: 在当前目录初始化小说项目
- `/outline [要求]`: 快速生成大纲；适合直接补一句“强化权谋线”“结局更黑暗”等要求
- `/guid`: 进入引导式大纲模式，依次采集题材、世界规则、主角处境、目标代价、冲突与结局倾向

`/guid` 模式下：

- 直接输入当前问题的答案即可
- `/skip` 或 `跳过`: 略过当前题
- `/back`: 在最终确认阶段返回上一题
- `/cancel`: 取消本次引导
- 收集完所有答案后，输入 `生成` 开始统一生成 `story/arcs/characters/world` 四份大纲文件

## Plot Quick Actions

执行 `/plot chapter [chapter]` 或 `/plot book` 后，TUI 会进入 plot 快捷态：

- 右侧 `Detail / plot` 显示最近一组剧情建议
- 每条建议使用短编号 `1/2/3`
- `↑/↓` 或数字键 `1-3` 切换当前建议
- `Enter` 或 `a`：应用当前建议
- `k`：保留当前建议
- `d`：放弃当前建议
- `Esc`：退出 plot 快捷态

plot 快捷态只在输入框为空时接管按键，避免影响正常输入。
