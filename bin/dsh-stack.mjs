#!/usr/bin/env node
/**
 * dsh-stack — 安装生命周期命令行。
 *
 * 三个子命令，对应三种时机：
 *
 *   status     看一眼：本包在每个 profile 里是否可用、默认预设指针指向谁。
 *   doctor     体检 +（--fix）修复：悬空指针、残留 bundles/依赖/目录/lock、旧会话缓存。
 *   uninstall  优雅卸载：**先收指针再删包**，顺序反过来就会留下宿主崩溃的窗口。
 *
 * 为什么要有它：插件被停用或卸载后，宿主不会清理 `selectedDefault` 指针
 * （dsh-plugin-manager/lib/index.js:3064-3080 只删 bundles 项），于是下一次
 * `presets.resolve()` 抛 `agent-preset/not-found`，新建会话失败的锅落在插件头上。
 * `preset/uninstall-guard.mjs` 在运行期把这条路径堵住；本命令处理它堵不到的两种
 * 情况：宿主已经崩过、或者用户直接 `rm -rf node_modules/dsh-stack` 而没有走
 * 停用流程。
 *
 *   npx dsh-stack doctor
 *   npx dsh-stack doctor --fix
 *   npx dsh-stack uninstall
 *
 * 全部操作用文本级定向改写，不重排用户的 YAML/JSON，且可重复执行。
 */

import { existsSync, realpathSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  PRESET_ID,
  FALLBACK_PRESET_ID,
  PACKAGE_NAME,
  resolveDshHome,
  listProfiles,
  inspectProfile,
  readText,
  writeTextAtomic,
  readSelectedDefault,
  patchDisablesPreset,
  repairProfile,
  forceClearPointer,
  editProfileManifest,
  pruneProjections,
} from '../preset/lifecycle.mjs'

const USAGE = `dsh-stack — 安装生命周期命令

用法：
  dsh-stack status                    查看每个 profile 的安装状态与默认预设指针
  dsh-stack doctor [--fix]            体检；--fix 修复可修项
  dsh-stack uninstall [--keep-sessions] [--yes]
                                      优雅卸载：先收指针，再删 bundle/依赖/目录

选项：
  --home <路径>       DSH home（默认 $DSH_HOME 或 ~/.dsh）
  --profile <名字>    只处理指定 profile（默认全部）
  --sessions          同时清理旧会话投影缓存里残留的 agentPreset（doctor 需要显式开启）
  --keep-sessions     uninstall 时保留会话投影缓存（不推荐）
  --dry-run           只报告，不写盘
  --json              输出 JSON
  -h, --help          显示本说明

退出码：0 无问题或已修好，1 仍有需要人工处理的问题。`

/** 极简参数解析：本命令的选项都是布尔或单值，够用且零依赖。 */
function parseArgs(argv) {
  const options = {
    command: 'status',
    fix: false,
    sessions: false,
    keepSessions: false,
    dryRun: false,
    json: false,
    yes: false,
    home: null,
    profile: null,
    help: false,
  }
  const rest = [...argv]
  while (rest.length > 0) {
    const arg = rest.shift()
    if (arg === '-h' || arg === '--help') options.help = true
    else if (arg === '--fix') options.fix = true
    else if (arg === '--sessions') options.sessions = true
    else if (arg === '--keep-sessions') options.keepSessions = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--json') options.json = true
    else if (arg === '--yes' || arg === '-y') options.yes = true
    else if (arg === '--home') options.home = rest.shift() ?? null
    else if (arg === '--profile') options.profile = rest.shift() ?? null
    else if (!arg.startsWith('-')) options.command = arg
    else {
      console.error(`未知选项：${arg}`)
      console.error(USAGE)
      process.exit(1)
    }
  }
  return options
}

const ICON = { ok: '✓', info: '·', warn: '!', error: '✖', fixed: '✔', skipped: '-' }

