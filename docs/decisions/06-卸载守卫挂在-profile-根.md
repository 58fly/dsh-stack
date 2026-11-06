# 06 — 卸载守卫挂在 profile 根，而不是预设里；卸载走命令而不是按钮

## 背景

真实发生过一次：用户把「dsh-stack模式」设为默认预设，之后停用了这个插件。从此 DSH 新建不了任何会话，卸载插件也不会自己好。

链路是三条既有行为的叠加，每一条单看都合理：

1. **指针的写入点是唯一的**。「当前默认预设」存在 profile 的 `cordis.patch.yml`（`agent-preset-registry` 行的 `config.selectedDefault`），只有用户在选择器里换预设时才会被改写（`dsh-client-ui-agent-preset/lib/client.js:1666`）。
2. **停用/卸载不碰它**。`selectBundle(name, enabled)` 只改 `dsh.profile.bundles` 数组（`dsh-plugin-manager/lib/index.js:3048-3080`）；卸载再 `pnpm remove` 掉目录。两处都不写 `selectedDefault`。
3. **解析失败没有兜底**。新建会话入口 `const resolvedId = (await presets.resolve(presetId)).id`（`dsh-api-session-controller/lib/index.js:269`），`presetId` 省略时取 `this.config.selectedDefault.get() ?? this.config.default`（`dsh-agent-preset-registry/lib/index.js:472-474`），`resolve` 找不到就抛 `agent-preset/not-found`（同文件 `:612-622`）。前端只有 `restoreBlank()`（`dsh-client-ui-workspace/lib/client.js:1455-1474`）捕获这个错误并退回默认预设，而它服务的是「恢复空白页」，新建会话的路径没有同样的兜底。

于是「指针悬空」这件事的后果被放大到整个应用不可用，而用户归因到「这个插件有毒」。

0.2.0 之前我们**没有**修任何东西 —— 上次只是手工清了六处残留（指针、bundles、依赖、pnpm workspace/lock、`node_modules`、`.modules.yaml`）和会话缓存。机制还在，下次照样复现。本次要修的是机制。

## 决定

分三层，各管一种时机：

1. **运行期守卫**（`preset/uninstall-guard.mjs`，由 `cordis.patch.yml` 的一行加载）：
   - 加载时对账一次 —— 插件已经不可用而指针还指着自己，就收回；
   - 用 `ctx.effect` 的 disposer 在 fiber 销毁前再收一次 —— 停用 bundle、卸载插件、热重载都走这条路径。
2. **独立命令**（`bin/dsh-stack.mjs`）：`status` / `doctor [--fix] [--sessions]` / `uninstall`，处理守卫够不到的两种场合 —— 宿主已经崩过、或者用户直接删目录而没走停用流程。
3. **判据是磁盘状态，不是内存状态**：包在不在（`node_modules/<包名>`）、bundles 里有没有、补丁里这一行有没有 `disabled`。三项都真 = 可用 = **一个字节都不改**。

## 理由

- **为什么挂在 profile 根，不挂在预设里**：预设只在「用它的那个会话」里激活，而崩溃发生在会话被创建**之前**。挂在预设里，守卫永远等不到上场的机会 —— 不激活就没有 dispose，没有 dispose 就没人收指针。这是本决策最关键的一条：位置不是风格问题，是能不能生效的问题。
- **为什么用磁盘判据**：「正常退出」和「被停用」在 dispose 时刻的宿主内存状态难以可靠区分（服务可能已在拆除、`loaded` 标记未必已经翻），但磁盘状态的差别是确定的 —— 宿主停用是先写盘再 reload，dispose 时磁盘上已经写着「bundles 里没有这个包」。用磁盘判据，正常关掉 DSH 时三项全真，守卫什么都不做；停用/卸载时它才动。这条有专门的测试（`正常退出不动文件`）。
- **为什么留备忘、重新启用时恢复**：只在离开时收指针，会把用户「我就是要这个预设当默认」的选择永久清掉。备忘文件 `.dsh-stack-guard.json` 记住「是我收的、收成了什么」，插件重新可用后，若指针仍停在我们写的那个回落值（说明用户没另选过）就恢复原值；用户换过预设则只删备忘、不覆盖。收与还都是「只在真需要时写一行」。
- **为什么卸载要有独立命令，而不是只靠守卫**：守卫的价值依赖「宿主还在跑、模块还在内存里」。用户在宿主退出后 `rm -rf node_modules/dsh-stack`，守卫没有执行机会。`uninstall` 还解决顺序问题：指针必须在删包**之前**收，反过来就留下一个窗口。
- **为什么 `--sessions` 只改 `agentPreset.val`**：旧会话的预设记在投影缓存（`record.rows.agentPreset.val`），插件走了缓存还留着 id，打开旧会话同样抛 `not-found`。但缓存里出现插件名的其他地方是**用户数据**（会话标题、消息正文），一个字都不该动。所以只认这一个精确形状，不做关键词替换。

