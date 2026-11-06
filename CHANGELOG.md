# 更新日志

本文件记录 `dsh-stack` 的用户可感知变化。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

分类固定为：**新增 / 修复 / 变更 / 文档 / 移除**。条目写「用户能感知到什么」，内部重构不单独成条。

## [0.3.0] - 2026-11-06

**本次修复一个会让宿主完全用不了的问题：把本预设设为默认之后，停用或卸载本插件，DSH 会新建不了会话。** 现在停用是安全的、卸载有专门命令、已经崩过也能一条命令救回来。

### 新增

- **`npx dsh-stack` 命令**，三个子命令：
  - `status` 看每个 profile 里本插件是否可用、默认预设指向谁；
  - `doctor` 体检悬空指针、残留的 bundle/依赖/目录/lock，`--fix` 修复，`--sessions` 一并清理旧会话缓存的预设标记；
  - `uninstall` 优雅卸载：**先收默认预设指针，再删 bundle 登记、依赖声明与目录**，顺序反过来就会留下宿主崩溃的窗口。
- **`scripts/verify-mount.mjs`**：把包按真实安装形态铺进临时 profile，交给宿主装载器解析，确认补丁里两条相对路径都落在正确的文件上（9 项，没装 DSH 时 SKIP）。改动 `cordis.patch.yml` 后跑它，能提前发现「装完加载失败」。
- **卸载守卫 `preset/uninstall-guard.mjs`**，随 bundle 挂在 profile 根。停用、卸载、热重载时它会在 fiber 销毁前把悬空指针收回 `standard`；插件重新可用后，如果你没有另选过预设，它会把你原来的选择恢复回来。

### 修复

- **停用或卸载后新建会话直接失败**（`agent-preset/not-found`）。原因：宿主只在用户切换预设时写「当前默认预设」这个指针，停用 bundle 时只删 bundle 登记、卸载时只删目录，指针留在原地；下次新建会话解析它就会抛错，而这条调用路径没有兜底，用户看到的是整个应用起不了会话。现在这个指针由本插件在离开前主动收回。
- **旧会话打不开**是同一个指针的第二处落点：会话的预设记在投影缓存里，插件走了缓存还留着 id。`doctor --sessions` / `uninstall` 会把它降级为 `standard`，只改这一个字段，不动会话正文与标题。

### 变更

- `package.json` 增加 `bin` 声明，`bin/` 进入发包白名单（装完才有命令可用）。包体从 46 文件 / 75 KB 变成 51 文件 / 102 KB（解包 280 KB）。

### 文档

- README 新增「停用与卸载」（英文版对应章节同步），写清三条路径：正常停用（自动处理）、卸载前先跑 `uninstall`（推荐）、已经崩过跑 `doctor --fix`。
- 新增决策 `docs/decisions/06-卸载守卫挂在-profile-根.md`（为什么挂在 profile 根而不是预设里、为什么不做 Web 按钮）；新增 `issues/08-停用插件导致新建会话失败.md` 留档。

## [0.2.0] - 2026-11-04

**破坏性变更：29 个技能的手势从 `/ds-*` 全部改为 `/st-*`，预设 id 从 `ds-stack` 改为 `dsh-stack`。** 你之前记住的 `/ds-tdd`、`/ds-ship` 这类命令不再存在，改用 `/st-tdd`、`/st-ship`；已保存的预设选择需要重选一次。

改名的原因：本预设与 `dsh-ds-stack-preset` 用的是同一份技能、同一套命名，两者可以并存安装，装完后技能列表里会出现两套一模一样的 `ds-tdd`，肉眼无法判断当前会话用的是哪一套。

### 变更

- **29 个技能改名**：目录名、frontmatter `name:`、正文里指向别的技能的 34 处手势，全部 `ds-*` → `st-*`。技能正文的散文一字未改，改的只是标识。
- **预设改名**：id `ds-stack` → `dsh-stack`，显示名「DeepSeek Stack 模式」→「dsh-stack模式」，说明文案里明确写着「该模式为 DeepSeek Stack 模式」，来源说明保留。
- **守卫改名**：文件 `preset/ds-loop.mjs` → `preset/st-loop.mjs`；打回消息的前缀从 `ds-stack checkpoint` 变成 `st-stack checkpoint`；消息里引用的技能手势同步改成 `/st-unstick`。
- **常驻人格首行**改为「running dsh-stack模式 — the DeepSeek Stack」，与预设显示名一致。

