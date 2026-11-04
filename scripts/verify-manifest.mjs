#!/usr/bin/env node
/**
 * manifest 校验：package.json 是否还是一个装得上、能被宿主正确筛选的 bundle。
 *
 * 三组判据：
 *   1. 元数据自洽（版本格式、许可证、仓库地址与包名对得上）
 *   2. 宿主契约字段（engines / dsh.manifestVersion / dsh.bundle / files 白名单）
 *   3. 发包产物（npm pack 实际打进去的文件 == 白名单，尺寸可追溯）
 *
 *   node scripts/verify-manifest.mjs
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join, relative } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))

const failures = []
const notes = []
const fail = (message, hint) => failures.push(hint ? `${message}\n    → ${hint}` : message)

// ---- 1. 元数据 ----
if (!/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(pkg.version ?? '')) {
  fail(`version 不是合法语义化版本：${pkg.version}`)
}
if (pkg.private === true) {
  fail('private: true 会阻止 npm publish', '本仓库要走 npm 分发，发布前必须去掉这个字段')
}
if (pkg.license !== 'MIT') fail(`license 应为 MIT，实际 ${pkg.license}`)
if (pkg.name !== 'dsh-stack') fail(`包名应为 dsh-stack，实际 ${pkg.name}`)

const repoUrl = pkg.repository?.url ?? ''
if (!repoUrl.includes(`/${pkg.name}`)) {
  fail(
    `repository.url 与包名对不上：${repoUrl}`,
    'npm 页面上的仓库链接由这个字段决定，指错了用户找不到源码'
  )
}

// ---- 2. 宿主契约字段 ----
if (pkg.type !== 'module') fail('type 应为 module', 'st-loop.mjs 与全部校验脚本都是 ESM')

if (!pkg.engines?.node) fail('缺少 engines.node')
else if (!/\^22\.|\>=24/.test(pkg.engines.node)) {
  fail(`engines.node 与宿主要求不符：${pkg.engines.node}`, '宿主自身要求 ^22.19.0 || >=24.0.0')
}
if (!pkg.engines?.dsh) {
  fail(
    '缺少 engines.dsh',
    'dsh 升级时按 engines 做兼容筛选（dsh-plugin-manager/lib/index.js:393）；缺了它，不兼容也不会提示'
  )
}

if (pkg.dsh?.manifestVersion !== 1) fail(`dsh.manifestVersion 应为 1，实际 ${pkg.dsh?.manifestVersion}`)
if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') {
  fail(`dsh.bundle.patch 应为 ./cordis.patch.yml，实际 ${pkg.dsh?.bundle?.patch}`)
}

// 本包只注册预设，没有客户端 UI，因此不该有 dsh.client。
if (pkg.dsh?.client !== undefined) {
  fail('本包没有客户端 UI，不应声明 dsh.client', '声明了会尝试注入 Web 端，而包里没有对应产物')
}

if (!Array.isArray(pkg.files) || pkg.files.length === 0) fail('files 白名单为空')

// ---- 3. 白名单与实际内容 ----
// scripts/ 必须在白名单里：从 npm 装的副本要能跑 `npm test` 自检，
// 而 README「自检」章节的六条命令有四条住在 scripts/ 下。
const required = ['cordis.patch.yml', 'preset', 'test', 'scripts', 'README.md', 'CHANGELOG.md', 'LICENSE']
for (const entry of required) {
  if (!pkg.files?.includes(entry)) fail(`files 白名单里缺少 ${entry}`)
  if (!existsSync(join(ROOT, entry))) fail(`白名单里的 ${entry} 在仓库里不存在`)
}

// 不该进包的：docs/ 与 issues/ 是维护者资料。
// 也不该入库的：AGENTS.md 是维护者本地开发约定，属于仓库外隐私，不能出现在 files 里。
for (const entry of ['docs', 'issues', 'AGENTS.md']) {
  if (pkg.files?.includes(entry)) {
    fail(`files 白名单里不该有 ${entry}`, '维护者资料不进包，装了也看不到')
  }
}

// AGENTS.md 必须被 gitignore 且不在索引里——它是本地文件，不能随仓库公开。
// 从 npm 装的副本里既没有 .gitignore 也没有 .git，这两项自动跳过。
if (existsSync(join(ROOT, '.gitignore'))) {
  const ignore = readFileSync(join(ROOT, '.gitignore'), 'utf8')
  if (!/^AGENTS\.md\s*$/m.test(ignore)) {
    fail('AGENTS.md 没有写进 .gitignore', '本地开发约束不入库，见本地约定')
  }
}
if (existsSync(join(ROOT, '.git'))) {
  try {
    const tracked = execFileSync('git', ['ls-files', '--error-unmatch', 'AGENTS.md'], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'pipe',
    })
    if (tracked.trim()) fail('AGENTS.md 仍在 git 索引里', 'git rm --cached AGENTS.md')
  } catch {
    // 未跟踪 = 期望状态
  }
}

// ---- 4. 实际打包内容 ----
//
// npm pack --dry-run --json 不需要网络，也不会生成 tgz。
let packed = null
try {
  const raw = execFileSync('npm', ['pack', '--dry-run', '--json'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  })
  const info = JSON.parse(raw)[0]
  packed = { files: info.files.map(file => file.path), size: info.size, unpacked: info.unpackedSize }
} catch (error) {
  notes.push(`  （npm pack --dry-run 跳过：${String(error.message).split('\n')[0]}）`)
}

if (packed !== null) {
  const missing = []
  if (!packed.files.includes('cordis.patch.yml')) missing.push('cordis.patch.yml')
  if (!packed.files.some(file => file.startsWith('preset/agent.cordis.yml'))) missing.push('preset/agent.cordis.yml')
  if (!packed.files.some(file => file.startsWith('preset/st-loop.mjs'))) missing.push('preset/st-loop.mjs')
  if (missing.length > 0) fail(`打包产物里缺少关键文件：${missing.join('、')}`, '装完会挂载失败')

  const skills = packed.files.filter(file => /^preset\/skills\/[^/]+\/SKILL\.md$/.test(file))
  if (skills.length !== 29) {
    fail(`打包产物里有 ${skills.length} 个技能，期望 29 个`, '技能目录是唯一事实来源，少一个就少一条能力')
  }

  // 白名单外的文件不该出现（npm 会忽略 .gitignore 里列出的东西）。
  const allowedPrefixes = ['cordis.patch.yml', 'preset/', 'test/', 'scripts/', 'README', 'CHANGELOG', 'NOTICE', 'LICENSE', 'package.json']
  const stray = packed.files.filter(file => !allowedPrefixes.some(prefix => file === prefix || file.startsWith(prefix)))
  if (stray.length > 0) {
    fail(`打包产物里有白名单之外的文件：${stray.slice(0, 5).join('、')}${stray.length > 5 ? ' 等' : ''}`)
  }

  notes.push(`  打包：${packed.files.length} 文件，${(packed.size / 1024).toFixed(0)} KB（解包 ${(packed.unpacked / 1024).toFixed(0)} KB）`)
  notes.push(`  技能：${skills.length} 个`)
}

// ---- 输出 ----
for (const note of notes) console.log(note)
if (failures.length === 0) {
  console.log(`✅ manifest 校验通过：${pkg.name}@${pkg.version}`)
  process.exit(0)
}
console.error(`\n❌ manifest 校验失败（${failures.length} 项）\n`)
for (const message of failures) console.error(`  - ${message}\n`)
process.exit(1)
