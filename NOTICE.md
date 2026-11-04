# NOTICE — 上游来源与改动

本 bundle 参照 [aicodeking/deepseek-stack](https://github.com/aicodeking/deepseek-stack)（MIT，Copyright (c) 2026 AICodeKing）建立，并非逐字复制。

## 正文保留、标识改名

`preset/skills/` 下的 29 个技能目录来自上游 `skills/`，**正文逐字未改**，只做了三件事：

1. 目录名 `ds-*` → `st-*`（29 个）；
2. frontmatter 的 `name:` 同步改名；
3. 正文里指向别的技能的 `/ds-xxx` 手势改成 `/st-xxx`（共 34 处，不涉及任何散文改动）。

改名原因：本预设与上游预设可以并存安装，而两边技能原先全部叫 `ds-*`，肉眼无法分辨哪个是哪个。

- 上游更新后，`rsync` 覆盖回来再跑一遍改名脚本即可跟进；技能正文不会产生合并冲突。
- 技能说明文字仍是上游作者写给「廉价模型」的口吻，其中的 `/st-*` 手势由 `dsh-tool-skill` 渲染成 `/st-mode` 这类命令。

## 有改动

| 上游 | 本预设 | 原因 |
|---|---|---|
| `skills/ds-mode/SKILL.md`（需 `skill` 工具加载后才生效） | `preset/agent.cordis.yml` 的 `persona.prefix`（常驻系统提示） | st-mode 自称 "always-on working style"，但作为技能只能在模型主动加载后才生效；把它的规则压缩成人格文本，才真正做到常驻。技能原文仍随包分发，`/st-mode` 依然可用。 |
| 两条口头规则："改完必须跑真实验证"、"同一修法错了两次就停" | `preset/st-loop.mjs`（`agent/turn-stopping` 钩子） | 长会话里散文规则会漂移；这两条被改成轮次收尾时的硬检查。逻辑是新增代码，不是上游内容。 |
| 安装方式 `npx skills add ...`（写入 `~/.claude/skills/` 等目录） | DSH bundle（`cordis.patch.yml` + `dsh.profile.bundles`） | 让技能随预设走，不污染用户的全局技能目录。 |

上述改动文件按本仓库的 MIT 许可发布，详见 `LICENSE`。
