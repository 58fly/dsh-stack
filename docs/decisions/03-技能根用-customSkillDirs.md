# 03 — 技能根用 `customSkillDirs` 追加，不用 `bundledSkillDir`

## 背景

`dsh-skill-filesystem` 有两条配置路径能挂技能目录：

- `bundledSkillDir` — **替换**部署自带的 bundled 技能根。
- `customSkillDirs` — **追加**一个根，带 rank。

## 决定

用 `customSkillDirs`，rank 300，路径 `new URL('./skills', ctx.baseUrl)`。

## 理由

1. **`bundledSkillDir` 是替换语义**。装上本预设会把部署自带的 bundled 技能整体顶掉——用户在别的预设里能用的技能，在这个预设里消失。一个「只改工作方式、不改能力」的预设不能这么干。
2. **rank 300 落在中间**。宿主的解析顺序是项目级 100/200 → 本包 300 → 用户级 400/500。结果是：项目自己写的 `st-*` 能覆盖本包（符合直觉），用户自己装的技能照常加载（不被打断），本包的 29 个技能只在没人竞争时生效。
3. **`ctx.baseUrl` 而非绝对路径**。`fileURLToPath(new URL('./skills', ctx.baseUrl))` 让 link 安装（symlink / junction）也能解析到真实目录，而不是 `node_modules` 里的软链目标。

## 代价

**同名覆盖方向反直觉**：若用户在 `~/.dsh/skills`（rank 400/500）放了同名 `st-mode`，本包的版本（300）会赢，用户版本被忽略。上游内容一致时通常无感，但用户若改过自己的副本就会困惑。

不选的做法是 `additive: false` 或把 rank 提到 500+，但前者会打断用户的技能，后者会让本包压过用户自己的定制。300 是这两个坏结果之间唯一可接受的点。

## 验证

```bash
node scripts/verify-preset.mjs     # 断言 customSkillDirs 存在、无 bundledSkillDir、路径由 baseUrl 派生
node scripts/verify-skills.mjs     # 断言 29 个目录都在、目录名 == frontmatter name
```
