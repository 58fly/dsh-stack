#!/usr/bin/env node
/**
 * 挂载校验：把包按真实安装形态铺进一个临时 profile，让宿主自己的装载器解析，
 * 确认两处相对路径各自落在正确的文件上。
 *
 * 为什么需要它：`cordis.patch.yml` 里两种相对路径的**基准不同**，而且从代码上
 * 看不出来，写错了不是「功能不对」而是「装完加载失败」：
 *
 *   - `insert[].name` 以 **patch 文件所在目录**（即包目录）为基准，被
 *     `anchorInsertedPluginNames` 重写成 `file://` URL（dsh-app-boot/lib/index.js）；
 *     所以守卫行必须是 `./preset/uninstall-guard.mjs`。
 *   - `cordis:include` 的 `config.path` 不被上述重写处理，运行时按 **profile 目录**
 *     解析（`new URL(path, baseUrl)`）；所以 include 行必须是
 *     `./node_modules/dsh-stack/preset/agent.cordis.yml`。
 *
 * 两者混用会多出一层 `node_modules/`，`existsSync` 为 false，加载即失败。
 * 静态断言（`verify-preset.mjs`）只能检查字符串写对了，检查不了它解析到哪 ——
 * 这一层必须交给宿主自己的 `loadProfileDirectory`。
 *
 *   node scripts/verify-mount.mjs
 *   DSH_ROOT=/path/to/dsh node scripts/verify-mount.mjs
 *
 * 找不到宿主时打印 SKIP 并 exit 0（CI 上没有 DSH 是正常情况）。
 * 临时 profile 用完即删；`node_modules/dsh-stack` 用符号链接指回仓库根，
 * 顺带覆盖 link 安装（pnpm link / 本地调试）这一形态。
 */

import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync, readFileSync, existsSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** 桌面版安装目录；DSH_ROOT 覆盖（CI 或非标准安装路径）。与 verify-host-api 保持一致。 */
const CANDIDATES = [
  process.env.DSH_ROOT,
  '/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh',
  '/Applications/DeepSeek-Harness.app/Contents/Resources/app/dsh',
].filter(Boolean)

const root = CANDIDATES.find(candidate => existsSync(join(candidate, 'node_modules', '@deepseek-ai')))
if (root === undefined) {
  const asarCandidates = [
    '/Applications/DeepSeek Harness.app/Contents/Resources/app.asar',
    '/Applications/DeepSeek-Harness.app/Contents/Resources/app.asar',
  ]
  const asar = asarCandidates.find(candidate => existsSync(candidate))
  if (asar !== undefined) {
    console.log(`SKIP 宿主以 asar 打包，普通 node 读不进去：${asar}`)
    console.log('     解包后指定 DSH_ROOT 再跑：')
    console.log(`       npx @electron/asar extract "${asar}" /tmp/dsh-asar && DSH_ROOT=/tmp/dsh-asar/dsh node scripts/verify-mount.mjs`)
  }
  else {
    console.log('SKIP 没找到 DSH 安装，跳过挂载校验（可用 DSH_ROOT 指定）')
  }
  process.exit(0)
}

const appBoot = join(root, 'node_modules', '@deepseek-ai', 'dsh-app-boot', 'lib', 'index.js')
if (!existsSync(appBoot)) {
  console.log(`SKIP 宿主的 dsh-app-boot 不在预期位置：${appBoot}`)
  process.exit(0)
}

const { loadProfileDirectory } = await import(pathToFileURL(appBoot).href)

let passed = 0
const failures = []
const check = (label, fn) => {
  try {
    const ok = fn()
    if (ok === false) throw new Error('returned false')
    passed += 1
    console.log(`  ok  ${label}`)
  }
  catch (error) {
    failures.push(`${label}: ${error instanceof Error ? error.message : String(error)}`)
    console.log(`  FAIL ${label} — ${error instanceof Error ? error.message : String(error)}`)
  }
}

const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf8'))
const profileDir = realpathSync(mkdtempSync(join(tmpdir(), 'dsh-stack-mount-')))

try {
  mkdirSync(join(profileDir, 'node_modules'), { recursive: true })
  symlinkSync(REPO_ROOT, join(profileDir, 'node_modules', pkg.name), process.platform === 'win32' ? 'junction' : 'dir')
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'mount-check-profile',
    private: true,
    version: '0.0.0',
    dependencies: { [pkg.name]: `link:./node_modules/${pkg.name}` },
    dsh: { profile: { bundles: [pkg.name] } },
  }, null, 2)}\n`)

  const out = await loadProfileDirectory('dsh', profileDir, dirname(profileDir))

  // 把合成后的行拍平：patch.insert 里的行，加上它们嵌套的 plugins 与 config.plugins。
  const rows = []
  const walk = (list) => {
    for (const row of list ?? []) {
      rows.push(row)
      walk(row?.plugins)
      walk(Array.isArray(row?.config) ? row.config : row?.config?.plugins)
    }
  }
  for (const layer of out.layers ?? []) for (const patch of layer.patches ?? []) walk(patch.insert)

  const guard = rows.find(row => row.id === 'st-stack-uninstall-guard')
  const include = rows.find(row => row.id === 'dsh-stack-composition')
  const preset = rows.find(row => row.id === 'preset-dsh-stack')

  const toPath = (url) => {
    try { return decodeURIComponent(new URL(url).pathname) }
    catch { return String(url) }
  }

  check('预设声明行被合成出来', () => preset !== undefined)
  check('卸载守卫行被合成出来', () => guard !== undefined)
  check('守卫行解析成 file:// URL（说明走了 anchor 重写）', () => String(guard?.name ?? '').startsWith('file://'))
  check('守卫路径落在包目录下，没有多余的 node_modules 层', () => {
    const path = toPath(guard?.name)
    if (path.includes(`/${pkg.name}/node_modules/`)) throw new Error(`多了一层 node_modules：${path}`)
    return path.endsWith(`/node_modules/${pkg.name}/preset/uninstall-guard.mjs`)
  })
  check('守卫模块文件真实存在', () => existsSync(toPath(guard?.name)))
  check('include 仍按 profile 目录解析（未被 anchor 改写）', () => include?.config?.path === `./node_modules/${pkg.name}/preset/agent.cordis.yml`)
  check('include 目标文件真实存在', () => existsSync(join(profileDir, include?.config?.path ?? '')))
  check('三处预设 id 一致', () => preset?.config?.id === guard?.config?.presetId && preset?.config?.id === 'dsh-stack')
  check('fallback 指向内置 standard', () => guard?.config?.fallbackId === 'standard')
}
finally {
  rmSync(profileDir, { recursive: true, force: true })
}

if (failures.length > 0) {
  console.log(`\n❌ 挂载校验失败 ${failures.length} 项：`)
  for (const failure of failures) console.log(`   - ${failure}`)
  process.exit(1)
}

console.log(`\n✅ 挂载校验通过（${passed} 项）：两处相对路径各自解析正确，包能被宿主装载`)