## 不选的方案

- **做 Web 界面按钮**（用户原话给了这个选项）。按钮活在插件里，插件被停用/卸载后按钮一起消失 —— 恰好是它唯一该起作用的时刻。要做也只能做成宿主侧的功能，那不属于本包。
- **改宿主**（给 `resolve` 加兜底、或让 `selectBundle` 顺手清指针）。宿主打包在 `app.asar` 里，升级即覆盖，且本包「只改变工作方式、不改变宿主」的边界会被破。真要做应该是给 DSH 提 issue —— 那才是根治位置，但我们要先自己止血。
- **在 bundle 补丁里 override `agent-preset-registry` 的 `selectedDefault`**（比如强行写空串）。这会在插件**在用**的时候每次启动都清掉用户的默认预设 —— 把「卸载后崩」换成「一直悄悄不生效」，更糟。
- **把守卫改成独立的第二个 bundle**（这样它能比预设活得更久）。bundle 停用/卸载时本节目的两个包一起走，多一个 bundle 只是多一份要同步的 manifest，换不来任何存活优势。

## 代价

1. **本包会写一行用户配置**。此前它是纯只读的（只改自己的工作方式）。现在它会在一种情况下改 profile 的 `cordis.patch.yml`：把悬空的 `selectedDefault` 收回 `standard`。为此这条路径做到了极窄 —— 只改一个标量的值、不重排文件、可回滚、幂等，且 README「边界与注意」里明写。
2. **三处 id 硬耦合**：`cordis.patch.yml` 预设声明行的 `config.id`、同一文件守卫行的 `presetId`、`preset/lifecycle.mjs` 的 `PRESET_ID`。改一处忘另一处不会报错，只会让守卫永远发现不了悬空的那一个。`test/preset.test.mjs` 与 `scripts/verify-preset.mjs` 都会拦。
3. **多了一个包的入口点**（`bin/`）。它进发包白名单，包体从 46 文件 / 75 KB 变成 51 文件 / 102 KB。

## 验证

真实 cordis（宿主 0.2.2-rc.1 内的 4.1.0）跑三个场景，全部符合预期：

```bash
# A 正常退出：包在、bundles 在 → dispose 后文件未变
# B 停用：bundles 被删后 dispose → selectedDefault 已收回 standard，备忘已写
# C 重装：加载时 → selectedDefault 恢复为 dsh-stack
npm test    # test/uninstall-guard.test.mjs 25 条
```

装配侧另有一条易错点被端到端合成验证抓到：bundle 补丁里 `insert[].name` 以 **patch 文件所在目录**（即包目录）为基准被重写成 file URL（`dsh-app-boot/lib/index.js:4718-4725` 的 `anchorInsertedPluginNames`），而 `cordis:include` 的 `config.path` 不被它处理、运行时才按 profile 目录解析。所以守卫行写 `./preset/uninstall-guard.mjs`，include 写 `./node_modules/dsh-stack/preset/agent.cordis.yml` —— 两种写法都对，混用就多一层 `node_modules/`，加载即失败。