/** 收集一个 profile 的全部体检项。每项都能带一个 `apply()`，只有 --fix 才调用。 */
function diagnose(state) {
  const items = []
  const selected = readSelectedDefault(state.patchText)
  const disabled = state.disabled

  if (selected === PRESET_ID && !state.usable) {
    const why = []
    if (!state.packagePresent) why.push('包不在 node_modules')
    if (!state.bundleListed) why.push('bundles 里没有它')
    if (disabled) why.push('预设行被 disabled')
    items.push({
      id: 'pointer-dangling',
      severity: 'error',
      message: `默认预设指向 ${PRESET_ID}，但本插件已不可用（${why.join('、')}）—— 新建会话会抛 agent-preset/not-found`,
      fix: () => repairProfile(state, { presetId: PRESET_ID, fallbackId: FALLBACK_PRESET_ID, packageName: PACKAGE_NAME }),
    })
  } else if (selected === PRESET_ID) {
    items.push({ id: 'pointer-ok', severity: 'ok', message: `默认预设为 ${PRESET_ID}（插件可用，正常）` })
  } else if (selected === null) {
    items.push({ id: 'pointer-unset', severity: 'ok', message: '默认预设未指定（未用过本预设，或从没改过）' })
  } else {
    items.push({ id: 'pointer-other', severity: 'ok', message: `默认预设为 ${selected}` })
  }

  if (state.bundleListed && !state.packagePresent) {
    items.push({
      id: 'bundle-stale',
      severity: 'warn',
      message: `bundles 里还留着 ${PACKAGE_NAME}，但目录已经不存在（每次启动都会尝试加载一个不存在的包）`,
      fix: () => editProfileManifest(state, parsed => {
        const bundles = parsed?.dsh?.profile?.bundles
        if (!Array.isArray(bundles) || !bundles.includes(PACKAGE_NAME)) return { changed: false, reason: 'not-listed' }
        parsed.dsh.profile.bundles = bundles.filter(entry => entry !== PACKAGE_NAME)
        return { changed: true, reason: 'bundle-removed' }
      }),
    })
  }

  const dependency = state.manifest.dependencies[PACKAGE_NAME]
  if (dependency !== undefined && !state.packagePresent) {
    items.push({
      id: 'dependency-stale',
      severity: 'warn',
      message: `package.json 的 dependencies 里还留着 ${PACKAGE_NAME}`,
      fix: () => editProfileManifest(state, parsed => {
        if (parsed?.dependencies?.[PACKAGE_NAME] === undefined) return { changed: false, reason: 'not-listed' }
        delete parsed.dependencies[PACKAGE_NAME]
        return { changed: true, reason: 'dependency-removed' }
      }),
    })
  }

  if (state.packagePresent && dependency === undefined && !state.bundleListed) {
    items.push({
      id: 'orphan-install',
      severity: 'info',
      message: `node_modules/${PACKAGE_NAME} 还在，但依赖与 bundles 都不引用它（孤立安装）`,
      fix: () => {
        rmSync(join(state.dir, 'node_modules', PACKAGE_NAME), { recursive: true, force: true })
        return { changed: true, reason: 'orphan-removed' }
      },
    })
  }

  const workspaceYaml = readText(join(state.dir, 'pnpm-workspace.yaml'))
  if (workspaceYaml !== null && dependency === undefined) {
    const hit = stripBuiltDependency(workspaceYaml, PACKAGE_NAME)
    if (hit.changed) {
      items.push({
        id: 'workspace-built',
        severity: 'info',
        message: 'pnpm-workspace.yaml 的 onlyBuiltDependencies 里还留着本包',
        fix: () => {
          writeTextAtomic(join(state.dir, 'pnpm-workspace.yaml'), hit.text)
          return { changed: true, reason: 'workspace-pruned' }
        },
      })
    }
  }

  const lock = readText(join(state.dir, 'pnpm-lock.yaml'))
  if (lock !== null && dependency === undefined && lock.includes(PACKAGE_NAME)) {
    items.push({
      id: 'lockfile-stale',
      severity: 'info',
      message: `pnpm-lock.yaml 里还记着 ${PACKAGE_NAME}（不致命，重装依赖时会自动收敛）`,
      fix: () => ({ changed: false, reason: 'run-pnpm-install' }),
      hint: '在该 profile 目录运行 pnpm install 即可收敛',
    })
  }

  return items
}

/**
 * 从 `onlyBuiltDependencies` 列表里删掉一个包名。
 *
 * 只动这一条列表里的那一行：其他列表和注释原样保留，缩进用命中行的原缩进，
 * 所以用户手写的 YAML 风格不会被改写。
 */
