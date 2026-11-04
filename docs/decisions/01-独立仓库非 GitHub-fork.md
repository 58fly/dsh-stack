# 01 — 独立仓库 + `upstream` remote，不用 GitHub 的 fork 关系

## 背景

任务是把 `TonyZiYuan/dsh-ds-stack-preset` 接过来自己维护。两条路：

- **A. GitHub fork**：在网页上 fork，得到 `58fly/dsh-ds-stack-preset`，GitHub 记录 fork 关系。
- **B. 独立仓库**：新建 `58fly/dsh-stack`，clone 上游代码推上去，另外加一个 `upstream` remote 指向原仓库。

## 决定

选 **B**。

## 理由

1. **fork 关系是公开且不可撤销的标记**。仓库页会永久显示 "forked from TonyZiYuan/dsh-ds-stack-preset"，即使后续代码已经完全无关。本包已经改名、改目录、加守卫、改发布流程，用「fork」描述它不准确。
2. **fork 的 issue / PR 默认走上游**。fork 仓库要单独开 issue 得手动改设置，而且 fork 不能改可见性（永远 public，因为上游 public）。本仓库的 issue 要记录自己的改动动机，不该混进上游的 issue 池。
3. **fork 仓库不能删掉关系**。若哪天要归档，独立仓库能直接 archive，fork 只能删。
4. **B 同样能取上游更新**。`git fetch upstream` 就是全部需求，`git diff upstream/main` 一样好用。fork 关系带来的唯一便利是网页上的 "Sync fork" 按钮，而本仓库**不需要**自动同步——技能是逐字节镜像，同步走 `rsync` 更可控（见维护者本地约定「同步技能来源」）。

## 代价

- 失去 GitHub 的 "Sync fork" 按钮与 "compare across forks" 的 PR 界面。前者用不上，后者在需要向上游提 PR 时手动加 remote 即可。
- 上游的 star / watch 不会汇总过来。本包不需要那些数字。

## 验证

```bash
git remote -v
# origin   https://github.com/58fly/dsh-stack.git
# upstream https://github.com/TonyZiYuan/dsh-ds-stack-preset.git
git ls-remote --heads upstream   # 上游可达
```
