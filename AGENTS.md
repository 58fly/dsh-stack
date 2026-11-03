# AGENTS.md — dsh-stack

本文件是本仓库的最高优先级开发约束。与任何其他文档、历史约定、个人习惯冲突时，以本文件为准。

## 这个仓库是什么

`dsh-stack` 是 DSH 的 **agent preset bundle**：它注册一个叫「DeepSeek Stack 模式」的预设（preset id `ds-stack`，会话选择器里显示这个名字），由三部分组成：

1. **常驻人格**：`preset/agent.cordis.yml` 的 `persona.prefix`，把上游 `ds-mode` 的规则压缩成系统提示。
2. **29 个技能**：`preset/skills/`，逐字节镜像 [aicodeking/deepseek-stack](https://github.com/aicodeking/deepseek-stack)。
3. **轮次收尾守卫**：`preset/ds-loop.mjs`，监听 `agent/turn-stopping`，命中规则就 `steer` 一条消息让这一轮继续。

它**不改变** Agent 能做什么（工具、沙箱、审批、压缩、委派都与内置 `standard` 预设逐行一致），只改变它的工作方式。

上游来源：[TonyZiYuan/dsh-ds-stack-preset](https://github.com/TonyZiYuan/dsh-ds-stack-preset)（保留为 `upstream` remote）。

## 铁律：npm 与 GitHub 必须完全对齐

**任何时刻，npm registry 上 `dsh-stack` 的每个已发布版本，都必须在 GitHub 仓库里有对应的 commit 与 tag；GitHub `main` 的 `package.json` 版本号必须等于 npm 的 `latest`。**

这条铁律不接受「下次补」「先发再说」。npm 发布不可逆（unpublish 受 72 小时限制且会破坏已安装用户），GitHub 可改可补，所以**顺序只能是 Git 先行**。

### 发布流程（唯一允许的顺序）

```bash
# 1. 版本号与内容就绪，工作区必须干净
npm test                        # 必须全绿
git status --short              # 必须为空

# 2. 先提交
git add -A
git commit -m "release: X.Y.Z —— <一句话说明>"

# 3. 再打 tag（tag 必须与 package.json 版本一致，格式 vX.Y.Z）
git tag vX.Y.Z

# 4. 推送 commit 与 tag —— 推 tag 会触发 GitHub Actions 自动发布
git push origin main
git push origin vX.Y.Z

# 5. 等 CI 发布完，做三方对齐自检
npm run verify:release --verify
```

推 tag 后由 `.github/workflows/publish.yml` 在干净环境里跑 `npm ci` + `npm test`，全绿才 `npm publish`（`NPM_TOKEN` 来自仓库 secret）。发布门禁仍是 `prepublishOnly` → `scripts/verify-release.mjs`：工作区干净、tag 存在、tag 之后进包内容未变，三条都不放宽。

### 禁止事项

- ❌ 在工作区有未提交改动时 `npm publish`
- ❌ 发布后不推 GitHub（会导致 npm 有版本、GitHub 无对应代码）
- ❌ 推了 commit 不打 tag（版本无法从 Git 侧追溯）
- ❌ 改了 `package.json` 版本号却不发布（GitHub 版本高于 npm）
- ❌ 用 `npm version` 自动打 tag 后跳过 push
- ❌ 直接改 npm 上的版本而不同步仓库

### 发布后自检

```bash
npm run verify:release          # 比对本地 / npm latest / git tag 三方一致
```

这条也会检查 npm 上是否有 GitHub 里不存在的版本（反向漂移）。

## 版本号

- 起点 **0.1.0**，与上游 `1.0.0` 无关——这是自维护线，不是上游的续版。
- 语义化版本，但按「用户可感知的行为变化」定级：改守卫规则、改人格文本、增删技能 → minor；只修 bug、改文档、改 CI → patch。
- 上游技能镜像更新不算本包行为变化，patch 即可。

## 目录规范

```
cordis.patch.yml        bundle 补丁：插入一条 agent-preset 声明行
preset/
  agent.cordis.yml      预设组合本体（人格、技能根、守卫、各工具行）
  ds-loop.mjs           轮次收尾守卫
  skills/               29 个 ds-* 技能，逐字节镜像上游
test/
  ds-loop.test.mjs      守卫单测（零依赖）
  preset.test.mjs       装配静态断言（零依赖）
scripts/
  verify-preset.mjs     装配完整性：行存在、include 路径、baseUrl、元数据
  verify-skills.mjs     技能合法性：frontmatter、name↔目录、交叉引用、catalog 字数
  verify-manifest.mjs   manifest：files 白名单、engines、peerDependencies、bundle 声明
  verify-host-api.mjs   宿主契约：turn-stopping / steer / snapshotEvents 仍存在
  verify-release.mjs    发布门禁：工作区干净 + tag 对齐 + CHANGELOG 有本节
docs/
  decisions/            架构决策记录（一篇一个决策，写「为什么不选另一个」）
  实现说明.md            文件职责、宿主契约、验证方式、已知限制
  验收清单.md            可逐条打勾的验收项
  发布说明.md            维护者视角：为什么改、复现步骤、连带清单
issues/                 每个改动的动机与验收留档（NN-短名.md）
```

**不建的目录**：`docs/research/`（本包的调研结论已经固化在 `实现说明.md`，再存原始记录只是重复）、`docs/agents/`（`workspace.yaml` 是 agent 工作区插件的生成物，本仓库不用那个插件）、`lib/` 与 `client.js`（本包无运行时代码、无 Web UI）。照搬 `dsh-cn-think` 的全套目录会把「规范」变成「体量」——这里沿用结构与约束，不沿用它的规模。

### 硬耦合：改名必须同步

`cordis.patch.yml` 的 include 路径是 `./node_modules/<package.json name>/preset/agent.cordis.yml`。**包名改了、目录改了，这一行必须跟着改**，否则安装即挂载失败。`scripts/verify-manifest.mjs` 会交叉校验三者一致。

## 技能目录的维护规则

- `preset/skills/**` **逐字节镜像上游**，本仓库不改写技能正文。这条是更新路径的基础：跟上游只需覆盖目录，永远不会产生合并冲突。
- 需要本地改造某个技能时，先改上游或另建技能目录，不要在这里动——动了就失去镜像能力。
- 技能目录名必须等于 frontmatter `name`。`scripts/verify-skills.mjs` 会拦。
- 每条 `description` 会作为持久前缀每轮重发（29 条合计约 6.8k 字符 ≈ 1.7k token）。`tool-skill` 的 `catalogDescriptionMaxLength: 400` 是按最长描述（`ds-context-reset`，349 字符）定的，调小会截掉末尾的「Use when …」触发条件。

## 守卫（ds-loop）的改动规则

- **改逻辑必须同时改 `test/ds-loop.test.mjs`**，且新用例要先红后绿。守卫是唯一有运行时代码的部分，测试是它唯一的证据。
- 默认值改动要同步三处：`preset/ds-loop.mjs` 的 `DEFAULTS`、`preset/agent.cordis.yml` 的 `ds-loop` 行、`README.md` 的可调字段表。
- 守卫内部任何异常只能 `warnOnce`，绝不能抛出阻断轮次收尾。这条有测试（`throwing session log is contained`）。
- 工具名列表（`mutationTools` / `checkTools`）必须对应当前宿主**实际注册**的工具名。宿主工具集变了就同步，否则规则静默失效。核实方式见 `scripts/verify-host-api.mjs`。

## 文档规则

- **每个版本必须更新 `CHANGELOG.md`**：新增一节 `## [X.Y.Z] - YYYY-MM-DD`，版本号与日期与 `package.json`、git tag 一致；分类固定用 新增 / 修复 / 变更 / 文档 / 移除；条目写「用户能感知到什么」，不写内部重构名词。
  - `CHANGELOG.md` 随包分发，给用户看；`docs/发布说明.md` 不随包分发，给维护者看（为什么改、复现步骤、连带列表）。**同一件事只写各自那层，两边不重复。**
  - `prepublishOnly` 会校验 CHANGELOG 里有当前版本的小节，缺了直接失败。
- 中文 `README.md` 与英文 `README.en.md` 的章节键集合必须一致；改一边必须改另一边。
- `docs/` 不进包，改它不影响产物；改 `README*`、`CHANGELOG.md`、`cordis.patch.yml`、`preset/**`、`test/**` 会改变 pack 尺寸，需同步 `docs/发布说明.md` 的实测值。
- 密钥、token、cookie 一律不写入仓库文件。

## README 的安装说明

npm 源为首选，Git 源作为备选并标注差异。原因：宿主对 Git 源安装的更新检查走 `git ls-remote -- <repo> HEAD`（`dsh-plugin-manager/lib/types/github-connection.js:32`），commit 就是它的版本标识，插件页的「有新版本」会显示 commit SHA 而不是 `0.3.6` 这样的版本号。这无法从插件侧修正，只能靠安装方式规避。

## 跟上游更新

```bash
git fetch upstream
git diff upstream/main -- ds-stack/skills/        # 上游目录名仍是 ds-stack
rsync -a --delete upstream-skills/ preset/skills/
node scripts/verify-skills.mjs
```

若上游新增技能导致 catalog 字数越界，`verify-skills.mjs` 会报当前值与上限，再决定是否调 `catalogDescriptionMaxLength` 或删技能目录。
