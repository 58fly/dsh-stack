/**
 * lifecycle — dsh-stack 的安装生命周期工具。
 *
 * 为什么需要它：本包给宿主贡献的是**一个预设 id**（`dsh-stack`）。宿主把
 * 「当前默认预设」记在 profile 的 `cordis.patch.yml` 里
 * `agent-preset-registry` 行的 `config.selectedDefault`，而这个指针**只有用户
 * 在 UI 里换预设时才会改**。插件被停用或卸载时，宿主只做两件事之一：
 *
 *   - `selectBundle(false)`：把包名从 profile `package.json` 的
 *     `dsh.profile.bundles` 数组里删掉（dsh-plugin-manager/lib/index.js:3064-3080）；
 *   - 卸载：`pnpm remove` + 删 bundle 项。
 *
 * 两条路径都**不碰 `selectedDefault`**。于是留下一个悬空指针，宿主在
 * `resolve('dsh-stack')` 时抛 `agent-preset/not-found`
 * （dsh-agent-preset-registry/lib/index.js:612-622），而新建会话的入口
 * （dsh-api-session-controller/lib/index.js:269）没有兜底 —— 每一次新建会话、
 * 每一个用该预设的旧会话，都会在模型开始第一步之前失败。
 *
 * 本模块提供的是**在插件离开之前把它留下的指针收干净**所需的最小工具集：
 * 只做文本级 YAML 定位与改写，零依赖，不做完整 YAML 解析。理由是 profile
 * patch 是用户手写的文件，带注释、带顺序，任何「解析再序列化」的写法都会
 * 重排用户的文件；而我们要动的永远只是**一行值**。
 *
 * 关键设计：判断「插件是否还可用」只看**磁盘**（包在不在、bundles 里有没有、
 * 补丁里有没有 disabled），不看宿主当前的内存状态。这样同一个函数在
 * 「正常退出」与「被禁用/卸载」两种 dispose 里得到相反的答案 —— 正常退出时
 * 包还在、指针不该动；被禁用时 bundles 已写盘删除、指针必须收走。
 */

