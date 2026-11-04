#!/usr/bin/env node
/**
 * 装配完整性校验：bundle 补丁与预设组合本体是否自洽。
 *
 * 检查的是「装不上」和「装上了但不生效」这两类问题——它们都不会报错，
 * 只会在新建会话时表现为「预设列表里没有它」或「技能目录是空的」。
 *
 *   node scripts/verify-preset.mjs
 */

import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const patchPath = join(ROOT, 'cordis.patch.yml')
const presetDir = join(ROOT, 'preset')
const presetPath = join(presetDir, 'agent.cordis.yml')

const failures = []
const fail = (message, hint) => failures.push(hint ? `${message}\n    → ${hint}` : message)
const read = (path, label) => {
  if (!existsSync(path)) {
    fail(`${label} 不存在：${path.slice(ROOT.length + 1)}`)
    return ''
  }
  return readFileSync(path, 'utf8')
}

const patch = read(patchPath, 'cordis.patch.yml')
const preset = read(presetPath, 'preset/agent.cordis.yml')

// ---- 1. 补丁里声明的 include 路径必须指向真实存在的文件 ----
//
// 这是最容易断的一环：路径写成 `./node_modules/<包名>/<目录>/agent.cordis.yml`，
// 而 <包名> 来自 package.json、<目录> 来自磁盘。三者任一改动不同步，
// 补丁仍然「合法」，但挂载时找不到文件，预设根本不会出现。
const includeMatch = patch.match(/path:\s*"([^"]*agent\.cordis\.yml)"/)
if (!includeMatch) {
  fail('cordis.patch.yml 里没有找到指向 agent.cordis.yml 的 include 路径')
} else {
  const declared = includeMatch[1]
  const expected = `./node_modules/${pkg.name}/preset/agent.cordis.yml`
  if (declared !== expected) {
    fail(
      `include 路径与实际不符：声明 ${declared}，应为 ${expected}`,
      '包名或 preset/ 目录改名后必须同步 cordis.patch.yml'
    )
  }
  // 把 node_modules/<包名>/ 换成仓库根，验证后半段在本仓库里真的存在。
  const suffix = declared.replace(/^\.\/node_modules\/[^/]+\//, '')
  if (!existsSync(join(ROOT, suffix))) {
    fail(`include 路径的仓库内部分不存在：${suffix}`)
  }
}

// ---- 2. 预设元数据必须与会话选择器里看到的一致 ----
const wantConfig = {
  'id: dsh-stack': /^\s+id:\s*dsh-stack\s*$/m,
  'name: dsh-stack模式': /^\s+name:\s*dsh-stack模式\s*$/m,
  'order: 6': /^\s+order:\s*6\s*$/m,
}
for (const [label, pattern] of Object.entries(wantConfig)) {
  if (!pattern.test(patch)) fail(`cordis.patch.yml 缺少或改动了 ${label}`, '改这些值等于改变用户看到的东西，需同步 README 与 CHANGELOG')
}

// ---- 3. 预设本体必须声明这些行，否则行为静默缺失 ----
const requiredRows = [
  ['st-loop', '轮次收尾守卫'],
  ['skill-filesystem', '技能根'],
  ['tool-skill', '技能目录工具'],
  ['agent-instructions', '工作区指令注入'],
  ['tool-fs', '文件工具'],
  ['tool-bash', 'shell（unix）'],
  ['tool-pwsh', 'shell（windows）'],
]
for (const [id, label] of requiredRows) {
  if (!new RegExp(`^- id:\\s*${id}\\s*$`, 'm').test(preset)) {
    fail(`preset/agent.cordis.yml 缺少 ${label} 行（- id: ${id}）`)
  }
}

// ---- 4. 技能根必须由 baseUrl 推导，且目录存在 ----
//
// 写成固定相对路径的话，link: 安装（junction/symlink）会让它解析到 profile 里。
if (!/fileURLToPath\(new URL\('\.\/skills',\s*ctx\.baseUrl\)\)/.test(preset)) {
  fail(
    '技能根不是从 ctx.baseUrl 推导的',
    "应形如 fileURLToPath(new URL('./skills', ctx.baseUrl))，否则 link: 安装时会指错目录"
  )
}
if (!/customSkillDirs:/.test(preset)) {
  fail(
    '技能根没有用 customSkillDirs',
    'bundledSkillDir 会整体替换部署默认值，customSkillDirs 才是追加'
  )
}
if (!existsSync(join(presetDir, 'skills'))) fail('preset/skills/ 目录不存在，挂载时会直接抛错')

// ---- 5. 技能目录上限必须容得下最长的描述 ----
//
// 调小这个值不会报错，只会静默截断「Use when …」，而那是每条技能唯一的触发条件。
const capMatch = preset.match(/catalogDescriptionMaxLength:\s*(\d+)/)
if (!capMatch) {
  fail('tool-skill 没有配置 catalogDescriptionMaxLength')
} else {
  const cap = Number(capMatch[1])
  const skillsDir = join(presetDir, 'skills')
  if (existsSync(skillsDir)) {
    const { readdirSync } = await import('node:fs')
    let longest = { length: 0, name: '' }
    for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const skillFile = join(skillsDir, entry.name, 'SKILL.md')
      if (!existsSync(skillFile)) continue
      const head = readFileSync(skillFile, 'utf8').slice(0, 4000)
      const desc = head.match(/^description:\s*(.+)$/m)
      if (!desc) continue
      // frontmatter 里的引号不算描述长度——catalog 渲染的是解引号后的文本。
      const value = desc[1].trim().replace(/^["'](.*)["']$/, '$1')
      if (value.length > longest.length) longest = { length: value.length, name: entry.name }
    }
    if (longest.length > cap) {
      fail(
        `catalogDescriptionMaxLength=${cap} 会截断 ${longest.name} 的描述（${longest.length} 字符）`,
        '末尾的「Use when …」是唯一的触发条件，截掉等于让这条技能无法被路由到'
      )
    }
  }
}

// ---- 6. package.json 的 bundle 声明与文件白名单 ----
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') {
  fail(`dsh.bundle.patch 应为 ./cordis.patch.yml，实际 ${pkg.dsh?.bundle?.patch}`)
}
if (!Array.isArray(pkg.files) || !pkg.files.includes('preset')) {
  fail('package.json files 白名单里没有 preset', '不进包的话装完就是空预设')
}
if (!pkg.files?.includes('cordis.patch.yml')) {
  fail('package.json files 白名单里没有 cordis.patch.yml')
}

// ---- 输出 ----
if (failures.length === 0) {
  console.log('✅ 装配校验通过：补丁、预设本体、技能根、目录上限、manifest 一致')
  process.exit(0)
}
console.error(`\n❌ 装配校验失败（${failures.length} 项）\n`)
for (const message of failures) console.error(`  - ${message}\n`)
process.exit(1)
