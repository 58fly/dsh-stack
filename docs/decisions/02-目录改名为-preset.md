# 02 — 内部目录 `ds-stack/` → `preset/`

## 背景

上游把预设内容放在 `ds-stack/` 目录里，与包名 `dsh-ds-stack-preset` 呼应。本包改名为 `dsh-stack` 后，`dsh-stack/ds-stack/agent.cordis.yml` 这种路径在日志、报错、`node_modules` 浏览里都容易读错——两个名字差三个字母。

## 决定

目录改名为 `preset/`，得到 `node_modules/dsh-stack/preset/agent.cordis.yml`。

## 理由

- **读一次就懂**：`preset/` 直接说明里面是预设内容，不依赖读者知道包名缩写。
- **搜索不歧义**：`grep -r "ds-stack"` 现在只会命中预设 id（`config.id: ds-stack`）和上游链接，不会同时命中目录名。
- **改名成本一次性**：只在 `cordis.patch.yml` 的 include 路径、`.gitattributes` 注释、文档里出现。

## 不选的名字

- `agent/` — 与宿主的 agent 概念混淆。
- `bundle/` — 本包整体才是 bundle，里面的目录不是。
- 保持 `ds-stack/` — 与包名视觉撞车，这是改名的全部动机。

## 代价与约束

`cordis.patch.yml` 的 include 路径硬耦合目录名：

```yaml
path: "./node_modules/dsh-stack/preset/agent.cordis.yml"
```

`scripts/verify-manifest.mjs` 交叉校验「包名 + 目录 + 该行」三者一致，改任何一个不同步就会在 `npm test` 里失败。这条约束写在 AGENTS.md 的「硬耦合」一节。

## 验证

```bash
grep -n 'preset/agent.cordis.yml' cordis.patch.yml
node scripts/verify-manifest.mjs
```
