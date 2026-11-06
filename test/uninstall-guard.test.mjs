/**
 * 优雅卸载与自愈的行为断言 — 无依赖，任选 Node >= 22 直接跑：
 *   node test/uninstall-guard.test.mjs
 *
 * 这套测试覆盖的是「插件离开之后宿主还能不能活」这件事，所以它不模拟宿主，
 * 而是**直接造一个 DSH home 的磁盘状态**：profile 目录、package.json、
 * cordis.patch.yml、node_modules/<包>、会话投影缓存。每个断言都是「在这种
 * 磁盘状态下，我们的代码会不会写那一行、写成了什么」。
 *
 * 最关键的两条是相反的：
 *   - 正常退出（包还在、bundles 还在）→ 一个字节都不能改；
 *   - 被停用/卸载（任一条件消失）→ 指针必须收。
 * 它们同时失败才说明判据错了，所以两条都必须在这里。
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const lifecycle = await import(new URL('../preset/lifecycle.mjs', import.meta.url).href)
const guard = await import(new URL('../preset/uninstall-guard.mjs', import.meta.url).href)
const cli = await import(new URL('../bin/dsh-stack.mjs', import.meta.url).href)

let passed = 0
const check = (label, fn) => { fn(); console.log('  ok  ' + label); passed++ }

const PATCH = `# 用户自己的补丁层
- id: locale
  name: "@deepseek-ai/dsh-client-locale"
  config:
    preference: zh
- id: agent-preset-registry
  name: "@deepseek-ai/dsh-agent-preset-registry"
  config:
    default: standard
    selectedDefault: dsh-stack   # 用户上次选的
- id: dsh-prompt
  disabled: true
`

/** 造一个 profile，`installed` 控制包与 bundles 是否都在。 */
function makeHome(options = {}) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-stack-guard-'))
  const dir = join(home, 'profiles', 'demo')
  mkdirSync(dir, { recursive: true })
  const bundles = options.bundles ?? ['dsh-stack']
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'demo-profile',
    dependencies: options.dependency === false ? {} : { 'dsh-stack': '^0.3.0' },
    dsh: { profile: { bundles } },
  }, null, 2) + '\n')
  writeFileSync(join(dir, 'cordis.patch.yml'), options.patch ?? PATCH)
  if (options.installed !== false) {
    const pkgDir = join(dir, 'node_modules', 'dsh-stack')
    mkdirSync(pkgDir, { recursive: true })
    writeFileSync(join(pkgDir, 'package.json'), '{"name":"dsh-stack","version":"0.3.0"}\n')
  }
  if (options.workspace !== undefined) writeFileSync(join(dir, 'pnpm-workspace.yaml'), options.workspace)
  return { home, dir }
}

const profileOf = (home, name = 'demo') => lifecycle.listProfiles(home).find(entry => entry.name === name)
const patchOf = dir => readFileSync(join(dir, 'cordis.patch.yml'), 'utf8')

// ── 文本级改写 ───────────────────────────────────────────────────────────────

check('readSelectedDefault 读出 registry 行里的值', () => {
  assert.equal(lifecycle.readSelectedDefault(PATCH), 'dsh-stack')
})

