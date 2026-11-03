# 更新日志

本文件记录 `dsh-stack` 的用户可感知变化。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

分类固定为：**新增 / 修复 / 变更 / 文档 / 移除**。条目写「用户能感知到什么」，内部重构不单独成条。

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

- 新增 `AGENTS.md`：本仓库最高优先级开发约束，含发布铁律、目录规范、技能镜像规则、守卫改动规则。
- 新增 `README.en.md`，与中文 `README.md` 章节一一对应。
- 新增 `NOTICE.md` 中的来源与改动说明保持原样（上游内容，不重写）。
