# NOTICE — 上游来源与改动

本 bundle 参照 [aicodeking/deepseek-stack](https://github.com/aicodeking/deepseek-stack)（MIT，Copyright (c) 2026 AICodeKing）建立，并非逐字复制。

## 原样保留

`preset/skills/` 下的 29 个技能目录（含 `ds-watch-pr/scripts/watch_pr.py`）与上游 `skills/` 逐字节一致，前端元数据（`name` / `description`）未改动。因此：

- 上游更新后，用同样的镜像方式覆盖 `preset/skills/` 即可跟进；本 bundle 不做任何改写，不会产生合并冲突。
- 技能的说明文字是上游作者写给「廉价模型」的口吻，其中的 `/ds-*` 手势在 DSH 里同样可用（由 `dsh-tool-skill` 渲染为 `/ds-mode` 这类命令）。

## 有改动

| 上游 | 本预设 | 原因 |
|---|---|---|
| `skills/ds-mode/SKILL.md`（需 `skill` 工具加载后才生效） | `preset/agent.cordis.yml` 的 `persona.prefix`（常驻系统提示） | ds-mode 自称 "always-on working style"，但作为技能只能在模型主动加载后才生效；把它的规则压缩成人格文本，才真正做到常驻。技能原文仍随包分发，`/ds-mode` 依然可用。 |
| 两条口头规则："改完必须跑真实验证"、"同一修法错了两次就停" | `preset/ds-loop.mjs`（`agent/turn-stopping` 钩子） | 长会话里散文规则会漂移；这两条被改成轮次收尾时的硬检查。逻辑是新增代码，不是上游内容。 |
| 安装方式 `npx skills add ...`（写入 `~/.claude/skills/` 等目录） | DSH bundle（`cordis.patch.yml` + `dsh.profile.bundles`） | 让技能随预设走，不污染用户的全局技能目录。 |

上述改动文件按本仓库的 MIT 许可发布，详见 `LICENSE`。