check('rewriteSelectedDefault 只改值，注释与其他键原样保留', () => {
  const { text, changed } = lifecycle.rewriteSelectedDefault(PATCH, 'dsh-stack', 'standard')
  assert.equal(changed, true)
  assert.match(text, /^\s+selectedDefault: standard   # 用户上次选的$/m)
  assert.match(text, /^\s+default: standard$/m)
  assert.match(text, /^- id: locale$/m)
  assert.match(text, /^- id: dsh-prompt$/m)
})

check('rewriteSelectedDefault 不碰指向别的预设的值', () => {
  const other = PATCH.replace('selectedDefault: dsh-stack', 'selectedDefault: planner')
  const { changed } = lifecycle.rewriteSelectedDefault(other, 'dsh-stack', 'standard')
  assert.equal(changed, false)
})

check('没有 selectedDefault 键时读回 null，改写是空操作', () => {
  const bare = PATCH.replace(/\n\s+selectedDefault:[^\n]*/, '')
  assert.equal(lifecycle.readSelectedDefault(bare), null)
  assert.equal(lifecycle.rewriteSelectedDefault(bare, 'dsh-stack', 'standard').changed, false)
})

check('patchDisablesPreset 认得本包预设行的 disabled', () => {
  const disabled = `${PATCH}- id: preset-dsh-stack\n  name: "@deepseek-ai/dsh-agent-preset"\n  disabled: true\n`
  assert.equal(lifecycle.patchDisablesPreset(disabled), true)
  assert.equal(lifecycle.patchDisablesPreset(PATCH), false)
})

check('onlyBuiltDependencies 里的包名能被摘掉，别的条目不动', () => {
  const yaml = 'onlyBuiltDependencies:\n  - esbuild\n  - dsh-stack\n  - "@deepseek-ai/cordis"\n'
  const { text, changed } = cli.stripBuiltDependency(yaml, 'dsh-stack')
  assert.equal(changed, true)
  assert.equal(text, 'onlyBuiltDependencies:\n  - esbuild\n  - "@deepseek-ai/cordis"\n')
})

// ── 可用性判据 ───────────────────────────────────────────────────────────────

check('三项磁盘条件都满足时判定为可用', () => {
  const { home } = makeHome()
  const state = lifecycle.inspectProfile(profileOf(home))
  assert.equal(state.packagePresent, true)
  assert.equal(state.bundleListed, true)
  assert.equal(state.disabled, false)
  assert.equal(state.usable, true)
  rmSync(home, { recursive: true, force: true })
})

check('预设行被 disabled 时判定为不可用（即使包还在）', () => {
  const { home } = makeHome({
    patch: `${PATCH}- id: preset-dsh-stack\n  name: "@deepseek-ai/dsh-agent-preset"\n  disabled: true\n`,
  })
  const state = lifecycle.inspectProfile(profileOf(home))
  assert.equal(state.packagePresent, true)
  assert.equal(state.usable, false)
  rmSync(home, { recursive: true, force: true })
})

// ── 修复与恢复 ───────────────────────────────────────────────────────────────

check('插件仍然可用时，修复是空操作 —— 正常退出不能动用户的默认预设', () => {
  const { home, dir } = makeHome()
  const before = patchOf(dir)
  const result = lifecycle.repairProfile(profileOf(home))
  assert.equal(result.changed, false)
  assert.equal(result.reason, 'still-installed')
  assert.equal(patchOf(dir), before)
  rmSync(home, { recursive: true, force: true })
})

check('包被删掉后，悬空指针回落到 standard 并留下备忘', () => {
  const { home, dir } = makeHome({ bundles: [] })
  const result = lifecycle.repairProfile(profileOf(home))
  assert.equal(result.changed, true)
  assert.equal(result.to, 'standard')
  assert.match(patchOf(dir), /selectedDefault: standard/)
  const memo = lifecycle.readMemo(join(dir, lifecycle.GUARD_MEMO))
  assert.equal(memo.presetId, 'dsh-stack')
  assert.equal(memo.fallbackId, 'standard')
  rmSync(home, { recursive: true, force: true })
})

check('修复是幂等的：第二次跑不改文件', () => {
  const { home, dir } = makeHome({ bundles: [] })
  lifecycle.repairProfile(profileOf(home))
  const after = patchOf(dir)
  const second = lifecycle.repairProfile(profileOf(home))
  assert.equal(second.changed, false)
  assert.equal(patchOf(dir), after)
  rmSync(home, { recursive: true, force: true })
})

check('指针指向别的预设时不接管', () => {
  const { home, dir } = makeHome({
    bundles: [],
    patch: PATCH.replace('selectedDefault: dsh-stack', 'selectedDefault: planner'),
  })
  const before = patchOf(dir)
  assert.equal(lifecycle.repairProfile(profileOf(home)).changed, false)
  assert.equal(patchOf(dir), before)
  rmSync(home, { recursive: true, force: true })
})

check('重新装上之后恢复用户原本的选择，并删掉备忘', () => {
  const { home, dir } = makeHome({ bundles: [] })
  lifecycle.repairProfile(profileOf(home))
  // 装回来：bundles 与 node_modules 都恢复。
  const installed = makeHomePatchless(dir)
  assert.equal(installed, true)
  const result = lifecycle.restoreProfile(profileOf(home))
  assert.equal(result.changed, true)
  assert.match(patchOf(dir), /selectedDefault: dsh-stack/)
  assert.equal(existsSync(join(dir, lifecycle.GUARD_MEMO)), false)
  rmSync(home, { recursive: true, force: true })
})

/** 在既有 profile 目录里补回 bundles 与 node_modules（模拟重装）。 */
function makeHomePatchless(dir) {
  const manifestPath = join(dir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.dsh.profile.bundles = ['dsh-stack']
  manifest.dependencies = { 'dsh-stack': '^0.3.0' }
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  const pkgDir = join(dir, 'node_modules', 'dsh-stack')
  mkdirSync(pkgDir, { recursive: true })
  writeFileSync(join(pkgDir, 'package.json'), '{"name":"dsh-stack","version":"0.3.0"}\n')
  return true
}

check('用户期间换过预设时，恢复不覆盖他的选择，只删备忘', () => {
  const { home, dir } = makeHome({ bundles: [] })
  lifecycle.repairProfile(profileOf(home))
  // 用户手动改成了别的预设。
  const text = readFileSync(join(dir, 'cordis.patch.yml'), 'utf8').replace('selectedDefault: standard', 'selectedDefault: planner')
  writeFileSync(join(dir, 'cordis.patch.yml'), text)
  makeHomePatchless(dir)
  const result = lifecycle.restoreProfile(profileOf(home))
  assert.equal(result.changed, false)
  assert.match(result.reason, /^user-chose/)
  assert.match(patchOf(dir), /selectedDefault: planner/)
  assert.equal(existsSync(join(dir, lifecycle.GUARD_MEMO)), false)
  rmSync(home, { recursive: true, force: true })
})

check('没有 cordis.patch.yml 的 profile 不会抛', () => {
  const { home, dir } = makeHome({ bundles: [] })
  rmSync(join(dir, 'cordis.patch.yml'))
  assert.equal(lifecycle.repairProfile(profileOf(home)).changed, false)
  assert.equal(lifecycle.restoreProfile(profileOf(home)).changed, false)
  rmSync(home, { recursive: true, force: true })
})

// ── 会话投影缓存 ─────────────────────────────────────────────────────────────

check('投影缓存只改 agentPreset.val，正文里的同名文字不动', () => {
  const { home } = makeHome()
  const dir = join(home, 'storages', 'session_projcache', 'sessions')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'session-a.json')
  writeFileSync(file, JSON.stringify({
    version: 7,
    record: {
      rows: { agentPreset: { ver: 1, seq: 3, val: 'dsh-stack' }, title: { val: '安装 dsh-stack 插件后异常' } },
      events: [{ data: { text: 'dsh-stack 装不上' } }],
    },
  }))
  const result = lifecycle.pruneProjections(home, { presetId: 'dsh-stack', fallbackId: 'standard' })
  assert.equal(result.length, 1)
  assert.equal(result[0].changed, true)
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  assert.equal(parsed.record.rows.agentPreset.val, 'standard')
  assert.equal(parsed.record.rows.title.val, '安装 dsh-stack 插件后异常')
  assert.equal(parsed.record.events[0].data.text, 'dsh-stack 装不上')
  rmSync(home, { recursive: true, force: true })
})

check('投影缓存 dryRun 不写盘', () => {
  const { home } = makeHome()
  const dir = join(home, 'storages', 'session_projcache', 'sessions')
  mkdirSync(dir, { recursive: true })
  const file = join(dir, 'session-b.json')
  const original = JSON.stringify({ record: { rows: { agentPreset: { val: 'dsh-stack' } } } })
  writeFileSync(file, original)
  const result = lifecycle.pruneProjections(home, { presetId: 'dsh-stack', fallbackId: 'standard', dryRun: true })
  assert.equal(result[0].changed, false)
  assert.match(result[0].reason, /would-rewrite/)
  assert.equal(readFileSync(file, 'utf8'), original)
  rmSync(home, { recursive: true, force: true })
})

// ── guard 插件 ───────────────────────────────────────────────────────────────

/** 最小 ctx：记录 effect 的 disposer，供手工触发。 */
function makeCtx() {
  const disposers = []
  const warnings = []
  const infos = []
  return {
    disposers,
    warnings,
    infos,
    ctx: {
      effect(fn) { disposers.push(fn()) },
      logger: { warn: m => warnings.push(m), info: m => infos.push(m) },
    },
  }
}

check('guard 加载时就把悬空指针修好（宿主崩过之后的启动自愈）', () => {
  const { home, dir } = makeHome({ bundles: [] })
  const { ctx, warnings } = makeCtx()
  guard.apply(ctx, { dshHome: home })
  assert.match(patchOf(dir), /selectedDefault: standard/)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /已在?.*悬空|悬空/)
  rmSync(home, { recursive: true, force: true })
})