import { existsSync, readFileSync, writeFileSync, renameSync, readdirSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'

/** 本包注册的预设 id；与 `cordis.patch.yml` 的 `config.id` 必须一致。 */
export const PRESET_ID = 'dsh-stack'

/** 指针失效时回落的预设 id；宿主内置，永远存在。 */
export const FALLBACK_PRESET_ID = 'standard'

/** npm 包名；profile 的 `node_modules/<包名>` 与 `dsh.profile.bundles` 都用它。 */
export const PACKAGE_NAME = 'dsh-stack'

/** 收指针时留下的备忘文件名，写在 profile 目录里（不是仓库）。 */
export const GUARD_MEMO = '.dsh-stack-guard.json'

/** profile 内承载「当前默认预设」的那一行所在的插件 id。 */
const REGISTRY_ID = 'agent-preset-registry'

/** 顶层条目起始行的形状：`- id: xxx`。缩进由第一个条目决定。 */
const ENTRY_RE = /^(\s*)-\s/

/**
 * DSH 的 home 目录。宿主的 `DSH_HOME` 只在 bootstrap 阶段生效
 * （dsh-app-boot/lib/index.js:4421 的注释），插件运行期读到的就是进程环境
 * 里那一份；没设时按宿主默认落在 `~/.dsh`。
 */
export function resolveDshHome(env = process.env) {
  const override = typeof env?.DSH_HOME === 'string' ? env.DSH_HOME.trim() : ''
  return override === '' ? join(homedir(), '.dsh') : override
}

/** 读文本；不存在返回 null（不抛）。 */
export function readText(path) {
  try {
    return existsSync(path) ? readFileSync(path, 'utf8') : null
  } catch {
    return null
  }
}

/**
 * 原子写：先写同目录临时文件再 rename。
 *
 * 直接 `writeFileSync` 在进程被杀时会留下半截 YAML，而半截的 profile patch
 * 会让宿主**整个 profile** 起不来 —— 比我们要修的悬空指针更糟。rename 在同一
 * 文件系统内是原子的，所以读者要么看到旧的完整文件，要么看到新的完整文件。
 */
export function writeTextAtomic(path, text) {
  const tmp = `${path}.dsh-stack-${process.pid}.tmp`
  writeFileSync(tmp, text, 'utf8')
  try {
    renameSync(tmp, path)
  } catch (error) {
    try { rmSync(tmp, { force: true }) } catch { /* 临时文件清不掉也不影响原文件 */ }
    throw error
  }
}

/** 列出 `$DSH_HOME/profiles/*` 里的 profile 目录（跳过 node_modules）。 */
export function listProfiles(home) {
  const root = join(home, 'profiles')
  let names
  try {
    names = readdirSync(root, { withFileTypes: true })
  } catch {
    return []
  }
  return names
    .filter(entry => entry.isDirectory() && entry.name !== 'node_modules')
    .map(entry => ({
      name: entry.name,
      dir: join(root, entry.name),
      patchPath: join(root, entry.name, 'cordis.patch.yml'),
      manifestPath: join(root, entry.name, 'package.json'),
      memoPath: join(root, entry.name, GUARD_MEMO),
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * 定位某个顶层条目的行区间 `[start, end)`。
 *
 * 只按缩进切块：条目起始 = 顶格（或该文件里最浅缩进）的 `- `；块结束 = 下一个
 * 同级条目或文件末尾。注释行与空行都归当前块，因为用户常把说明写在条目上方
 * 与下方，重写值时必须原样保留。
 */
export function blockRange(lines, id, baseIndent = 0) {
  const startRe = new RegExp(`^${' '.repeat(baseIndent)}-\\s`)
  let start = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (!startRe.test(lines[index])) continue
    const rest = lines[index].slice(baseIndent + 2)
    if (new RegExp(`^\\s*id:\\s*["']?${id}["']?\\s*(?:#.*)?$`).test(rest)) {
      start = index
      break
    }
  }
  if (start === -1) return null
  let end = lines.length
  for (let index = start + 1; index < lines.length; index += 1) {
    if (startRe.test(lines[index])) {
      end = index
      break
    }
  }
  return { start, end }
}

/** 找到第一个顶层条目的缩进；空文件按 0 处理。 */
function baseIndentOf(lines) {
  for (const line of lines) {
    const match = ENTRY_RE.exec(line)
    if (match !== null) return match[1].length
  }
  return 0
}

/** 读 registry 行里的 `selectedDefault`；没有该键返回 null。 */
export function readSelectedDefault(text) {
  if (typeof text !== 'string') return null
  const lines = text.split('\n')
  const block = blockRange(lines, REGISTRY_ID, baseIndentOf(lines))
  if (block === null) return null
  for (let index = block.start; index < block.end; index += 1) {
    const match = /^\s*selectedDefault:\s*(.+?)\s*(?:#.*)?$/.exec(lines[index])
    if (match !== null) return match[1].replace(/^["']|["']$/g, '')
  }
  return null
}

/**
 * 把 `selectedDefault` 从 `from` 改写成 `to`。返回 `{ text, changed }`。
 *
 * 只改值，不删键：删键会让「默认预设」回落到 `config.default`，行为上等价，
 * 但用户下次打开设置页看不到自己选过什么；把值改成回落预设则留下了可读的
 * 痕迹，也让恢复逻辑有一个确定的锚点（值仍等于 `to` 就说明没人另选过）。
 */
export function rewriteSelectedDefault(text, from, to) {
  if (typeof text !== 'string') return { text, changed: false }
  const lines = text.split('\n')
  const block = blockRange(lines, REGISTRY_ID, baseIndentOf(lines))
  if (block === null) return { text, changed: false }
  for (let index = block.start; index < block.end; index += 1) {
    const match = /^(\s*selectedDefault:\s*)(.+?)(\s*(?:#.*)?)$/.exec(lines[index])
    if (match === null) continue
    const value = match[2].replace(/^["']|["']$/g, '')
    if (value !== from) continue
    lines[index] = `${match[1]}${to}${match[3]}`
    return { text: lines.join('\n'), changed: true }
  }
  return { text, changed: false }
}

/** 补丁里本包的预设声明行是否被 `disabled: true` 停用。 */
export function patchDisablesPreset(text, presetId = PRESET_ID) {
  if (typeof text !== 'string') return false
  const lines = text.split('\n')
  const block = blockRange(lines, `preset-${presetId}`, baseIndentOf(lines))
  if (block === null) return false
  for (let index = block.start; index < block.end; index += 1) {
    if (/^\s*disabled:\s*true\s*(?:#.*)?$/.test(lines[index])) return true
  }
  return false
}

/** profile manifest：`{ raw, bundles, dependencies }`；读不到时给空壳。 */
export function readProfileManifest(dir) {
  const raw = readText(join(dir, 'package.json'))
  if (raw === null) return { raw: null, bundles: [], dependencies: {} }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { raw, bundles: [], dependencies: {} }
  }
  const bundles = Array.isArray(parsed?.dsh?.profile?.bundles) ? parsed.dsh.profile.bundles : []
  const dependencies = parsed?.dependencies && typeof parsed.dependencies === 'object' ? parsed.dependencies : {}
  return { raw, bundles, dependencies }
}

/**
 * 本包在这个 profile 里是否**仍然可用**。三项全部为真才算可用：
 *
 *   1. profile 的 `node_modules/<包名>/package.json` 在 —— 包被卸载时这里先消失；
 *   2. `dsh.profile.bundles` 里有包名 —— 停用 bundle 时宿主删的是这一项；
 *   3. profile patch 里预设声明行没有被 `disabled: true` —— 停用单行时改的是这里。
 *
 * 只看磁盘是刻意的：宿主 dispose 我们的那一刻，内存状态已经不可信（注册表
 * 可能正在拆），而磁盘上的安装状态在 reload 之前就写完了。
 */
export function inspectProfile(profile, packageName = PACKAGE_NAME) {
  const manifest = readProfileManifest(profile.dir)
  const patchText = readText(profile.patchPath)
  const packagePresent = existsSync(join(profile.dir, 'node_modules', packageName, 'package.json'))
  const bundleListed = manifest.bundles.includes(packageName)
  const disabled = patchDisablesPreset(patchText)
  return {
    ...profile,
    patchText,
    manifest,
    packagePresent,
    bundleListed,
    disabled,
    usable: packagePresent && bundleListed && !disabled,
  }
}

/** 备忘：我们收过哪些 profile 的指针，以及收之前它指向什么。 */
export function readMemo(path) {
  const raw = readText(path)
  if (raw === null) return null
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : null
  } catch {
    return null
  }
}

export function writeMemo(path, memo) {
  try {
    const dir = dirname(path)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeTextAtomic(path, `${JSON.stringify(memo, null, 2)}\n`)
    return true
  } catch {
    return false
  }
}

export function clearMemo(path) {
  try {
    if (existsSync(path)) rmSync(path, { force: true })
    return true
  } catch {
    return false
  }
}

/**
 * 收走一个 profile 里指向本预设、但本预设已不可用的悬空指针。
 *
 * 返回 `{ changed, reason }`。**只有真的改了才返回 changed: true**，
 * 所以这个函数可以无脑重复调用（doctor 每次跑、guard 每次加载都调用）。
 */
export function repairProfile(profile, options = {}) {
  const presetId = options.presetId ?? PRESET_ID
  const fallbackId = options.fallbackId ?? FALLBACK_PRESET_ID
  const packageName = options.packageName ?? PACKAGE_NAME
  const state = inspectProfile(profile, packageName)

  if (state.usable) return { changed: false, reason: 'still-installed', state }
  if (typeof state.patchText !== 'string') return { changed: false, reason: 'no-patch-file', state }

  const current = readSelectedDefault(state.patchText)
  if (current !== presetId) {
    return { changed: false, reason: current === null ? 'no-pointer' : `points-elsewhere:${current}`, state }
  }

  const { text, changed } = rewriteSelectedDefault(state.patchText, presetId, fallbackId)
  if (!changed) return { changed: false, reason: 'rewrite-missed', state }

  writeTextAtomic(profile.patchPath, text)
  writeMemo(profile.memoPath, {
    presetId,
    fallbackId,
    clearedAt: new Date().toISOString(),
    note: '默认预设指针已回落到 fallbackId；重新启用本插件后会自动恢复。',
  })
  return { changed: true, reason: 'pointer-cleared', state, from: presetId, to: fallbackId }
}

/**
 * 反向操作：插件回到可用状态后，把指针恢复成用户原本的选择。
 *
 * 只在**用户没有另选过**时恢复 —— 也就是说 patch 里的值仍然等于我们当初写下的
 * `fallbackId`。用户如果在这期间挑过别的预设，值就不是它，我们不覆盖用户的选择，
 * 只把备忘删掉。
 */
export function restoreProfile(profile, options = {}) {
  const presetId = options.presetId ?? PRESET_ID
  const packageName = options.packageName ?? PACKAGE_NAME
  const state = inspectProfile(profile, packageName)
  const memo = readMemo(profile.memoPath)

  if (memo === null) return { changed: false, reason: 'no-memo', state }
  if (!state.usable) return { changed: false, reason: 'still-unusable', state }
  if (typeof state.patchText !== 'string') return { changed: false, reason: 'no-patch-file', state }

  const fallbackId = typeof memo.fallbackId === 'string' ? memo.fallbackId : FALLBACK_PRESET_ID
  const current = readSelectedDefault(state.patchText)
  if (current !== fallbackId) {
    clearMemo(profile.memoPath)
    return { changed: false, reason: `user-chose:${current ?? 'none'}`, state }
  }

  const { text, changed } = rewriteSelectedDefault(state.patchText, fallbackId, presetId)
  if (!changed) {
    clearMemo(profile.memoPath)
    return { changed: false, reason: 'rewrite-missed', state }
  }
  writeTextAtomic(profile.patchPath, text)
  clearMemo(profile.memoPath)
  return { changed: true, reason: 'pointer-restored', state, from: fallbackId, to: presetId }
}

/**
 * 对一个 DSH home 里的每个 profile 跑同一个动作，单个 profile 失败不影响其他。
 *
 * 为什么全扫而不是只处理「当前 profile」：guard 拿不到自己所属 profile 的名字
 * （宿主不把它交给插件），而同一个悬空指针在两个 profile 上是同一个 bug。每个
 * profile 的处理是「读、判断、只在真需要时写一行」，误伤面等于零。
 */
export function forEachProfile(home, action) {
  const results = []
  for (const profile of listProfiles(home)) {
    try {
      results.push({ profile: profile.name, ...action(profile) })
    } catch (error) {
      results.push({ profile: profile.name, changed: false, reason: `error:${(error && error.message) || error}` })
    }
  }
  return results
}

/** 收指针（guard 卸载时 + doctor 修复时用）。 */
export function clearDanglingPointers(home, options = {}) {
  return forEachProfile(home, profile => repairProfile(profile, options))
}

/** 恢复指针（guard 加载时 + doctor 在重装后用）。 */
export function restorePointers(home, options = {}) {
  return forEachProfile(home, profile => restoreProfile(profile, options))
}

// ── profile manifest 与投影缓存的定向修复 ────────────────────────────────────
//
// 悬空指针是唯一会让宿主崩的一项，但停用/卸载留下的残留不止它：bundles 数组、
// dependencies、pnpm workspace/lock、node_modules 目录、以及会话投影缓存里
// 记着 `agentPreset: dsh-stack` 的行。它们单独都不致命，合在一起会让「重装一次
// 就好了」变成「重装后旧会话仍然打不开」。下面这几个函数负责把这些一并收敛，
// 全部是「只改真需要改的那一处」。

/** 推断 JSON 的缩进：取第一条缩进行的空格数，默认 2。 */
function detectIndent(text) {
  for (const line of text.split('\n')) {
    const match = /^( +)\S/.exec(line)
    if (match !== null) return match[1].length
  }
  return 2
}

/**
 * 对 profile 的 `package.json` 做一次结构化编辑。
 *
 * `mutate(parsed)` 返回 `{ changed, reason, detail? }`；只有 `changed === true`
 * 才写盘。JSON 的键顺序在 parse/stringify 之后保持不变，缩进按原文件推断，
 * 所以 diff 里只会出现被删掉的那几行。
 */
export function editProfileManifest(profile, mutate) {
  const raw = readText(profile.manifestPath)
  if (raw === null) return { changed: false, reason: 'no-manifest' }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { changed: false, reason: 'manifest-not-json' }
  }
  let outcome
  try {
    outcome = mutate(parsed)
  } catch (error) {
    return { changed: false, reason: `mutate-failed:${(error && error.message) || error}` }
  }
  if (outcome?.changed !== true) return { changed: false, reason: outcome?.reason ?? 'no-change', detail: outcome?.detail }
  writeTextAtomic(profile.manifestPath, `${JSON.stringify(parsed, null, detectIndent(raw))}\n`)
  return { changed: true, reason: outcome.reason, detail: outcome.detail }
}

/**
 * 从会话投影缓存里把 `agentPreset: <presetId>` 改成 `fallbackId`。
 *
 * 为什么需要：会话的「用哪个预设」存在投影缓存里（`record.rows.agentPreset.val`），
 * 打开旧会话时宿主把这个值读回来再 `resolve()` —— 插件走了、缓存里还留着 id，
 * 旧会话照样打不开。这是同一个悬空指针的第二处落点。
 *
 * 只认 `agentPreset.val` 这一个精确形状，不做关键词替换：缓存里出现
 * `dsh-stack` 的地方可能还有会话标题、用户消息正文，那些是用户数据，一个字
 * 都不该被改。
 */
export function pruneProjectionFile(path, presetId = PRESET_ID, fallbackId = FALLBACK_PRESET_ID) {
  const raw = readText(path)
  if (raw === null) return { changed: false, reason: 'missing' }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { changed: false, reason: 'not-json' }
  }
  let hits = 0
  const walk = node => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item)
      return
    }
    if (typeof node !== 'object' || node === null) return
    const slot = node.agentPreset
    if (typeof slot === 'object' && slot !== null && slot.val === presetId) {
      slot.val = fallbackId
      hits += 1
    }
    for (const value of Object.values(node)) walk(value)
  }
  walk(parsed)
  if (hits === 0) return { changed: false, reason: 'no-hit' }
  const indent = raw.includes('\n') ? detectIndent(raw) : null
  const serialized = indent === null ? JSON.stringify(parsed) : JSON.stringify(parsed, null, indent)
  writeTextAtomic(path, raw.endsWith('\n') ? `${serialized}\n` : serialized)
  return { changed: true, reason: 'rewritten', hits }
}

/** 列出所有会话投影缓存文件（两处落点：storages 下的单会话、workspace 下的索引）。 */
export function listProjectionFiles(home) {
  const files = []
  const storages = join(home, 'storages', 'session_projcache', 'sessions')
  try {
    for (const entry of readdirSync(storages, { withFileTypes: true })) {
      if (entry.isFile() && entry.name.endsWith('.json')) files.push(join(storages, entry.name))
    }
  } catch {
    // 没有这个目录说明宿主还没写过投影缓存，属于正常情况。
  }
  const sessions = join(home, 'sessions')
  try {
    for (const entry of readdirSync(sessions, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const index = join(sessions, entry.name, 'projcache.json')
      if (existsSync(index)) files.push(index)
    }
  } catch {
    // 同上。
  }
  return files
}

/** 批量清投影缓存；`dryRun` 时只统计不写。 */
export function pruneProjections(home, options = {}) {
  const presetId = options.presetId ?? PRESET_ID
  const fallbackId = options.fallbackId ?? FALLBACK_PRESET_ID
  const dryRun = options.dryRun === true
  const results = []
  for (const path of listProjectionFiles(home)) {
    try {
      if (dryRun) {
        const raw = readText(path)
        const hits = raw === null ? 0 : (raw.match(new RegExp(`"val"\\s*:\\s*"${presetId}"`, 'g')) ?? []).length
        results.push({ path, changed: false, reason: hits > 0 ? `would-rewrite:${hits}` : 'no-hit' })
        continue
      }
      results.push({ path, ...pruneProjectionFile(path, presetId, fallbackId) })
    } catch (error) {
      results.push({ path, changed: false, reason: `error:${(error && error.message) || error}` })
    }
  }
  return results
}

/**
 * 强制收指针：不看「插件是否可用」，直接改。
 *
 * `repairProfile` 的判断是「插件已经不可用了才收」，这是给**运行期**用的
 * （正常退出时不能动用户的默认）。卸载是另一回事：卸载者在一秒之后就会让
 * 插件变成不可用，所以必须在删包**之前**把指针收走，否则中间那一瞬间它就是
 * 悬空的。这个函数就是这个「先收再删」的入口。
 */
export function forceClearPointer(profile, options = {}) {
  const presetId = options.presetId ?? PRESET_ID
  const fallbackId = options.fallbackId ?? FALLBACK_PRESET_ID
  const text = readText(profile.patchPath)
  if (text === null) return { changed: false, reason: 'no-patch-file' }
  const current = readSelectedDefault(text)
  if (current !== presetId) return { changed: false, reason: current === null ? 'no-pointer' : `points-elsewhere:${current}` }
  const { text: next, changed } = rewriteSelectedDefault(text, presetId, fallbackId)
  if (!changed) return { changed: false, reason: 'rewrite-missed' }
  writeTextAtomic(profile.patchPath, next)
  return { changed: true, reason: 'pointer-cleared', from: presetId, to: fallbackId }
}
