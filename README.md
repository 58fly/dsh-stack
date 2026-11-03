# dsh-stack

DeepSeek Stack 模式（`ds-stack`）agent 预设，以可装卸 bundle 的形式分发。

仓库：[58fly/dsh-stack](https://github.com/58fly/dsh-stack) · 技能来源：[aicodeking/deepseek-stack](https://github.com/aicodeking/deepseek-stack)（MIT，见 [NOTICE.md](NOTICE.md)）· 上游预设：[TonyZiYuan/dsh-ds-stack-preset](https://github.com/TonyZiYuan/dsh-ds-stack-preset)

[aicodeking/deepseek-stack](https://github.com/aicodeking/deepseek-stack) 是一套 `SKILL.md` 技能包：它不开新框架，只给廉价模型补上四个常见缺口——不先计划、没跑就说修好了、同一思路反复重试、长任务跑偏。这套东西在 DSH 里只缺两样：一个是**常驻**（技能只有被 `skill` 工具加载后才生效，而 ds-mode 自称 always-on），一个是**硬边界**（散文规则在长会话里会漂移）。本预设补的就是这两样，其余原样搬过来。

## 上游 → 本预设

| 上游提供 | 本预设里变成 | 位于 |
|---|---|---|
| `ds-mode`（「始终生效」的工作风格） | 常驻人格 `persona.prefix`（规则压缩，非全文） | `preset/agent.cordis.yml` |
| 29 个 `ds-*` 技能 | 原样随包分发的技能目录 | `preset/skills/` |
| 「改完必须跑验证」 | 轮次收尾检查：改了文件但之后没有成功检查 → 打回继续 | `preset/ds-loop.mjs` |
| 「同一修法错两次就停」 | 轮次收尾检查：连续 2 次失败 → 打回换前提 | `preset/ds-loop.mjs` |
| `npx skills add` | DSH bundle（`cordis.patch.yml` + 预设声明） | 本目录 |

除上述三处，工具目录、沙箱、审批、压缩、子代理都与内置 `standard` 预设逐行一致——本预设不改变 Agent 能做什么，只改变它的工作方式。

## 组成

- `cordis.patch.yml` — bundle 补丁：插入一条 `@deepseek-ai/dsh-agent-preset` 声明（`preset-ds-stack`，显示名「DeepSeek Stack 模式」，order 6）。
- `preset/agent.cordis.yml` — 预设组合本体：人格、技能根、循环守卫、shell/文件/任务/目标/计划/压缩/委派等行。
- `preset/ds-loop.mjs` — 两个轮次收尾守卫（见下）。
- `preset/skills/` — 上游 29 个技能，逐字节保留。

## 安装

**首选 npm 源**（版本号可追溯，插件页的更新提示显示 `0.1.0` 这样的版本号）：

```
plugin_manager({ action: "install_bundle", target: "dsh-stack" })
```

或用 npm 直接装进 profile：

```
npm install dsh-stack
```

再把 `dsh-stack` 加进 profile `package.json` 的 `dsh.profile.bundles`。

**备选 Git 源**（跟随 main 分支最新提交，适合要试未发布改动时）：

```
plugin_manager({ action: "install_bundle", target: "https://github.com/58fly/dsh-stack" })
```

差异：宿主对 Git 源安装的更新检查走 `git ls-remote -- <repo> HEAD`，commit 就是它的版本标识，所以插件页的「有新版本」会显示 commit SHA（如 `afaa2ac`）而不是版本号。要能看出「装的是哪个版本」，用 npm 源。

安装即注册 `preset-ds-stack`。预设只在**新会话**且会话仍为空白时可选；已在跑的会话保留它启动时的组合。

## 用法

- 新建会话时选「DeepSeek Stack 模式」，人格立刻生效。
- 首轮会带上一份 29 条技能的目录（每条摘要上限 400 字符，整份约 6.8k 字符 ≈ 1.7k token 的固定前缀）；模型按任务自行 `skill` 加载，你也可以直接发 `/ds-plan-loop`、`/ds-verify-loop`、`/ds-unstick` 这类手势。
- `/ds-help` 让模型自己挑技能。

## 两个守卫（ds-loop）

在 `agent/turn-stopping`（轮次即将关闭、尚未提交）时读取本轮的持久事件日志，命中规则就 `steer` 一条短消息，让这一轮再跑一步：

1. **改完没验证**：本轮出现过成功的文件改动（`write` / `edit`），但之后没有任何成功的 shell 检查（`bash` / `pwsh`）。提示语会带上**仍未被证明**的文件路径（已经被更早的检查覆盖的不列），要求跑最小可证明的命令，或一行说明为什么跑不了。
2. **两次失败**：本轮末尾连续 ≥2 次工具结果失败。提示语要求停止试第三个变体，改为验证失败尝试共同的前提。

设计边界：

- 每个轮次最多打回 2 次（`maxSteersPerTurn`）；**第二次措辞更硬**，明确指出「你已经第二次在没证据的情况下结束」，因为第一次的礼貌版显然没被采纳。限次仍在，守卫不会形成循环。
- shell 结果只算「验证」，不算「改动」——`sed -i … && npm test` 这种一条命令里改加验不会被误判。
- 纯文档改动（`.md` / `.txt` 等）豁免第一条：没有命令能证明 README 改对了。改代码 + 改文档混在一起时不豁免。
- 纯问答轮次、计划模式轮次没有文件改动，不会触发。
- 守卫内部异常只记一次日志，绝不阻断轮次收尾。

可调字段（`preset/agent.cordis.yml` 里 `ds-loop` 行）：

| 字段 | 默认 | 含义 |
|---|---|---|
| `evidence` | `true` | 启用「改完没验证」检查 |
| `unstick` | `true` | 启用「连续失败」检查 |
| `failStreak` | `2` | 连续失败阈值 |
| `maxSteersPerTurn` | `2` | 单轮最多打回次数（第二次措辞更硬） |
| `includeSubagents` | `true` | 子代理是否同样受检 |
| `mutationTools` | `[write, edit]` | 算作「改动」的工具名，只含宿主真实注册的 |
| `checkTools` | `[bash, pwsh]` | 算作「验证」的工具名，只含宿主真实注册的 |
| `documentationSuffixes` | `[.md, .mdx, .txt, .rst, .adoc]` | 改动文件**全部**是这些后缀时豁免「改完没验证」 |

## 边界与注意

- **技能根用 `customSkillDirs`（rank 300），不是 `bundledSkillDir`**：前者是追加，项目级（100/200）仍优先、用户自己的技能（400/500）仍加载、部署自带的 bundled 根不被顶掉；后者会整体替换部署默认值。代价是：若你在 `~/.dsh/skills` 里放了同名 `ds-*`，本包的版本会赢（内容相同，通常无感）。
- **不自动跟随上游更新**：升级技能的办法是重新镜像上游 `skills/` 覆盖 `preset/skills/`，本包不改写技能内容，因此不会有合并冲突。
- **技能目录会造成每轮固定成本**：摘要计 29 条、合计 6830 字符（≈1708 token），作为持久前缀每轮都会重发。想更省，删掉不用的技能目录即可（目录是唯一事实来源，删了就不会出现在目录里），或把 `catalogDescriptionMaxLength` 调小——但上游把「Use when …」放在每条描述末尾，截断会先丢掉最关键的触发条件。
- **守卫没有平台分支**：Windows 上 shell 工具名是 `pwsh`，已在 `checkTools` 默认值里；如果你关掉 `tool-pwsh` 换成别的执行器，记得同步这个列表，否则守卫静默失效。
- **`bash` 可以绕过第一条守卫**：一条 `bash` 同时写文件并跑命令时，它只被算作「验证」。这是有意的取舍（否则 `sed -i && npm test` 会误报），代价是「全程用 bash 改文件」的工作方式不受约束。

## 自检

全部检查零依赖，Node ≥ 22 即可：

```
npm test
```

| 命令 | 检查什么 |
|---|---|
| `node test/ds-loop.test.mjs` | 守卫行为，17 条断言 |
| `node test/preset.test.mjs` | 装配静态断言，12 条（人格在、守卫配置与模块默认值一致、禁用行没被改） |
| `node scripts/verify-preset.mjs` | 装配完整性：include 路径 = 包名 + 目录、技能根走 baseUrl、目录上限容得下最长描述 |
| `node scripts/verify-skills.mjs` | 技能合法性：frontmatter、目录名 ↔ `name`、描述长度、29 个 `/ds-*` 交叉引用无死链 |
| `node scripts/verify-manifest.mjs` | manifest 与发包产物：白名单、`engines`、`npm pack` 实际内容 |
| `node scripts/verify-host-api.mjs` | 宿主私有契约：`agent/turn-stopping`、`agent.steer`、`session.snapshotEvents`、工具名注册表（没装 DSH 时 SKIP） |

发布前另有 `scripts/verify-release.mjs`：工作区干净、tag 与版本对齐、CHANGELOG 有当前版本小节。

## 装在这里的意义

若 profile 以 `link:`（junction / symlink）方式安装本 bundle，那么**改本目录的文件即改预设**：下一次新建会话就取到新内容，不必重装；已存在的会话保留它启动时的组合。

## 维护

本仓库自行维护，不跟随上游自动更新。发布流程与目录规范见 [AGENTS.md](AGENTS.md)，版本变化见 [CHANGELOG.md](CHANGELOG.md)。
