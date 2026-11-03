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
  assert.match(patch, /^\s+id: ds-stack\s*$/m)
  assert.match(patch, /^\s+name: DeepSeek Stack 模式\s*$/m)
  assert.match(patch, /^\s+order: 6\s*$/m)
})

// 4 — 人格文本必须存在且非空：它是「常驻」这件事本身。
check('persona prefix is present', () => {
  const match = preset.match(/- id: persona[\s\S]*?prefix:\s*\|-?\n([\s\S]*?)\n\S/)
  assert.ok(match, '没有找到 persona.prefix')
  assert.ok(match[1].trim().length > 200, '人格文本过短，可能被误删')
})

// 5 — 守卫行存在，且配置与 ds-loop.mjs 的默认值一致。
check('ds-loop row agrees with module defaults', () => {
  assert.match(preset, /^- id: ds-loop$/m)
  assert.match(preset, /name: \.\/ds-loop\.mjs/)
  const mod = readFileSync(join(ROOT, 'preset', 'ds-loop.mjs'), 'utf8')
  // 只匹配行首的键，避免命中注释里的同名英文单词。
  const valueIn = (text, key) => text.match(new RegExp(`^\\s*${key}:\\s*([a-z0-9]+)\\s*,?\\s*$`, 'im'))?.[1]
  for (const key of ['evidence', 'unstick', 'failStreak', 'maxSteersPerTurn', 'includeSubagents']) {
    const inYml = valueIn(preset, key)
    const inMod = valueIn(mod, key)
    assert.ok(inYml !== undefined, `agent.cordis.yml 里没有 ${key}`)
    assert.ok(inMod !== undefined, `ds-loop.mjs DEFAULTS 里没有 ${key}`)
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
// 上游就是死在这里：persona.suffix 写了 `{{cwd}}`，而宿主只注册 provider 与 model
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

console.log(`\n${passed} checks passed`)
