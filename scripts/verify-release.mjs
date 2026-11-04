#!/usr/bin/env node
/**
 * 发布门禁与三方对齐校验。
 *
 *   node scripts/verify-release.mjs            # 发布前（prepublishOnly 自动调用）
 *   node scripts/verify-release.mjs --verify   # 发布后自检（npm run verify:release）
 *
 * 铁律：npm 上每个已发布版本，GitHub 必须有对应 commit 与 tag。
 */

import { execFileSync } from 'node:child_process'
import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'))
const version = pkg.version
const tagName = `v${version}`

/**
 * 铁律生效前发布、且 GitHub 上确实没有对应 tag 的历史版本。
 * 只允许往这里加「已经无法追溯」的旧版本，新版本一律不得豁免。
 */
const LEGACY_VERSIONS = new Set()

/**
 * npm 自己在发布流程里创建的占位版本，不是我们发的东西。
 * `0.0.0-stage` 是 npm 做 staged publishing 时先占住包名用的，会出现在 versions 里但没有对应 tag，
 * 也无法补 tag——它根本不对应任何 commit。把它当成真实版本去要求 tag 只会让门禁永远红着。
 */
const NPM_INTERNAL_VERSIONS = new Set(['0.0.0-stage'])

const failures = []
const notes = []

function fail(message, hint) {
  failures.push(hint ? `${message}\n    → ${hint}` : message)
}

function git(args) {
  return execFileSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  }).trim()
}

function tryGit(args) {
  try {
    return git(args)
  } catch {
    return null
  }
}

// ---- 1. 工作区必须干净 ----
const dirty = tryGit(['status', '--porcelain'])
if (dirty === null) {
  fail('不是 git 仓库，无法校验版本对齐')
} else if (dirty !== '') {
  const lines = dirty.split('\n')
  fail(
    `工作区有 ${lines.length} 处未提交改动，禁止发布`,
    '先 git add -A && git commit，再打 tag、push，最后才 npm publish'
  )
}

// ---- 2. tag 之后，进包的内容不能变过 ----
//
// 真正的约束是「npm 上发布的内容 == tag 指向的内容」，不是「HEAD 正好等于 tag」。
// 用后者会让任何不进包的提交（.github/、docs/、scripts/）把校验打红，
// 逼着为一行 CI 配置发一个内容完全相同的版本号。
const head = tryGit(['rev-parse', 'HEAD'])
const tagCommit = tryGit(['rev-list', '-n', '1', tagName])

if (head === null) {
  fail('读不到 HEAD commit')
} else if (tagCommit === null) {
  fail(
    `本地不存在 tag ${tagName}，GitHub 侧将无法追溯这个版本`,
    `git tag ${tagName} && git push origin main && git push origin ${tagName}`
  )
} else if (tagCommit !== head) {
  const shipped = ['package.json', ...(Array.isArray(pkg.files) ? pkg.files : [])]
  const changed = tryGit(['diff', '--name-only', tagName, head, '--', ...shipped])

  if (changed === null) {
    fail(`无法比较 tag ${tagName} 与 HEAD 的差异`, 'git 读不到这两个 commit 时无法判断进包内容是否变过')
  } else if (changed !== '') {
    const list = changed.split('\n')
    fail(
      `tag ${tagName} 之后有 ${list.length} 个进包文件变化：${list.slice(0, 5).join('、')}${list.length > 5 ? ' 等' : ''}`,
      '进包内容变了就必须升版本、重新打 tag；只改不进包的文件（docs/、scripts/、.github/）不需要'
    )
  }
}

// ---- 3. CHANGELOG 必须有当前版本的小节 ----
const changelogPath = join(ROOT, 'CHANGELOG.md')
if (!existsSync(changelogPath)) {
  fail('缺少 CHANGELOG.md', '铁律要求每个版本都必须有对应小节')
} else {
  const changelog = readFileSync(changelogPath, 'utf8')
  if (!new RegExp(`^## \\[${version.replace(/\./g, '\\.')}\\] - \\d{4}-\\d{2}-\\d{2}`, 'm').test(changelog)) {
    fail(
      `CHANGELOG.md 里没有 ${version} 的小节`,
      `补一行 \`## [${version}] - YYYY-MM-DD\`，分类用 新增/修复/变更/文档/移除`
    )
  }
}

// ---- 4. 发布后自检：三方比对 ----
if (process.argv.includes('--verify')) {
  const remote = pkg.repository?.url?.replace(/^git\+/, '').replace(/\.git$/, '')
  notes.push(`本地版本：${version}`)
  notes.push(`tag ${tagName}：${tagCommit ? tagCommit.slice(0, 8) : '缺失'}`)

  try {
    const res = await fetch(`https://registry.npmjs.org/${pkg.name}`, {
      headers: { accept: 'application/vnd.npm.install-v1+json' },
    })
    if (res.status === 404) {
      fail(`npm 上还没有 ${pkg.name}`, '首次发布前这条自检不适用；发布后再跑一次')
    } else if (!res.ok) {
      throw new Error(`registry 返回 ${res.status}`)
    } else {
      const meta = await res.json()
      const latest = meta['dist-tags']?.latest
      const published = Object.keys(meta.versions ?? {})

      notes.push(`npm latest：${latest}`)
      notes.push(`npm 已发布：${published.join(', ')}`)

      if (latest !== version) {
        fail(
          `npm latest 是 ${latest}，本地是 ${version}`,
          '要么发布新版本，要么回滚本地版本号'
        )
      }

      for (const v of published) {
        if (NPM_INTERNAL_VERSIONS.has(v)) {
          notes.push(`  （npm 内部占位版本，不对应 commit）${v}`)
          continue
        }
        const remoteTag = tryGit(['rev-list', '-n', '1', `v${v}`])
        if (remoteTag !== null) continue
        if (LEGACY_VERSIONS.has(v)) {
          notes.push(`  （历史遗留，豁免）npm 有 ${v}，GitHub 无 tag`)
          continue
        }
        fail(
          `npm 上有 ${v}，但 GitHub 没有对应 tag v${v}`,
          `补 tag：git tag v${v} <该版本对应的 commit> && git push origin v${v}`
        )
      }
    }

    if (remote) notes.push(`仓库：${remote}`)
  } catch (error) {
    fail(`无法查询 npm registry：${error.message}`, '断网或代理问题时无法完成对齐校验，请稍后重试')
  }
}

// ---- 输出 ----
for (const note of notes) console.log(`  ${note}`)

if (failures.length === 0) {
  console.log(
    process.argv.includes('--verify')
      ? `✅ npm 与 GitHub 对齐：${pkg.name}@${version}（tag ${tagName}）`
      : `✅ 发布前置检查通过：${pkg.name}@${version}，tag ${tagName} 已就位`
  )
  process.exit(0)
}

console.error(`\n❌ 发布校验失败（${failures.length} 项）\n`)
for (const message of failures) console.error(`  - ${message}\n`)
console.error('铁律：Git 先行，npm 后发。\n')
process.exit(1)
