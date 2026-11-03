#!/usr/bin/env node
/**
 * 技能目录校验：preset/skills/ 是否仍是一份可被宿主装载的技能包。
 *
 * 这些技能逐字节镜像上游，所以本脚本不评判技能写得好不好，
 * 只拦「装进 catalog 之后会静默失效」的四类问题：
 *
 *   1. frontmatter 缺 name/description —— 该条不进 catalog，用户看不到。
 *   2. 目录名 ≠ frontmatter name —— `/ds-xxx` 手势点不到它。
 *   3. 描述超过 catalogDescriptionMaxLength —— 末尾的「Use when …」被截掉。
 *   4. 正文里的 `/ds-*` 指向不存在的技能 —— 模型照着做会扑空。
 *
 *   node scripts/verify-skills.mjs
 */

import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SKILLS = join(ROOT, 'preset', 'skills')
const PRESET = join(ROOT, 'preset', 'agent.cordis.yml')

const failures = []
const notes = []
const fail = (message, hint) => failures.push(hint ? `${message}\n    → ${hint}` : message)

if (!existsSync(SKILLS)) {
  console.error('❌ preset/skills/ 不存在')
  process.exit(1)
}

const cap = Number((readFileSync(PRESET, 'utf8').match(/catalogDescriptionMaxLength:\s*(\d+)/) ?? [])[1] ?? 0)
if (!Number.isInteger(cap) || cap <= 0) fail('读不到 catalogDescriptionMaxLength，无法校验描述长度')

/** 取 frontmatter 里某个键的单行值（去掉包裹引号）。 */
function frontmatterValue(text, key) {
  const match = text.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'))
  if (!match) return null
  return match[1].trim().replace(/^["'](.*)["']$/, '$1')
}

const dirs = readdirSync(SKILLS, { withFileTypes: true })
  .filter(entry => entry.isDirectory())
  .map(entry => entry.name)
  .sort()

const byName = new Map()
let totalChars = 0
let longest = { length: 0, name: '' }
const bodies = new Map()

for (const dir of dirs) {
  const skillFile = join(SKILLS, dir, 'SKILL.md')
  if (!existsSync(skillFile)) {
    fail(`preset/skills/${dir}/ 里没有 SKILL.md`)
    continue
  }
  const text = readFileSync(skillFile, 'utf8')
  if (!text.startsWith('---')) {
    fail(`preset/skills/${dir}/SKILL.md 没有 frontmatter`)
    continue
  }
  const end = text.indexOf('\n---', 3)
  if (end < 0) {
    fail(`preset/skills/${dir}/SKILL.md 的 frontmatter 没有闭合`)
    continue
  }
  const front = text.slice(0, end)

  const name = frontmatterValue(front, 'name')
  const description = frontmatterValue(front, 'description')

  if (!name) fail(`preset/skills/${dir}/SKILL.md 缺少 name`)
  else if (name !== dir) {
    fail(
      `目录名与 frontmatter name 不一致：${dir} ≠ ${name}`,
      '宿主按 name 建立 /ds-* 手势，目录名只是镜像上游时的落点'
    )
  } else {
    if (byName.has(name)) fail(`技能名重复：${name}`)
    byName.set(name, dir)
  }

  if (!description) fail(`preset/skills/${dir}/SKILL.md 缺少 description`, '没有描述就不会进 catalog')
  else {
    totalChars += description.length
    if (description.length > longest.length) longest = { length: description.length, name: dir }
    if (cap > 0 && description.length > cap) {
      fail(
        `preset/skills/${dir} 的描述 ${description.length} 字符，超过上限 ${cap}`,
        '超长会被截断，而上游把「Use when …」放在末尾，截掉就等于失去触发条件'
      )
    }
  }

  bodies.set(dir, text)
}

// ---- 交叉引用：正文里提到的 /ds-* 必须都是真实存在的技能 ----
const referenced = new Set()
for (const [dir, text] of bodies) {
  for (const match of text.matchAll(/[`\s(]\/(ds-[a-z0-9][a-z0-9-]*)/g)) {
    const target = match[1]
    referenced.add(target)
    if (!byName.has(target)) {
      fail(
        `preset/skills/${dir}/SKILL.md 引用了不存在的技能 /${target}`,
        '模型会照着这条手势去加载，然后什么也拿不到'
      )
    }
  }
}

// ---- 技能目录里不该有非技能目录混进来 ----
for (const dir of dirs) {
  if (!existsSync(join(SKILLS, dir, 'SKILL.md'))) {
    notes.push(`  （${dir} 没有 SKILL.md，已按非技能目录跳过）`)
  }
}

// ---- 辅助脚本必须是可执行的文件，不能是空壳 ----
const watchPr = join(SKILLS, 'ds-watch-pr', 'scripts', 'watch_pr.py')
if (existsSync(watchPr)) {
  if (statSync(watchPr).size < 200) fail('ds-watch-pr/scripts/watch_pr.py 过小，可能是空壳')
} else if (byName.has('ds-watch-pr')) {
  fail('ds-watch-pr 技能缺少 scripts/watch_pr.py', '该技能正文依赖这个脚本，缺了会指向一个不存在的文件')
}

// ---- 输出 ----
notes.unshift(`  技能数：${byName.size}，描述合计 ${totalChars} 字符（≈${Math.round(totalChars / 4)} token），最长 ${longest.name} ${longest.length} 字符（上限 ${cap}）`)
notes.unshift(`  交叉引用：${referenced.size} 个 /ds-* 手势`)
for (const note of notes) console.log(note)

if (failures.length === 0) {
  console.log('✅ 技能目录校验通过：命名、描述长度、交叉引用一致')
  process.exit(0)
}
console.error(`\n❌ 技能目录校验失败（${failures.length} 项）\n`)
for (const message of failures) console.error(`  - ${message}\n`)
process.exit(1)
