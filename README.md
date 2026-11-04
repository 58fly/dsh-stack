# dsh-stack

dsh-stack模式（`dsh-stack`）agent 预设，以可装卸 bundle 的形式分发。

仓库：[58fly/dsh-stack](https://github.com/58fly/dsh-stack) · 技能来源：[aicodeking/deepseek-stack](https://github.com/aicodeking/deepseek-stack)（MIT，见 [NOTICE.md](NOTICE.md)）

[aicodeking/deepseek-stack](https://github.com/aicodeking/deepseek-stack) 是一套 `SKILL.md` 技能包：它不开新框架，只给廉价模型补上四个常见缺口——不先计划、没跑就说修好了、同一思路反复重试、长任务跑偏。这套东西在 DSH 里只缺两样：一个是**常驻**（技能只有被 `skill` 工具加载后才生效，而 st-mode 自称 always-on），一个是**硬边界**（散文规则在长会话里会漂移）。本预设补的就是这两样，其余原样搬过来。

## 技能包 → 本预设

| 技能包提供 | 本预设里变成 | 位于 |
|---|---|---|
| `st-mode`（「始终生效」的工作风格） | 常驻人格 `persona.prefix`（规则压缩，非全文） | `preset/agent.cordis.yml` |
| 29 个 `st-*` 技能 | 原样随包分发的技能目录 | `preset/skills/` |
| 「改完必须跑验证」 | 轮次收尾检查：改了文件但之后没有成功检查 → 打回继续 | `preset/st-loop.mjs` |
| 「同一修法错两次就停」 | 轮次收尾检查：连续 2 次失败 → 打回换前提 | `preset/st-loop.mjs` |
| `npx skills add` | DSH bundle（`cordis.patch.yml` + 预设声明） | 本目录 |

除上述三处，工具目录、沙箱、审批、压缩、子代理都与内置 `standard` 预设逐行一致——本预设不改变 Agent 能做什么，只改变它的工作方式。

## 组成

- `cordis.patch.yml` — bundle 补丁：插入一条 `@deepseek-ai/dsh-agent-preset` 声明（`preset-dsh-stack`，显示名「dsh-stack模式」，order 6）。
- `preset/agent.cordis.yml` — 预设组合本体：人格、技能根、循环守卫、shell/文件/任务/目标/计划/压缩/委派等行。
- `preset/st-loop.mjs` — 两个轮次收尾守卫（见下）。
- `preset/skills/` — 技能来源的 29 个技能，逐字节保留。

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

安装即注册 `preset-dsh-stack`。预设只在**新会话**且会话仍为空白时可选；已在跑的会话保留它启动时的组合。

## 快速上手

### 三步

1. 装（见上），装完即注册 `preset-dsh-stack`。
2. **新建**一个空会话，选择器里选「dsh-stack模式」。已在跑的会话不会切换。
3. 直接说你要做什么。**不需要提技能名**——人格会在任务匹配时自己加载。

第一句话给三样东西最省事：**目标、约束、怎么算做完**。

```
把 lib/parse.mjs 的 CSV 解析改成分块读，内存不能被文件大小放大。
做完用一个 500MB 的样本跑一遍，看峰值 RSS。
```

对比一句「帮我优化下解析性能」——后者的下场是模型先猜你的意思，猜错了你还得重来一次。想省那一轮，用 `/st-sharpen` 或干脆自己把上面三样补齐。

### 怎么确认它在工作

| 现象 | 说明 |
|---|---|
| 打开会话就能看到 `st-stack checkpoint — this turn edited …` 这类消息 | 守卫在打回。它是正常行为，不是报错（见下节） |
| 模型先复述任务、再读文件、改完立刻跑命令 | 人格生效 |
| 技能目录出现在首轮上下文里 | 29 条技能的摘要（约 1.7k token 的固定前缀）已注入 |
| 想验证预设版本 | `node -p "require('dsh-stack/package.json').version"`（在 profile 目录下） |

改了预设文件后**必须重启 DSH**：主进程在安装时把组合树读进内存，运行中不重读磁盘。

## 什么时候用哪个技能

技能只在被加载后生效；29 条里大部分你永远不用主动点名——说清楚要干什么，模型会挑。这张表是给你「卡住时该点哪个」用的。

### 开工前

| 你的处境 | 手势 |
|---|---|
| 需求说不清、怕做错方向 | `/st-sharpen` |
| 要动多个文件、步骤容易漏 | `/st-plan-loop` |
| 想先定类型和模块形状再写 | `/st-blueprint` |
| 拿不准哪种做法好，想看几个版本 | `/st-best-of-n` |

### 写的时候

| 你的处境 | 手势 |
|---|---|
| 修 bug，要一条能挡住复发的测试 | `/st-tdd` |
| 改完了，要它自己跑到验证通过 | `/st-verify-loop` |
| 改动有风险，想知道会连带坏什么 | `/st-blast-radius` |
| **同一招失败两次了** | `/st-unstick` |
| 新建页面/组件，不要那股 AI 味 | `/st-design` |
| 现有界面看着糙，想按证据改 | `/st-design-audit` |

### 交付

| 你的处境 | 手势 |
|---|---|
| 提交前想让它自审一轮 | `/st-review-loop` |
| 只要开个 PR | `/st-pr` |
| 一路做到合并（它自己合） | `/st-ship` |
| 一路做到 PR 可合，但**人来点合并** | `/st-ready` |
| 让它在旁边盯 CI 和 review | `/st-watch-pr` |
| 它要在 PR 上替你留言 | `/st-pr-comments` |

### 长任务与并行

| 你的处境 | 手势 |
|---|---|
| 多阶段长跑，怕跑偏 | `/st-ledger` |
| 上下文过半、模型开始重复 | `/st-context-reset` |
| 离开很久回来问「到哪了」 | `/st-catchup` |
| 铺开 N 路并行扫一遍 | `/st-swarm` |
| 要几个模型独立评审再收敛 | `/st-jury` |

### 接手与复盘

| 你的处境 | 手势 |
|---|---|
| 接手别人的 PR / 分支 / 会话 | `/st-adopt` |
| 老 PR 要 rebase，或判断还该不该做 | `/st-revive` |
| 同一类错误第三次出现了 | `/st-lessons` |
| 文案/注释要去 AI 味 | `/st-unslop` |
| 想让人讲清一段代码 | `/st-explain` |
| 不知道用哪个 | `/st-help` |

## 四个例子

### 例 1：含糊需求，先收窄再动手

```
你：这个模块最近老出问题，帮我看看
```

模型不该直接改。合理的开场是复述 + 收窄（`/st-sharpen` 做的就是这件事）：

```
你：这个模块最近老出问题，帮我看看
模型：先确认范围——「老出问题」指的是报错、数据不对，还是变慢？
     仓库里 src/ingest/ 近三周有 6 次修复提交，都指向同一个重试分支。
     如果确认是它，我打算先写一条能复现的测试，再动逻辑。
你：数据不对，就是重试那块
```

### 例 2：改完没验证，被守卫打回

这是你**会真实看到**的消息，一字不差来自 `preset/st-loop.mjs`：

```
st-stack checkpoint — this turn edited `lib/parse.mjs` but ran no successful
check afterwards. Run the smallest command that proves the change (the test,
the build, or the program itself), then report its result in the same message
as the claim. If no check is possible here, say so in one line and name
exactly what you could not verify.
```

它拦的是「改完就说好了」。注意三点：

- 只列**还没被证明**的文件。如果本轮先改 `a.mjs`、跑过测试、又改 `b.mjs`，它只提 `b.mjs`。
- 纯文档改动（`.md` / `.txt` 等）不触发——没有命令能证明 README 改对了。
- 一轮最多打回 2 次，第二次措辞更硬（直接说「你已经第二次在没证据的情况下结束」）。

你**想放行**时不用关守卫：让它跑一条读回文件的命令即可，守卫认的是「跑过一条成功的命令」。

### 例 3：长任务，主动换气

```
你：/st-context-reset
```

模型会先写一份 `PROGRESS.md`（目标、已完成、下一步、决定过什么），再在新会话或子代理里只读这一份继续。适合：任务跨很多步、模型开始忘事、或上下文过半。

不想手动操心的话用 `/st-ledger`：每次决定记一行，每步开始前先读回去，长跑不容易飘。

### 例 4：交付前，让它自己先审

```
你：/st-review-loop
```

作者视角 + 全新上下文的评审视角，最多四轮，直到两边都认同一件事是对的。比「直接开 PR 等人挑刺」便宜得多。

之后按需要选 `/st-ready`（做到可合，人来点合并）或 `/st-ship`（它自己合）。

## 技巧

1. **手势和自然语言等价，但手势更确定**。「帮我看看这个 PR 能不能合」和 `/st-ready` 通常走同一条路；卡住时用手势，模型不会挑错。
2. **人格是常驻的，技能是加载的**。上面 29 条里除了 `st-mode`（人格已内化），其余都要被调用才生效。所以「装好了但没感觉」通常是没触发任务——把任务说具体就会触发。
3. **先给验收标准，能省一整轮**。「做完跑 `npm test` 全绿」比「做完告诉我」少一次来回。
4. **不要一次给三个目标**。人格里写着「一次一个改动」，同时推进三件事会让它自己在中间反复权衡。
5. **觉得技能目录太贵就删目录**。29 条摘要约 1.7k token，每轮重发；删掉不用的技能目录，它就不会出现在目录里。别去调小 `catalogDescriptionMaxLength`——技能包原文把「Use when …」放在描述末尾，截断先丢触发条件。
6. **子代理默认也被守卫管**（`includeSubagents: true`）。分派出去的活儿同样要求「改完有证据」。
7. **Windows 上检查工具是 `pwsh`**，已在默认值里；换执行器要同步 `checkTools`，否则守卫静默失效。

## 反模式

| 别这么干 | 原因 |
|---|---|
| 用 `bash` 一把梭改文件再跑命令 | 一条 `bash` 只算「验证」，不算「改动」，第一条守卫管不到（这是有意的取舍，否则 `sed -i && npm test` 会误报） |
| 指望它记住上一次会话的结论 | 预设不跨会话传递；接力用 `PROGRESS.md`（`/st-context-reset`）或跑 `/st-catchup` |
| 改了 `preset/agent.cordis.yml` 就期待立刻生效 | 要重启 DSH |
| 在已有会话里换预设 | 不支持，只在空白新会话可选 |
| 一次贴几千行日志让它「自己看」 | 人格要求「只读需要的那段」，贴太多反而稀释判断 |

## 两个守卫（st-loop）

在 `agent/turn-stopping`（轮次即将关闭、尚未提交）时读取本轮的持久事件日志，命中规则就 `steer` 一条短消息，让这一轮再跑一步：

1. **改完没验证**：本轮出现过成功的文件改动（`write` / `edit`），但之后没有任何成功的 shell 检查（`bash` / `pwsh`）。提示语会带上**仍未被证明**的文件路径（已经被更早的检查覆盖的不列），要求跑最小可证明的命令，或一行说明为什么跑不了。
2. **两次失败**：本轮末尾连续 ≥2 次工具结果失败。提示语要求停止试第三个变体，改为验证失败尝试共同的前提。

设计边界：

- 每个轮次最多打回 2 次（`maxSteersPerTurn`）；**第二次措辞更硬**，明确指出「你已经第二次在没证据的情况下结束」，因为第一次的礼貌版显然没被采纳。限次仍在，守卫不会形成循环。
- shell 结果只算「验证」，不算「改动」——`sed -i … && npm test` 这种一条命令里改加验不会被误判。
- 纯文档改动（`.md` / `.txt` 等）豁免第一条：没有命令能证明 README 改对了。改代码 + 改文档混在一起时不豁免。
- 纯问答轮次、计划模式轮次没有文件改动，不会触发。
- 守卫内部异常只记一次日志，绝不阻断轮次收尾。

可调字段（`preset/agent.cordis.yml` 里 `st-loop` 行）：

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

- **技能根用 `customSkillDirs`（rank 300），不是 `bundledSkillDir`**：前者是追加，项目级（100/200）仍优先、用户自己的技能（400/500）仍加载、部署自带的 bundled 根不被顶掉；后者会整体替换部署默认值。代价是：若你在 `~/.dsh/skills` 里放了同名 `st-*`，本包的版本会赢（内容相同，通常无感）。
- **技能内容不改写**：升级技能的办法是把技能来源的 `skills/` 重新镜像到 `preset/skills/`，本包不修改技能正文，因此不会有合并冲突。
- **技能目录会造成每轮固定成本**：摘要计 29 条、合计 6830 字符（≈1708 token），作为持久前缀每轮都会重发。想更省，**删掉不用的技能目录**（目录是唯一事实来源，删了就不会出现在目录里）；不要靠调小 `catalogDescriptionMaxLength`——技能包原文把「Use when …」放在每条描述末尾，截断先丢的正是触发条件，而这笔 token 花的就是触发能力。
- **守卫没有平台分支**：Windows 上 shell 工具名是 `pwsh`，已在 `checkTools` 默认值里；如果你关掉 `tool-pwsh` 换成别的执行器，记得同步这个列表，否则守卫静默失效。
- **`bash` 可以绕过第一条守卫**：一条 `bash` 同时写文件并跑命令时，它只被算作「验证」。这是有意的取舍（否则 `sed -i && npm test` 会误报），代价是「全程用 bash 改文件」的工作方式不受约束。

## 自检

全部检查零依赖，Node ≥ 22 即可：

```
npm test
```

| 命令 | 检查什么 |
|---|---|
| `node test/st-loop.test.mjs` | 守卫行为，17 条断言 |
| `node test/preset.test.mjs` | 装配静态断言，13 条（人格在、守卫配置与模块默认值一致、禁用行没被改、提示词变量都在宿主注册表里） |
| `node scripts/verify-preset.mjs` | 装配完整性：include 路径 = 包名 + 目录、技能根走 baseUrl、目录上限容得下最长描述 |
| `node scripts/verify-skills.mjs` | 技能合法性：frontmatter、目录名 ↔ `name`、描述长度、29 个 `/st-*` 交叉引用无死链 |
| `node scripts/verify-manifest.mjs` | manifest 与发包产物：白名单、`engines`、`npm pack` 实际内容 |
| `node scripts/verify-host-api.mjs` | 宿主私有契约：`agent/turn-stopping`、`agent.steer`、`session.snapshotEvents`、工具名注册表（没装 DSH 时 SKIP） |

发布前另有 `scripts/verify-release.mjs`：工作区干净、tag 与版本对齐、CHANGELOG 有当前版本小节。

装好的副本（`node_modules/dsh-stack`）同样能跑上面的命令——`scripts/` 也在包里。`verify-release` 例外：它要读 Git 历史，在装机副本里会直接报「不是 git 仓库」并以非零码退出，这是预期行为。

## 装在这里的意义

若 profile 以 `link:`（junction / symlink）方式安装本 bundle，那么**改本目录的文件即改预设**：下一次新建会话就取到新内容，不必重装；已存在的会话保留它启动时的组合。

## 维护

本仓库自行维护。版本变化见 [CHANGELOG.md](CHANGELOG.md)；发布流程与目录规范属于维护者本地约定，不随仓库公开。
