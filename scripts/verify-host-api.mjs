#!/usr/bin/env node
/**
 * 宿主契约校验：守卫依赖的接口是否还在。
 *
 * 为什么需要它：`preset/ds-loop.mjs` 依赖四个宿主私有契约，全都不在公开文档里：
 *
 *   1. `agent/turn-stopping` 这个 serial 钩子在轮次收尾时被 dispatch；
 *   2. 该钩子的载荷里有 `agent`（由 agentEvents 注入，不是调用方传的）；
 *   3. `agent.steer(input)` 存在，且语义是「塞进 next-step 唤醒」；
 *   4. `session.snapshotEvents()` 能拿到持久事件日志。
 *
 * 还有一条更隐蔽的：`mutationTools` / `checkTools` 里的工具名必须与宿主实际注册的
 * 名字一致。宿主改个名，守卫不会报错——它只是永远不命中，静默失效。
 *
 * 做法：读宿主 node_modules 里的源码字符串逐条断言。不做语义分析，只验证
 * 「我们依赖的符号还在原位、签名关键片段没变」，这是升级时最先被破坏的东西。
 *
 *   node scripts/verify-host-api.mjs
 *   DSH_ROOT=/path/to/dsh node scripts/verify-host-api.mjs
 *
 * 找不到宿主时打印 SKIP 并 exit 0：CI 上没有 DSH 安装是正常情况，不该判失败。
 */

import { readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/** 桌面版安装目录；DSH_ROOT 覆盖（CI 或非标准安装路径）。 */
const CANDIDATES = [
  process.env.DSH_ROOT,
  '/Applications/DeepSeek Harness.app/Contents/Resources/app/dsh',
  '/Applications/DeepSeek-Harness.app/Contents/Resources/app/dsh',
].filter(Boolean)

const root = CANDIDATES.find(candidate => existsSync(join(candidate, 'node_modules', '@deepseek-ai')))
if (root === undefined) {
  console.log('SKIP 未找到 DSH 安装目录（设置 DSH_ROOT 可指定）；宿主契约校验只在装了 DSH 的机器上有意义')
  process.exit(0)
}

const PKG = join(root, 'node_modules', '@deepseek-ai')
let pass = 0
const failures = []

const fail = (name, detail, hint) => {
  failures.push(hint ? `${name}\n       ${detail}\n       → ${hint}` : `${name}\n       ${detail}`)
  console.log(`FAIL ${name}`)
}

function check(name, fn) {
  try {
    const detail = fn()
    if (detail) console.log(`PASS ${name}  ${detail}`)
    else console.log(`PASS ${name}`)
    pass += 1
  } catch (error) {
    fail(name, error.message)
  }
}

function source(pkg, file) {
  const path = join(PKG, pkg, file)
  if (!existsSync(path)) throw new Error(`读不到 ${pkg}/${file}（宿主包结构变了）`)
  return readFileSync(path, 'utf8')
}

function must(haystack, needle, what) {
  if (!haystack.includes(needle)) throw new Error(`没有找到 ${what}：\`${needle}\``)
}

// ---- 1. turn-stopping 钩子仍在轮次收尾时 dispatch ----
check('agent/turn-stopping 在轮次收尾被 dispatch', () => {
  const text = source('dsh-agent-loop', 'lib/index.js')
  must(text, '"agent/turn-stopping"', '钩子名')
  must(text, 'dispatch.serial("agent/turn-stopping"', 'serial dispatch 调用')
  return 'dsh-agent-loop/lib/index.js'
})

// ---- 2. 载荷里的 agent 由 agentEvents 注入 ----
check('agent/turn-stopping 载荷注入 agent', () => {
  const text = source('dsh-agent', 'lib/types/dispatch.js')
  must(text, '...payload, agent', '注入表达式')
  return 'dsh-agent/lib/types/dispatch.js'
})

// ---- 3. agent.steer 存在且语义是 next-step ----
check('agent.steer 存在且唤醒 next-step', () => {
  const text = source('dsh-agent-loop', 'lib/index.js')
  must(text, 'steer(input)', 'steer 方法')
  const body = text.slice(text.indexOf('steer(input)'), text.indexOf('steer(input)') + 200)
  if (!/send\(input,\s*"next-step",\s*true\)/.test(body)) {
    throw new Error('steer 的实现不再是 send(input, "next-step", true)，唤醒语义可能变了')
  }
  return 'steer -> next-step, wake=true'
})

// ---- 4. session.snapshotEvents 存在 ----
check('session.snapshotEvents 存在', () => {
  const text = source('dsh-session', 'lib/index.js')
  must(text, 'snapshotEvents(', '方法定义')
  return 'dsh-session/lib/index.js'
})

// ---- 5. 工具名与守卫的默认列表一致 ----
//
// 这条最容易静默失效：宿主给工具改名，守卫照常运行，只是永远匹配不上。
const presetText = readFileSync(join(process.cwd(), 'preset', 'agent.cordis.yml'), 'utf8')
const listOf = (key) => {
  const match = presetText.match(new RegExp(`${key}:\\s*\\[([^\\]]*)\\]`))
  if (!match) throw new Error(`preset/agent.cordis.yml 里没有 ${key}`)
  return match[1].split(',').map(item => item.trim()).filter(Boolean)
}

check('mutationTools 全是宿主真实注册的文件工具', () => {
  const registered = new Set()
  const fsText = source('dsh-tool-fs', 'lib/index.js')
  for (const match of fsText.matchAll(/^\s+name: "([a-z_]+)",$/gm)) registered.add(match[1])
  const declared = listOf('mutationTools')
  const unknown = declared.filter(name => !registered.has(name))
  if (unknown.length > 0) {
    throw new Error(`${unknown.join(', ')} 不在 dsh-tool-fs 注册的工具里（现有：${[...registered].join(', ')}）`)
  }
  return declared.join(', ')
})

check('checkTools 全是宿主真实注册的 shell 工具', () => {
  const registered = new Set()
  for (const [pkg, file] of [['dsh-tool-bash', 'lib/index.js'], ['dsh-tool-pwsh', 'lib/index.js']]) {
    if (!existsSync(join(PKG, pkg, file))) continue
    const text = source(pkg, file)
    for (const match of text.matchAll(/^\s+name: "(bash|pwsh)",$/gm)) registered.add(match[1])
  }
  const declared = listOf('checkTools')
  const unknown = declared.filter(name => !registered.has(name))
  if (unknown.length > 0) {
    throw new Error(`${unknown.join(', ')} 不在宿主的 shell 工具里（现有：${[...registered].join(', ') || '无'}）`)
  }
  return declared.join(', ')
})

// ---- 6. 预设里的每个 {{变量}} 都必须是宿主注册过的 ----
//
// 这是最狠的一条失败模式：写一个不存在的变量不会降级成空字符串，
// `deployment:persona-suffix` 渲染时直接抛 UNKNOWN，会话在模型走第一步之前就死。
// 上游正是这么死的（suffix 里写了 {{cwd}}），整场会话只能切回 standard。
// 宿主目前只注册两处（dsh-agent-loop/lib/index.js），所以照实抓出来比对。
check('预设用的 {{变量}} 都是宿主注册过的', () => {
  const loopText = source('dsh-agent-loop', 'lib/index.js')
  const registered = new Set()
  for (const match of loopText.matchAll(/systemPrompt\.variable\("([^"]+)"/g)) registered.add(match[1])
  if (registered.size === 0) throw new Error('宿主一个 prompt variable 都没注册，抓取方式可能已失效')

  // 注释里允许出现 {{…}}（讲历史用的），只检查真正会进渲染的 YAML 标量。
  const live = presetText
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .join('\n')
  const used = [...live.matchAll(/\{\{([^}]*)\}\}/g)].map(match => match[1].trim())
  const unknown = used.filter(name => !registered.has(name))
  if (unknown.length > 0) {
    throw new Error(
      `预设引用了宿主没注册的变量：${unknown.map(name => `{{${name}}}`).join(', ')}` +
        `（宿主只有：${[...registered].join(', ')}）—— 渲染时会抛 UNKNOWN，会话起不来`
    )
  }
  return used.length === 0 ? '未使用模板变量' : `${[...new Set(used)].join(', ')}`
})

// ---- 输出 ----
console.log(`  宿主：${root}`)
if (failures.length === 0) {
  console.log(`✅ 宿主契约校验通过（${pass} 项）`)
  process.exit(0)
}
console.error(`\n❌ 宿主契约校验失败（${failures.length} 项）\n`)
for (const message of failures) console.error(`  - ${message}\n`)
console.error('守卫依赖这些私有契约；dsh 升级后它们变了，守卫会静默失效而不是报错。\n')
process.exit(1)
