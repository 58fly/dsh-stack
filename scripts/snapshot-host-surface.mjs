#!/usr/bin/env node
/**
 * 把当前宿主的「可解析说明符」快照进 test/host-surface.json。
 *
 *   node scripts/snapshot-host-surface.mjs                 # 用自动发现的宿主
 *   DSH_ROOT=/tmp/dsh-asar/dsh node scripts/snapshot-host-surface.mjs
 *
 * 为什么要快照：CI 里没有 DSH 安装（本包零依赖，不装 918 MB 的宿主依赖树），
 * 但「预设里写了一个当前宿主没有的说明符」必须能挡住发布。快照让这条校验
 * 在没有宿主的机器上也是确定的、秒级的。
 *
 * 宿主升级后要重新生成，并肉眼确认新增/删除的说明符——尤其是一次子路径被
 * 收回（0.3.1 的 ./list-agents 就是这样消失的）。
 */
import { createRequire } from 'node:module'
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'test/host-surface.json')

const CANDIDATES = [
  process.env.DSH_ROOT,
  resolvePath(ROOT, 'node_modules/@deepseek-ai/dsh'),
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
if (HOST === undefined) {
  console.error('✖ 找不到可读的宿主。先解包 App 或 npm i --no-save @deepseek-ai/dsh@<版本>')
  process.exit(1)
}

const hostPkg = JSON.parse(readFileSync(join(HOST, 'package.json'), 'utf8'))
const require_ = createRequire(join(HOST, 'package.json'))

// 扫描范围：宿主能解析到的 @deepseek-ai/* 包（含 cordis 系列）
const scopeDir = dirname(dirname(require_.resolve('@deepseek-ai/dsh-agent-preset/package.json')))
const packages = readdirSync(scopeDir).filter((name) => !name.startsWith('.'))

const specifiers = new Set()
const versions = {}
for (const name of packages) {
  const full = `@deepseek-ai/${name}`
  let manifestPath
  try {
    manifestPath = require_.resolve(`${full}/package.json`)
  } catch {
    continue
  }
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  versions[full] = manifest.version
  const exportsField = manifest.exports
  const subs = ['.']
  if (typeof exportsField === 'string') {
    // 纯字符串导出，只有根
  } else if (exportsField && typeof exportsField === 'object') {
    for (const key of Object.keys(exportsField)) {
      if (key === '.') continue
      if (key.startsWith('./')) subs.push(key.slice(2))
    }
  }
  for (const sub of subs) {
    const spec = sub === '.' ? full : `${full}/${sub}`
    // 只有真的能 resolve 才算数
    try {
      require_.resolve(spec)
      specifiers.add(spec)
    } catch {}
  }
}

const sorted = [...specifiers].sort()
const payload = {
  '//': '由 scripts/snapshot-host-surface.mjs 生成。宿主升级后重跑，并 review 增删项。',
  hostVersion: hostPkg.version,
  hostName: hostPkg.name,
  generatedFrom: HOST,
  count: sorted.length,
  specifiers: sorted,
}
writeFileSync(OUT, `${JSON.stringify(payload, null, 2)}\n`)

console.log(`✅ 快照已写入 test/host-surface.json`)
console.log(`   宿主 ${hostPkg.name}@${hostPkg.version}：${packages.length} 个包，${sorted.length} 个可解析说明符`)