check('guard 的 disposer 在插件仍可用时什么都不做（正常退出不误伤）', () => {
  const { home, dir } = makeHome()
  const { ctx, disposers } = makeCtx()
  guard.apply(ctx, { dshHome: home })
  assert.equal(disposers.length, 1)
  const before = patchOf(dir)
  disposers[0]()
  assert.equal(patchOf(dir), before)
  assert.match(patchOf(dir), /selectedDefault: dsh-stack/)
  rmSync(home, { recursive: true, force: true })
})

check('guard 的 disposer 在包被删后收走指针（停用/卸载路径）', () => {
  const { home, dir } = makeHome()
  const { ctx, disposers } = makeCtx()
  guard.apply(ctx, { dshHome: home })
  // 停用 bundle：宿主先写盘把 bundles 项删掉，再 reload → dispose。
  const manifestPath = join(dir, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.dsh.profile.bundles = []
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
  disposers[0]()
  assert.match(patchOf(dir), /selectedDefault: standard/)

  // 装回来之后，下一次加载会把用户的选择恢复。
  makeHomePatchless(dir)
  const second = makeCtx()
  guard.apply(second.ctx, { dshHome: home })
  assert.match(patchOf(dir), /selectedDefault: dsh-stack/)
  rmSync(home, { recursive: true, force: true })
})

check('guard 在没有 effect 的老宿主上退回 dispose 事件，仍然收指针', () => {
  const { home, dir } = makeHome({ bundles: [] })
  const handlers = new Map()
  const ctx = { on(name, fn) { handlers.set(name, fn) }, logger: { warn() {}, info() {} } }
  guard.apply(ctx, { dshHome: home })
  assert.equal(typeof handlers.get('dispose'), 'function')
  handlers.get('dispose')()
  assert.match(patchOf(dir), /selectedDefault: standard/)
  rmSync(home, { recursive: true, force: true })
})

check('guard 对不存在的 home 不抛（生命周期工具不该成为崩溃源）', () => {
  const { ctx, disposers } = makeCtx()
  guard.apply(ctx, { dshHome: join(tmpdir(), 'dsh-stack-does-not-exist-' + process.pid) })
  assert.equal(disposers.length, 1)
  disposers[0]()
})

check('guard 在既没有 effect 也没有 on 的宿主上只警告一次', () => {
  const { home } = makeHome()
  const warnings = []
  guard.apply({ logger: { warn: m => warnings.push(m) } }, { dshHome: home })
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /doctor/)
  rmSync(home, { recursive: true, force: true })
})

