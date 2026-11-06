/**
 * uninstall-guard — 让 dsh-stack 可以被安全地停用或卸载。
 *
 * ## 它修的是什么
 *
 * 本包向宿主注册一个 agent preset（id `dsh-stack`）。用户在会话选择器里把它
 * 设为默认后，宿主会把 `selectedDefault: dsh-stack` 写进 profile 的
 * `cordis.patch.yml`（`agent-preset-registry` 行的 config）。这个指针的**写**
 * 只发生在用户换预设时，而插件被停用/卸载时宿主只改两处：
 *
 *   - `selectBundle(false)` 删 `dsh.profile.bundles` 里的包名
 *     （dsh-plugin-manager/lib/index.js:3064-3080）；
 *   - 卸载时再 `pnpm remove` 掉 `node_modules/<包名>`。
 *
 * 两处都不碰 `selectedDefault`。于是下一次新建会话会在
 * `presets.resolve('dsh-stack')` 抛 `agent-preset/not-found`
 * （dsh-agent-preset-registry/lib/index.js:612-622），而新建会话的调用点
 * （dsh-api-session-controller/lib/index.js:269）没有兜底 —— 用户看到的是
 * 「插件装了/卸了之后，整个应用新建不了会话」。
 *
 * ## 它做两件事，都在磁盘上判断
 *
 * 1. **加载时自愈**：如果某个 profile 的指针指向本预设，但本预设在该 profile
 *    里已经不可用（包不在、bundles 不在、或预设行被 disabled），把指针回落到
 *    `standard`。这是给「宿主已经崩过、用户手动删了目录、现在重启」这一类的
 *    事后补救 —— 崩溃之后再启动，本插件若还随其他 bundle 一起加载（例如用户
 *    只是删了目录还没删 bundles 项），这一步会在任何人新建会话之前修好。
 * 2. **离开前收尾**：`ctx.effect` 的 disposer 在 fiber 销毁时执行，也就是
 *    「停用 bundle」「卸载插件」「热重载」都会走这里。disposer 里再判一次
 *    「本预设还有效吗」—— 有效就什么都不做（正常退出时必须不能动用户的默认），
 *    失效才收指针。
 *
 * 判据永远是磁盘，不是宿主当前的内存状态：正常退出时磁盘上包还在、bundles
 * 还有、补丁没 disabled，三项为真 → 不动；被停用/卸载时宿主**先写盘再
 * reload**，所以 disposer 看到的已经是「不可用」的那份磁盘状态。
 *
 * ## 恢复
 *
 * 收指针时在 profile 目录留一份 `.dsh-stack-guard.json` 备忘。插件重新可用后，
 * 加载时若备忘在、且指针仍停在我们写下的回落值（说明用户没另选过），就把它
 * 恢复成 `dsh-stack`。用户期间换过预设则只删备忘，不覆盖用户的选择。
 *
 * ## 边界
 *
 * 只写一个 YAML 标量的值，不解析、不重排、不新增/删除键；任何异常只
 * `warnOnce`，绝不抛出 —— 一个生命周期工具的失败不该让宿主的 profile 起不来。
 */

import {
  PRESET_ID,
  FALLBACK_PRESET_ID,
  PACKAGE_NAME,
  resolveDshHome,
  clearDanglingPointers,
  restorePointers,
} from './lifecycle.mjs'

/** Cordis 插件名，用于 loader 诊断。 */
export const name = 'st-stack-uninstall-guard'

/** 读字符串配置，空值回落默认。 */
function textOption(config, key, fallback) {
  const value = config?.[key]
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

export function apply(ctx, config = {}) {
  const presetId = textOption(config, 'presetId', PRESET_ID)
  const fallbackId = textOption(config, 'fallbackId', FALLBACK_PRESET_ID)
  const packageName = textOption(config, 'packageName', PACKAGE_NAME)
  const home = textOption(config, 'dshHome', resolveDshHome())
  const options = { presetId, fallbackId, packageName }

  let warned = false
  const warnOnce = message => {
    if (warned) return
    warned = true
    try {
      ctx.logger.warn(message)
    } catch {
      // 日志服务不可用时静默：本插件存在的意义是消除崩溃，不是制造崩溃。
    }
  }

  /** 把一次批量结果压成一行可读日志；没有变化时返回 null。 */
  const describe = results => {
    const changed = results.filter(result => result.changed)
    if (changed.length === 0) return null
    return changed
      .map(result => `${result.profile}: ${result.from} → ${result.to}（${result.reason}）`)
      .join('；')
  }

  /**
   * 启动期一次对账。先恢复（插件回到可用），再收指针（插件不可用）。
   *
   * 两个动作都是「只在真需要时写一行」，所以可以无脑连跑；顺序也不影响结果，
   * 因为 restoreProfile 只在备忘存在且插件可用时生效，repairProfile 只在插件
   * 不可用时生效，二者互斥。
   */
  const reconcile = () => {
    try {
      const restored = describe(restorePointers(home, options))
      if (restored !== null) {
        try {
          ctx.logger.info(`${name}: 已恢复默认预设指针 ${restored}`)
        } catch { /* 同上 */ }
      }
      const repaired = describe(clearDanglingPointers(home, options))
      if (repaired !== null) {
        warnOnce(
          `${name}: 检测到指向 ${presetId} 的默认预设指针已悬空，已回落到 ${fallbackId} —— ${repaired}。` +
          `重新启用本插件后会自动恢复。`
        )
      }
    } catch (error) {
      warnOnce(`${name}: 启动对账失败，跳过（不影响宿主）：${String((error && error.message) || error)}`)
    }
  }

  /** 离开前收尾。同步、只碰一行、永不抛出。 */
  const cleanup = () => {
    try {
      const results = clearDanglingPointers(home, options)
      const repaired = describe(results)
      if (repaired !== null) warnOnce(`${name}: 已收走悬空指针 ${repaired}`)
    } catch {
      // disposer 里连日志都不可靠（logger 可能已经先被拆掉），静默退出。
    }
  }

  reconcile()

  // `ctx.effect` 是 Cordis 的收集器：setup 里返回的 disposer 会在 fiber 销毁时
  // 被逆序调用，同步函数直接执行。停用 bundle、卸载插件、热重载都走这条路径。
  if (typeof ctx.effect === 'function') {
    ctx.effect(() => cleanup, `${name}: clear dangling preset pointer`)
    return
  }

  // 老版本宿主没有 effect 时的退路：fiber 自身的 dispose 事件。
  if (typeof ctx.on === 'function') {
    ctx.on('dispose', () => cleanup())
    return
  }

  warnOnce(`${name}: 宿主没有提供 effect/dispose 钩子，卸载时需要手动执行 npx dsh-stack doctor --fix`)
}