function stripBuiltDependency(text, packageName) {
  const lines = text.split('\n')
  let inBlock = false
  let blockIndent = 0
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const header = /^(\s*)onlyBuiltDependencies:\s*(?:#.*)?$/.exec(line)
    if (header !== null) {
      inBlock = true
      blockIndent = header[1].length
      continue
    }
    if (!inBlock) continue
    const item = /^(\s*)-\s*["']?([^"'\s#]+)["']?\s*(?:#.*)?$/.exec(line)
    if (item !== null) {
      if (item[2] === packageName) {
        lines.splice(index, 1)
        return { text: lines.join('\n'), changed: true }
      }
      continue
    }
    if (/^\s*(?:#.*)?$/.test(line)) continue
    // 任何别的键都意味着这个列表结束了。
    inBlock = false
  }
  return { text, changed: false }
}

/** 选中的 profile 列表。 */
function selectProfiles(home, name) {
  const all = listProfiles(home)
  if (name === null) return all
  const picked = all.filter(profile => profile.name === name)
  if (picked.length === 0) {
    console.error(`找不到 profile：${name}（可用：${all.map(profile => profile.name).join('、') || '无'}）`)
    process.exit(1)
  }
  return picked
}

function commandStatus(home, profiles, options) {
  const report = profiles.map(profile => {
    const state = inspectProfile(profile)
    return {
      profile: profile.name,
      dir: profile.dir,
      packagePresent: state.packagePresent,
      bundleListed: state.bundleListed,
      disabled: state.disabled,
      usable: state.usable,
      selectedDefault: readSelectedDefault(state.patchText),
      dependency: state.manifest.dependencies[PACKAGE_NAME] ?? null,
    }
  })
  if (options.json) {
    console.log(JSON.stringify({ home, presetId: PRESET_ID, profiles: report }, null, 2))
    return 0
  }
  console.log(`dsh-stack status — home: ${home}`)
  if (report.length === 0) {
    console.log('  （没有任何 profile）')
    return 0
  }
  for (const entry of report) {
    const verdict = entry.usable ? '可用' : '不可用'
    console.log(`\n  profile ${entry.profile}  ${verdict}`)
    console.log(`    包目录      ${entry.packagePresent ? '在' : '不在'}`)
    console.log(`    bundles     ${entry.bundleListed ? '已登记' : '未登记'}`)
    console.log(`    依赖声明    ${entry.dependency === null ? '无' : entry.dependency}`)
    console.log(`    预设行禁用  ${entry.disabled ? '是' : '否'}`)
    console.log(`    默认预设    ${entry.selectedDefault ?? '（未设置）'}`)
  }
  return 0
}

function commandDoctor(home, profiles, options) {
  const report = []
  let failures = 0
  for (const profile of profiles) {
    const state = inspectProfile(profile)
    const items = diagnose(state)
    const results = []
    for (const item of items) {
      let outcome = null
      if (options.fix && typeof item.fix === 'function') {
        if (options.dryRun) {
          outcome = { changed: false, reason: 'dry-run' }
        } else {
          try {
            outcome = item.fix()
          } catch (error) {
            outcome = { changed: false, reason: `error:${(error && error.message) || error}` }
          }
        }
      }
      if (outcome?.changed === true) item.status = 'fixed'
      else if (outcome !== null && outcome.reason === 'run-pnpm-install') item.status = 'skipped'
      else if (outcome !== null) item.status = 'skipped'
      if (item.severity === 'error' && item.status !== 'fixed') failures += 1
      results.push({ ...item, outcome })
    }
    report.push({ profile: profile.name, dir: profile.dir, usable: state.usable, items: results })
  }

  let sessionStats = null
  if (options.sessions) {
    const results = pruneProjections(home, {
      presetId: PRESET_ID,
      fallbackId: FALLBACK_PRESET_ID,
      dryRun: options.dryRun || !options.fix,
    })
    const touched = results.filter(result => result.changed || String(result.reason).startsWith('would-rewrite'))
    sessionStats = { scanned: results.length, touched: touched.length, detail: touched }
  }

  if (options.json) {
    console.log(JSON.stringify({ home, fix: options.fix, profiles: report, sessions: sessionStats }, null, 2))
    return failures > 0 ? 1 : 0
  }

  console.log(`dsh-stack doctor — home: ${home}${options.fix ? '（--fix）' : ''}`)
  if (report.length === 0) console.log('  （没有任何 profile）')
  for (const entry of report) {
    console.log(`\n  profile ${entry.profile}`)
    for (const item of entry.items) {
      const icon = ICON[item.status ?? item.severity] ?? ICON.info
      console.log(`    ${icon} ${item.message}`)
      if (item.hint) console.log(`      → ${item.hint}`)
      if (item.status === 'fixed') console.log(`      → 已修复：${item.outcome.reason}`)
      if (item.status === 'skipped' && item.outcome && item.severity === 'error') {
        console.log(`      → 未修复：${item.outcome.reason}`)
      }
    }
  }
  if (sessionStats !== null) {
    console.log(`\n  会话投影缓存：扫描 ${sessionStats.scanned} 个文件，命中 ${sessionStats.touched} 个`)
    if (!options.fix) console.log('  （加 --fix 才会写回；--sessions 只处理 agentPreset 字段，不动会话正文）')
  }
  if (failures > 0) {
    console.log('\n仍有会导致宿主异常的问题。修复方式：npx dsh-stack doctor --fix')
    return 1
  }
  console.log('\n没有会导致宿主异常的问题。')
  return 0
}

function commandUninstall(home, profiles, options) {
  const steps = []
  const record = (label, outcome) => steps.push({ label, ...outcome })

  for (const profile of profiles) {
    // 1. 先收指针 —— 顺序不能反：删包之后再收指针是被动的，中间那一刻已经在崩了。
    record(`${profile.name}: 收默认预设指针`, forceClearPointer(profile, {
      presetId: PRESET_ID,
      fallbackId: FALLBACK_PRESET_ID,
    }))

    // 2. 从 bundles 与 dependencies 摘掉，再删目录。
    record(`${profile.name}: 移除 bundles 登记`, editProfileManifest(profile, parsed => {
      const bundles = parsed?.dsh?.profile?.bundles
      if (!Array.isArray(bundles) || !bundles.includes(PACKAGE_NAME)) return { changed: false, reason: 'not-listed' }
      parsed.dsh.profile.bundles = bundles.filter(entry => entry !== PACKAGE_NAME)
      return { changed: true, reason: 'bundle-removed' }
    }))
    record(`${profile.name}: 移除 dependencies 声明`, editProfileManifest(profile, parsed => {
      if (parsed?.dependencies?.[PACKAGE_NAME] === undefined) return { changed: false, reason: 'not-listed' }
      delete parsed.dependencies[PACKAGE_NAME]
      return { changed: true, reason: 'dependency-removed' }
    }))
    const workspaceYaml = readText(join(profile.dir, 'pnpm-workspace.yaml'))
    if (workspaceYaml !== null) {
      const hit = stripBuiltDependency(workspaceYaml, PACKAGE_NAME)
      if (hit.changed) {
        writeTextAtomic(join(profile.dir, 'pnpm-workspace.yaml'), hit.text)
        record(`${profile.name}: 清理 pnpm-workspace.yaml`, { changed: true, reason: 'workspace-pruned' })
      }
    }
    const installed = join(profile.dir, 'node_modules', PACKAGE_NAME)
    if (existsSync(installed)) {
      rmSync(installed, { recursive: true, force: true })
      record(`${profile.name}: 删除 node_modules/${PACKAGE_NAME}`, { changed: true, reason: 'removed' })
    }
  }

  // 3. 会话投影缓存：插件走了，缓存里的 agentPreset 也得跟着走，否则旧会话打不开。
  if (!options.keepSessions) {
    const results = pruneProjections(home, {
      presetId: PRESET_ID,
      fallbackId: FALLBACK_PRESET_ID,
      dryRun: options.dryRun,
    })
    const touched = results.filter(result => result.changed)
    record('会话投影缓存降级为 standard', {
      changed: touched.length > 0,
      reason: touched.length > 0 ? `${touched.length} 个文件` : '无需改动',
    })
  }

  if (options.json) {
    console.log(JSON.stringify({ home, steps }, null, 2))
    return 0
  }
  console.log(`dsh-stack uninstall — home: ${home}${options.dryRun ? '（--dry-run，未写盘）' : ''}`)
  for (const step of steps) {
    const icon = step.changed ? ICON.fixed : ICON.skipped
    console.log(`  ${icon} ${step.label} — ${step.reason}`)
  }
  console.log('\n下一步：')
  console.log('  1. 重启 DSH（已加载的插件不会因为文件被删而退出内存）。')
  console.log('  2. 在 profile 目录跑一次 pnpm install，让 lockfile 收敛。')
  console.log('  3. 仍想保留本预设的话，重新安装并在会话选择器里重新选一次即可；')
  console.log('     我们不会替你记住上一次的选择，但也不会覆盖你后来选过的预设。')
  return 0
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log(USAGE)
    return 0
  }
  const home = options.home === null ? resolveDshHome() : options.home
  if (!existsSync(home)) {
    console.error(`DSH home 不存在：${home}（用 --home 指定）`)
    return 1
  }
  const profiles = selectProfiles(home, options.profile)
  if (options.command === 'status') return commandStatus(home, profiles, options)
  if (options.command === 'doctor') return commandDoctor(home, profiles, options)
  if (options.command === 'uninstall') return commandUninstall(home, profiles, options)
  console.error(`未知命令：${options.command}`)
  console.error(USAGE)
  return 1
}

// 只有被直接执行时才跑 CLI：测试要 import 这些函数，不能因为 import 就把
// 用户的 profile 改一遍。
//
// 必须比 realpath，不能比原始路径。npm 安装后 `node_modules/.bin/dsh-stack`
// 是指向本文件的符号链接：`process.argv[1]` 是**链接路径**，而 `import.meta.url`
// 已被 node 解析成**真实路径**，两者字符串永不相等，命令于是静默什么都不做
// （退出码 0、零输出）——比报错更难发现。0.3.0 就是这样：从仓库直接跑正常，
// 装完 `npx dsh-stack` 完全没反应。
const isMain = (() => {
  const entry = process.argv[1]
  if (entry === undefined) return false
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url))
  }
  catch {
    return false
  }
})()

if (isMain) process.exitCode = main()

export { diagnose, stripBuiltDependency, parseArgs, main }