// ── CLI 体检 ─────────────────────────────────────────────────────────────────

check('doctor 把悬空指针判为 error，--fix 后判为已修复', () => {
  const { home } = makeHome({ bundles: [] })
  const state = lifecycle.inspectProfile(profileOf(home))
  const items = cli.diagnose(state)
  const item = items.find(entry => entry.id === 'pointer-dangling')
  assert.equal(item.severity, 'error')
  assert.equal(item.fix().changed, true)
  const after = cli.diagnose(lifecycle.inspectProfile(profileOf(home)))
  assert.equal(after.some(entry => entry.id === 'pointer-dangling'), false)
  rmSync(home, { recursive: true, force: true })
})

check('doctor 认出 bundles 与依赖的残留，并能清掉', () => {
  const { home, dir } = makeHome({ installed: false })
  const state = lifecycle.inspectProfile(profileOf(home))
  const ids = cli.diagnose(state).map(entry => entry.id)
  assert.ok(ids.includes('bundle-stale'))
  assert.ok(ids.includes('dependency-stale'))
  for (const item of cli.diagnose(state)) item.fix?.()
  const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  assert.deepEqual(manifest.dsh.profile.bundles, [])
  assert.equal(manifest.dependencies['dsh-stack'], undefined)
  rmSync(home, { recursive: true, force: true })
})

console.log(`\n${passed} checks passed`)
