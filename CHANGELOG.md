# 更新日志

本文件记录 `dsh-stack` 的用户可感知变化。格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循语义化版本。

分类固定为：**新增 / 修复 / 变更 / 文档 / 移除**。条目写「用户能感知到什么」，内部重构不单独成条。

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