### 修复

- **技能 `st-help` 的描述里还留着上游品牌词**。原文是 "Pick the right deepseek-stack skill for a task"，装在本机时看不出问题，但它把另一个仓库的名字放进了每轮重发的技能目录里。现改为 "Pick the right skill from this pack for a task"。
- **`LICENSE` 与 `NOTICE.md` 的「逐字节 verbatim」表述已失效**。技能不再是逐字节复制（标识已改），两份文件改为「正文保留、标识改名」，并列出改了什么、为什么改、上游更新后怎么同步。

### 文档

- 中英 README、实现说明、验收清单、决策 03/04 全部对齐新名字；新增决策 `docs/decisions/05-技能前缀改为-st.md`。
- 维护者视角的完整改动清单与复现方式在 `docs/发布说明.md` 的 0.2.0 一节。

## [0.1.5] - 2026-11-04

### 变更

- **开发者约定文档不再随仓库公开**。仓库根的开发约束文件含发布流程、内部目录规范与工具取舍，属于维护者本地约定。它本来就不在 `files` 白名单里（不进 npm 包），现在同时移出 Git 索引并写进 `.gitignore`，克隆仓库的人看不到它。
- README 中英两份的「维护」章节不再链向该文件，改为说明发布流程与目录规范属于维护者本地约定、不随仓库发布。
- **`scripts/` 进包**。此前 `files` 白名单没有它，从 npm 装的副本跑 `npm test` 会直接报 `Cannot find module .../scripts/verify-preset.mjs`，而 README「自检」章节列的六条命令里有四条住在那里。现在装完就能自检。包体从 41 文件 / 61 KB 变成 46 文件 / 73 KB（解包 191 KB）。

### 修复

- **README 死链**。`README.md` 与 `README.en.md` 的维护章节原先链接 `AGENTS.md`，该文件不再入库后链接必然 404，npm 上装的副本里尤其明显。
- `scripts/verify-manifest.mjs` 新增断言：该文件必须写在 `.gitignore` 里且不在 git 索引中。此前只检查它没进 `files` 白名单，拦不住「被 git 跟踪」这一层泄漏。

## [0.1.4] - 2026-11-04

### 文档

- **代码注释里的来源表述统一**。`preset/agent.cordis.yml`、`preset/ds-loop.mjs`、两个校验脚本与一处测试注释，原来把外部技能包称「上游」，容易读成「本包从某个预设派生」。现在统一为「技能来源」或直接说明事实（例如「这里出过致命故障」）。行为零变化，只改注释。
- 开发者约定文档同步清理：删掉「上游来源 + upstream remote」一节，把「跟上游更新」重写成「同步技能来源」，命令改为从技能包仓库直接取。

## [0.1.3] - 2026-11-04

### 文档

