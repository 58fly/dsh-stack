#!/usr/bin/env node
/**
 * 宿主行契约校验：预设里的每一行，当前宿主能不能真的加载。
 *
 * 两种模式：
 *   1. 有可读宿主（DSH_ROOT / 仓库内 @deepseek-ai/dsh / 解包后的 App）→ 真实解析，
 *      并额外用该行导出的 `Config`（zod）校验我们给的 config 键。
 *   2. 没有宿主（CI 就是这样，本包零依赖）→ 用 test/host-surface.json 的说明符快照判定。
 *      快照由 scripts/snapshot-host-surface.mjs 生成，宿主升级后重跑。
 *
 * 为什么不允许跳过：一个解析不了的行会让整个预设进 broken —— 配置页显示「加载失败」、
 * 会话选择器里选不到，而宿主自己不报错。0.3.1 就是这么发出去的。
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PRESET = resolvePath(ROOT, process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : 'preset/agent.cordis.yml')
const PRESET_DIR = dirname(PRESET)
const SNAPSHOT_PATH = join(ROOT, 'test/host-surface.json')

const CANDIDATES = [
  process.env.DSH_ROOT,
  join(ROOT, 'node_modules/@deepseek-ai/dsh'),
  '/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh',
  '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar/dsh',
].filter(Boolean)

function usable(dir) {
  if (!existsSync(join(dir, 'package.json'))) return false
  try {
    createRequire(join(dir, 'package.json')).resolve('@deepseek-ai/dsh-agent-preset')
    return true
  } catch {
    return false
  }
}

const HOST = CANDIDATES.find(usable)
const snapshot = existsSync(SNAPSHOT_PATH) ? JSON.parse(readFileSync(SNAPSHOT_PATH, 'utf8')) : null

if (HOST === undefined && snapshot === null) {
  console.error('✖ 没有可读宿主，也没有 test/host-surface.json 快照，无法校验预设行')
  console.error('  二选一：npm i --no-save @deepseek-ai/dsh@<版本>，或 node scripts/snapshot-host-surface.mjs')
  process.exit(1)
}

const hostRequire = HOST ? createRequire(join(HOST, 'package.json')) : null
const specifierSet = new Set(snapshot?.specifiers ?? [])

// !!js 表达式（含 >- 折叠块）无法在此求值，替换成占位标量，只保留「这个键存在」
function normalize(src) {
  const lines = src.split('\n')
  const out = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const m = /^(\s*(?:-\s+)?[^#:\n][^:\n]*:)\s*!!js\s*(.*)$/.exec(line)
    if (!m) { out.push(line); continue }
    const indent = line.length - line.trimStart().length
    const block = m[2] === '' || m[2].startsWith('>') || m[2].startsWith('|')
    out.push(`${m[1]} "__JS__"`)
    if (block) {
      let j = i + 1
      while (j < lines.length && (lines[j].trim() === '' || lines[j].length - lines[j].trimStart().length > indent)) j++
      i = j - 1
    }
  }
  return out.join('\n')
}

let YAML
if (HOST) {
  YAML = (await import(pathToFileURL(hostRequire.resolve('yaml')).href)).default
} else {
  // 没有宿主时的极简解析：只抽 id / name / 一级 config 键，够做说明符与键名核对
  YAML = { parse: () => simpleParse(readFileSync(PRESET, 'utf8').replace(/!!js\s+(?:>-\s*)?\n(?:[ \t]+.*\n)*/g, '"__JS__"\n')) }
}

/**
 * 无宿主兜底解析：只关心 `- id:` / `name:` / `config:` 下的直接键名。
 * 不追求通用，够覆盖本仓库这份预设的形状即可（有宿主时一律走真 yaml）。
 */
function simpleParse(text) {
  const rows = []
  const stack = []
  let current = null
  for (const raw of text.split('\n')) {
    const line = raw.replace(/\s+#.*$/, '')
    if (line.trim() === '' || line.trim().startsWith('#')) continue
    const indent = line.length - line.trimStart().length
    const idMatch = /^\s*-\s+id:\s*(\S+)/.exec(line)
    if (idMatch) {
      current = { id: idMatch[1] }
      rows.push(current)
      stack.push({ indent, row: current })
      continue
    }
    const nameMatch = /^\s*name:\s*['"]?([^'"\n]+?)['"]?\s*$/.exec(line)
    if (nameMatch && current) { current.name = nameMatch[1].trim(); continue }
    if (/^\s*config:\s*$/.test(line) && current) { current.config = {}; current._configIndent = indent; continue }
    if (current?.config && indent > current._configIndent) {
      const kv = /^\s*([A-Za-z_$][\w$]*):/.exec(line)
      if (kv) current.config[kv[1]] = '__ANY__'
    }
  }
  for (const row of rows) delete row._configIndent
  return { plugins: rows }
}

const doc = YAML.parse(normalize(readFileSync(PRESET, 'utf8')))

const rows = []
function walk(list) {
  for (const row of list ?? []) {
    if (!row || typeof row !== 'object') continue
    rows.push(row)
    if (Array.isArray(row.config)) walk(row.config)
  }
}
walk(doc.plugins ?? doc)

let failed = 0
const ok = (label) => console.log(`  ok  ${label}`)
const bad = (label, detail) => { failed++; console.log(`  ✖   ${label}\n        ${detail}`) }

for (const row of rows) {
  const name = row.name
  if (typeof name !== 'string') continue
  if (name.startsWith('cordis:') || name.startsWith('file:')) continue

  // 1) 说明符
  let target
  if (name.startsWith('.')) {
    target = resolvePath(PRESET_DIR, name)
    if (!existsSync(target)) { bad(`${row.id} (${name})`, '相对路径不存在'); continue }
  } else if (HOST) {
    try {
      target = hostRequire.resolve(name)
    } catch (error) {
      bad(`${row.id} (${name})`, `${error.code}: 宿主解析不了这个说明符`)
      continue
    }
  } else if (!specifierSet.has(name)) {
    bad(`${row.id} (${name})`, `快照 ${snapshot.hostName}@${snapshot.hostVersion} 里没有这个说明符（宿主收回了子路径？重跑 scripts/snapshot-host-surface.mjs 并 review 增删）`)
    continue
  }

  // 2) config（只有真宿主能验 schema）
  if (HOST && target && row.config && typeof row.config === 'object' && !Array.isArray(row.config)) {
    let mod
    try {
      mod = await import(pathToFileURL(target).href)
    } catch (error) {
      bad(`${row.id} (${name})`, `import 失败：${error.message}`)
      continue
    }
    const Config = mod.Config
    if (Config?.safeParse) {
      const result = Config.safeParse(row.config)
      if (!result.success) {
        bad(`${row.id} (${name})`, `config 不被接受：${JSON.stringify(result.error.issues)}`)
        continue
      }
    }
  }
  ok(`${row.id} (${name})`)
}

const source = HOST ? `真实宿主 ${HOST}` : `说明符快照 ${snapshot.hostName}@${snapshot.hostVersion}`
console.log(`\n${rows.length} 行 · 依据：${source}`)
if (failed > 0) {
  console.log(`❌ ${failed} 行当前宿主加载不了 —— 装上去就是「加载失败」`)
  process.exit(1)
}
console.log('✅ 每一行都能被当前宿主解析并接受')
