/**
 * 装配静态断言：cordis.patch.yml + preset/agent.cordis.yml 的关键行是否还在。
 *
 * 与 scripts/verify-preset.mjs 的分工：
 *   - verify-preset.mjs 跑在 CI 与本地，检查「装不上」类问题（路径、白名单、上限）。
 *   - 本文件是纯 node 断言，不依赖任何工具，`npm test` 第一层就能跑；
 *     检查「装上了但行为不对」类问题（守卫配置、人格文本、禁用行）。
 *
 *   node test/preset.test.mjs
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const patch = readFileSync(join(ROOT, 'cordis.patch.yml'), 'utf8')
const preset = readFileSync(join(ROOT, 'preset', 'agent.cordis.yml'), 'utf8')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

let passed = 0
const check = (label, fn) => { fn(); console.log('  ok  ' + label); passed++ }

// 1 — 补丁只插入一条 preset 声明，不多不少。
check('patch inserts exactly one preset row', () => {
  assert.equal((patch.match(/name: "@deepseek-ai\/dsh-agent-preset"/g) ?? []).length, 1)
  assert.equal((patch.match(/- insert:/g) ?? []).length, 1)
})

// 2 — include 路径由包名 + preset 目录拼成，两者都从真实文件读，不做字面比较。
check('include path matches package name and preset dir', () => {
  const declared = patch.match(/path:\s*"([^"]+)"/)[1]
  assert.equal(declared, `./node_modules/${pkg.name}/preset/agent.cordis.yml`)
  assert.ok(existsSync(join(ROOT, 'preset', 'agent.cordis.yml')))
})

// 3 — 预设元数据是用户可见的东西，改了必须是有意的。
check('preset metadata unchanged', () => {
  assert.match(patch, /^\s+id: dsh-stack\s*$/m)
  assert.match(patch, /^\s+name: dsh-stack模式\s*$/m)
  assert.match(patch, /^\s+order: 6\s*$/m)
})

// 4 — 人格文本必须存在且非空：它是「常驻」这件事本身。
check('persona prefix is present', () => {
  const match = preset.match(/- id: persona[\s\S]*?prefix:\s*\|-?\n([\s\S]*?)\n\S/)
  assert.ok(match, '没有找到 persona.prefix')
  assert.ok(match[1].trim().length > 200, '人格文本过短，可能被误删')
})

// 5 — 守卫行存在，且配置与 st-loop.mjs 的默认值一致。
check('st-loop row agrees with module defaults', () => {
  assert.match(preset, /^- id: st-loop$/m)
  assert.match(preset, /name: \.\/st-loop\.mjs/)
  const mod = readFileSync(join(ROOT, 'preset', 'st-loop.mjs'), 'utf8')
  // 只匹配行首的键，避免命中注释里的同名英文单词。
  const valueIn = (text, key) => text.match(new RegExp(`^\\s*${key}:\\s*([a-z0-9]+)\\s*,?\\s*$`, 'im'))?.[1]
  for (const key of ['evidence', 'unstick', 'failStreak', 'maxSteersPerTurn', 'includeSubagents']) {
    const inYml = valueIn(preset, key)
    const inMod = valueIn(mod, key)
    assert.ok(inYml !== undefined, `agent.cordis.yml 里没有 ${key}`)
    assert.ok(inMod !== undefined, `st-loop.mjs DEFAULTS 里没有 ${key}`)
    assert.equal(inYml, inMod, `${key} 在 yml 与模块默认值里不一致：${inYml} vs ${inMod}`)
  }
})

// 6 — 工具名列表必须是非空的，且不含宿主没有的工具。
check('tool lists are non-empty and host-real', () => {
  const mutation = preset.match(/mutationTools:\s*\[([^\]]*)\]/)[1].split(',').map(s => s.trim())
  const checks = preset.match(/checkTools:\s*\[([^\]]*)\]/)[1].split(',').map(s => s.trim())
  assert.deepEqual(mutation, ['write', 'edit'])
  assert.deepEqual(checks, ['bash', 'pwsh'])
})

// 7 — 技能根：追加式注册 + baseUrl 推导。
check('skill root is additive and baseUrl-relative', () => {
  assert.match(preset, /customSkillDirs:/)
  assert.doesNotMatch(preset, /bundledSkillDir:/, 'bundledSkillDir 会替换部署默认技能根')
  assert.match(preset, /new URL\('\.\/skills',\s*ctx\.baseUrl\)/)
})

// 8 — 29 个技能目录都在，且每个都有 SKILL.md。
check('29 skill directories ship', () => {
  const dirs = readdirSync(join(ROOT, 'preset', 'skills'), { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name)
  assert.equal(dirs.length, 29)
  for (const dir of dirs) {
    assert.ok(existsSync(join(ROOT, 'preset', 'skills', dir, 'SKILL.md')), `${dir} 缺少 SKILL.md`)
  }
})

// 9 — 委派行：subagent 两个可用、两个禁用，ralph 保持禁用（与 standard 一致）。
check('delegation rows keep the standard shape', () => {
  const rowOf = (id) => preset.split(/- id: /).find(chunk => chunk.startsWith(id))
  for (const id of ['tool-subagent', 'tool-subagent-fork']) {
    const row = rowOf(id)
    assert.ok(row !== undefined, `缺少 ${id} 行`)
    assert.doesNotMatch(row.split('\n').slice(0, 4).join('\n'), /disabled:\s*true/, `${id} 不该被禁用`)
  }
  for (const id of ['tool-subagent-codex', 'tool-subagent-claude-code', 'tool-ralph']) {
    const row = rowOf(id)
    assert.ok(row !== undefined, `缺少 ${id} 行`)
    assert.match(row, /disabled:\s*true/, `${id} 应保持禁用`)
  }
})

// 10 — 插件管理器必须禁用：预设不该能自己改预设。
check('plugin manager stays disabled', () => {
  const row = preset.split(/- id: /).find(chunk => chunk.startsWith('tool-plugin-manager'))
  assert.ok(row !== undefined)
  assert.match(row, /disabled:\s*true/)
})

// 11 — 压缩阈值：太小会切碎长会话，改它需要单独的理由。
check('compaction thresholds unchanged', () => {
  assert.match(preset, /thresholdChars:\s*8192/)
  assert.match(preset, /headChars:\s*4096/)
  assert.match(preset, /tailChars:\s*1024/)
})

// 12 — 包必须能发布：private 会让 npm publish 直接失败。
check('manifest is publishable', () => {
  assert.notEqual(pkg.private, true)
  assert.equal(pkg.name, 'dsh-stack')
  assert.equal(pkg.dsh?.manifestVersion, 1)
  assert.ok(pkg.engines?.dsh, '缺少 engines.dsh')
  assert.ok(pkg.files.includes('preset'))
  assert.ok(pkg.files.includes('CHANGELOG.md'))
})

// 13 — 预设里的每个 {{变量}} 都必须是宿主注册过的。
//
// 这里出过致命故障：persona.suffix 写了 `{{cwd}}`，而宿主只注册 provider 与 model
// （dsh-agent-loop/lib/index.js:1607-1608），渲染 persona-suffix 时抛 UNKNOWN，
// 会话在模型走第一步之前就结束。这类错误没有降级路径，只能在提交前拦住。
//
// 白名单是宿主的私有契约，硬编码在此以便 CI 上也能跑（verify-host-api.mjs 在
// 没有 DSH 安装时是 SKIP）。宿主新增变量时同步这里，别放宽成「任意变量都行」。
const HOST_PROMPT_VARIABLES = new Set(['provider', 'model'])
check('preset only uses host-registered prompt variables', () => {
  const live = preset
    .split('\n')
    .filter((line) => !/^\s*#/.test(line))
    .join('\n')
  const used = [...live.matchAll(/\{\{([^}]*)\}\}/g)].map((match) => match[1].trim())
  const unknown = used.filter((name) => !HOST_PROMPT_VARIABLES.has(name))
  assert.deepEqual(
    unknown,
    [],
    `预设引用了宿主没注册的变量：${unknown.map((n) => `{{${n}}}`).join(', ')}（宿主只有 ${[...HOST_PROMPT_VARIABLES].join(', ')}）`
  )
})

// 14 — 卸载守卫：预设 id 在三个地方必须一致，否则守卫收的是别人的指针。
//
// 三处硬耦合：cordis.patch.yml 的 `config.id`（宿主看到的预设 id）、
// 同一文件守卫行的 `presetId`、以及 preset/lifecycle.mjs 的 `PRESET_ID`。
// 改一处忘另一处不会报错 —— 守卫照常运行，只是永远发现不了悬空的那一个。
check('uninstall guard agrees on the preset id', () => {
  const rowOf = (id) => patch.split(/- id: /).find(chunk => chunk.startsWith(id))
  const presetRow = rowOf('preset-dsh-stack')
  assert.ok(presetRow !== undefined, '缺少预设声明行')
  const declaredId = /^\s+id:\s*([a-z0-9-]+)\s*$/m.exec(presetRow)?.[1]
  const guardRow = rowOf('st-stack-uninstall-guard')
  assert.ok(guardRow !== undefined, '缺少卸载守卫行')
  const guardPresetId = /^\s+presetId:\s*([a-z0-9-]+)\s*$/m.exec(guardRow)?.[1]
  const guardFallback = /^\s+fallbackId:\s*([a-z0-9-]+)\s*$/m.exec(guardRow)?.[1]
  const lifecycle = readFileSync(join(ROOT, 'preset', 'lifecycle.mjs'), 'utf8')
  const moduleId = /export const PRESET_ID = '([a-z0-9-]+)'/.exec(lifecycle)?.[1]
  assert.equal(guardPresetId, declaredId, `守卫的 presetId（${guardPresetId}）与预设 id（${declaredId}）不一致`)
  assert.equal(moduleId, declaredId, `lifecycle.PRESET_ID（${moduleId}）与预设 id（${declaredId}）不一致`)
  assert.equal(guardFallback, 'standard', 'fallbackId 必须指向宿主内置、永远存在的预设')
})

// 15 — 守卫与命令行的模块路径必须解析到仓库里的真实文件。
check('uninstall guard and CLI point at real files', () => {
  const rowOf = (id) => patch.split(/- id: /).find(chunk => chunk.startsWith(id))
  // insert[].name 以 patch 文件目录（包目录）为基准被重写，所以必须是 ./preset/...；
  // 写成 ./node_modules/dsh-stack/preset/... 会变成 <包目录>/node_modules/...，多一层。
  const declared = /name:\s*"\.\/(preset\/[^"]+)"/.exec(rowOf('st-stack-uninstall-guard'))?.[1]
  assert.equal(declared, 'preset/uninstall-guard.mjs')
  for (const file of ['preset/uninstall-guard.mjs', 'preset/lifecycle.mjs', 'bin/dsh-stack.mjs']) {
    assert.ok(existsSync(join(ROOT, file)), `${file} 不存在`)
  }
  assert.equal(pkg.bin?.['dsh-stack'], './bin/dsh-stack.mjs')
  assert.ok(pkg.files.includes('bin'), 'bin 不在 files 白名单里，装了之后没有卸载命令')
})

console.log(`\n${passed} checks passed`)