- **README 只标注技能来源**。原文在头部同时列了技能来源与上游预设两条来源链，容易让人以为本包是二次包装的转发。现在只保留技能来源 [aicodeking/deepseek-stack](https://github.com/aicodeking/deepseek-stack)（MIT），其余来源引用从正文、章节标题、表格列名、边界说明与维护章节一并撤掉。章节「上游 → 本预设」改为「技能包 → 本预设」。
- CHANGELOG、NOTICE、许可证与 Git 历史里的署名不动——那是版权与溯源信息，不属宣传口径。

## [0.1.2] - 2026-11-04

这一版只改文档，但 README 属于随包发布的内容，所以要升版本。

### 文档

- **README 补齐上手路径**。原「用法」只有三行，看完了也不知道第一句该说什么。现在扩成五章：快速上手（三步 + 首句要给目标/约束/验收标准，附正反例）、什么时候用哪个技能（按开工前 / 写的时候 / 交付 / 长任务与并行 / 接手与复盘五组场景索引，每行是「你的处境 ↔ 手势」）、四个例子、技巧 7 条、反模式 5 条。
- 例 2 贴的是守卫打回的**原文**（逐字取自 `preset/ds-loop.mjs`），并写清三点：只列还没被证明的文件、纯文档改动豁免、一轮最多打回两次且第二次更硬；也写了想放行时该怎么办（跑一条读回文件的命令，而不是关守卫）。
- 「怎么确认它在工作」给出四条可自检的现象，含用 `node -p "require('dsh-stack/package.json').version"` 查版本。
- `README.en.md` 同步这五章，中英章节键集合逐一对齐（13 ↔ 13）。

## [0.1.1] - 2026-11-04

这是一个**必须升级**的版本：0.1.0 会让会话在建起来的第一刻就死掉。

### 修复

- **选择「DeepSeek Stack 模式」后会话无法启动**。0.1.0 从上游原样继承了 `persona.suffix: Your working directory is {{cwd}}.`，而宿主只注册 `provider` 与 `model` 两个提示词变量；渲染 `deployment:persona-suffix` 时抛 `unknown prompt variable "{{cwd}}"`，模型一步都没跑就结束，只能切回 standard。现删掉该 suffix——工作目录本来就已经在运行时上下文块里，这行既多余又致命。
- **改了 YAML 却不重启不生效**。这个问题不是代码缺陷，但 0.1.0 期间很容易误判成「改了没用」：DSH 主进程在安装 bundle 时就把 include 树读进内存，会话运行期间不重读磁盘上的 `agent.cordis.yml`。升级或手改预设后必须重启 DSH 才会生效。

### 新增

- `verify-host-api` 增加第 6 项检查：预设里出现的每个 `{{变量}}` 都必须是宿主真正注册过的，未注册直接判失败并列出宿主现有的变量名。
- `test/preset.test.mjs` 增加同一条断言的独立版本（白名单硬编码 `provider`/`model`）。`verify-host-api` 在没装 DSH 的机器上会 SKIP，CI 里等于没有这条检查；现在两侧都拦。
- 两个检查都用真实故障行验证过会失败：把 `{{cwd}}` 注回去，脚本退出码 1、测试退出码 1；恢复后均为 0。

### 文档

- `preset/agent.cordis.yml` 的 persona 注释块改写：记下为什么**不能**有 suffix、错误文案长什么样、宿主在哪两行注册变量。下次有人想「补一句工作目录说明」时能先看到这段。

## [0.1.0] - 2026-11-03

本版本是自维护线的起点：从 [TonyZiYuan/dsh-ds-stack-preset](https://github.com/TonyZiYuan/dsh-ds-stack-preset) 接过来，改名、补齐工程规范、加固守卫。

### 新增

- 包名 `dsh-stack`，预设显示名仍为「DeepSeek Stack 模式」，会话选择器里的名字不变。
- `engines.dsh` 与 `peerDependencies` 声明：dsh 版本不兼容时在安装阶段就被拒绝，而不是装完挂载失败。
- 四组自检脚本：`verify-preset`（装配完整性）、`verify-skills`（技能合法性）、`verify-manifest`（发包产物）、`verify-host-api`（宿主私有契约）。
- `verify-host-api` 会在 dsh 升级后检查守卫依赖的四个私有接口是否还在：`agent/turn-stopping` 钩子、载荷注入的 `agent`、`agent.steer` 的唤醒语义、`session.snapshotEvents`。守卫失效从此不再静默。
- 发布门禁 `verify-release`：工作区干净、tag 与版本对齐、CHANGELOG 有当前版本小节。

### 修复

- **打回文案只列真正没被证明的文件**：此前会把本轮所有改动过的文件都列出来，包括已经被更早的检查验证过的那些，指向了不需要处理的目标。
- **`mutationTools` / `checkTools` 收窄到宿主真实注册的工具**：移除了 `str_replace_editor`、`apply_patch`、`multiedit`、`notebook_edit`、`sh`、`shell`——这些在本机宿主里都不存在，留着让配置看起来支持比实际更广的范围。

### 变更

- **单轮打回上限从 1 提到 2，第二次措辞更硬**。此前模型无视第一次打回、照样结束轮次时守卫就彻底沉默；现在第二次会明确指出「你已经第二次在没证据的情况下结束」，并要求哪怕跑一条读回文件或执行程序的命令。第二次仍限次，不会形成循环。
- 内部目录 `ds-stack/` 改名为 `preset/`，避免与包名 `dsh-stack` 视觉撞车；`cordis.patch.yml` 的 include 路径同步更新。

### 文档

- 新增开发者约定文档：本仓库最高优先级开发约束，含发布铁律、目录规范、技能镜像规则、守卫改动规则。
- 新增 `README.en.md`，与中文 `README.md` 章节一一对应。
- 新增 `NOTICE.md` 中的来源与改动说明保持原样（上游内容，不重写）。
