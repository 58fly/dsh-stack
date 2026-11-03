/**
 * Unit checks for ../preset/ds-loop.mjs — run with any Node >= 22:
 *   node test/ds-loop.test.mjs
 *
 * They drive the plugin through the real hook contract (a fake `ctx.on`
 * captures the `agent/turn-stopping` listener) and assert on what it steers.
 */
import assert from 'node:assert/strict'

const mod = await import(new URL("../preset/ds-loop.mjs", import.meta.url).href)

let seq = 0
const call = (turn, callId, name, args = {}) => ({
  type: 'tool/call', seq: seq++, data: { turn, step: 1, callId, name, arguments: JSON.stringify(args) },
})
const result = (turn, callId, isError = false) => ({
  type: 'tool/result', seq: seq++, data: { turn, step: 1, message: { toolCallId: callId, isError } },
})

function makeRun(config = {}) {
  const handlers = new Map()
  const steers = []
  const warnings = []
  const ctx = {
    on(name, handler) { handlers.set(name, handler) },
    logger: { warn: (m) => warnings.push(m) },
  }
  mod.apply(ctx, config)
  const stop = (events, turn, header = {}) => {
    const agent = {
      session: { id: 's' + turn + '-' + Math.random().toString(36).slice(2, 7), header, snapshotEvents: () => events },
      steer(message) { steers.push(message) },
    }
    handlers.get('agent/turn-stopping')({ agent, turn })
    return agent
  }
  return { stop, steers, warnings, handlers }
}

const text = (steer) => steer.content[0].text
let passed = 0
const check = (label, fn) => { fn(); console.log('  ok  ' + label); passed++ }

// 1 — edit then close: evidence nudge, with the file path in it.
check('write with no check -> evidence steer', () => {
  const run = makeRun()
  run.stop([call(1, 'c1', 'write', { file_path: 'C:\\repo\\a.ts' }), result(1, 'c1')], 1)
  assert.equal(run.steers.length, 1)
  assert.match(text(run.steers[0]), /no successful check/)
  assert.match(text(run.steers[0]), /a\.ts/)
  assert.equal(run.steers[0].source.kind, 'ds-stack-loop')
  assert.equal(run.steers[0].role, 'user')
})

// 2 — edit then a successful check: silence.
check('write then pwsh success -> no steer', () => {
  const run = makeRun()
  run.stop([
    call(1, 'c1', 'edit', { file_path: 'b.ts' }), result(1, 'c1'),
    call(1, 'c2', 'pwsh', { command: 'npm test' }), result(1, 'c2'),
  ], 1)
  assert.equal(run.steers.length, 0)
})

// 3 — the check ran BEFORE the edit: still missing evidence.
check('check then write -> evidence steer', () => {
  const run = makeRun()
  run.stop([
    call(1, 'c1', 'pwsh', { command: 'npm test' }), result(1, 'c1'),
    call(1, 'c2', 'write', { file_path: 'c.ts' }), result(1, 'c2'),
  ], 1)
  assert.equal(run.steers.length, 1)
})

// 4 — a FAILED check does not count as verification.
check('write then failed check -> evidence steer', () => {
  const run = makeRun()
  run.stop([
    call(1, 'c1', 'write', { file_path: 'd.ts' }), result(1, 'c1'),
    call(1, 'c2', 'pwsh', { command: 'npm test' }), result(1, 'c2', true),
  ], 1)
  assert.equal(run.steers.length, 1)
  assert.match(text(run.steers[0]), /no successful check/)
})

// 5 — two consecutive failures -> unstick steer, and only one message.
check('two failures -> unstick steer (exactly one)', () => {
  const run = makeRun()
  run.stop([
    call(1, 'c1', 'pwsh', { command: 'npm test' }), result(1, 'c1', true),
    call(1, 'c2', 'pwsh', { command: 'npm test' }), result(1, 'c2', true),
  ], 1)
  assert.equal(run.steers.length, 1)
  assert.match(text(run.steers[0]), /the last 2 tool calls failed/)
})

// 6 — shell-only mutation is evidence-only: no mutation recorded, no steer.
check('bash sed -i only -> no steer', () => {
  const run = makeRun()
  run.stop([call(1, 'c1', 'bash', { command: 'sed -i s/a/b/ x' }), result(1, 'c1')], 1)
  assert.equal(run.steers.length, 0)
})

// 7 — a later turn in the same session is a fresh judgement (different turn).
check('second turn with a new edit -> steer again', () => {
  const run = makeRun()
  const events = [
    call(1, 'a', 'write', { file_path: 'x' }), result(1, 'a'),
    call(2, 'b', 'write', { file_path: 'x2' }), result(2, 'b'),
  ]
  const agent = { session: { id: 'fixed', header: {}, snapshotEvents: () => events }, steer: (m) => run.steers.push(m) }
  run.handlers.get('agent/turn-stopping')({ agent, turn: 1 })
  run.handlers.get('agent/turn-stopping')({ agent, turn: 2 })
  assert.equal(run.steers.length, 2)
  assert.match(text(run.steers[1]), /x2/)
})

// 8 — same turn, repeated hook invocation: one steer only.
check('repeated hook call in one turn -> one steer', () => {
  const run = makeRun()
  const events = [call(1, 'a', 'write', { file_path: 'y' }), result(1, 'a')]
  const agent = { session: { id: 'fixed', header: {}, snapshotEvents: () => events }, steer: (m) => run.steers.push(m) }
  for (let i = 0; i < 5; i++) run.handlers.get('agent/turn-stopping')({ agent, turn: 1 })
  assert.equal(run.steers.length, 1)
})

// 8b — a larger budget still ignores a repeated call with no new activity, but
// spends the extra nudge once the turn log grows.
check('maxSteersPerTurn:2 -> 1 for same state, 2 after new activity', () => {
  const run = makeRun({ maxSteersPerTurn: 2 })
  const events = [call(1, 'a', 'write', { file_path: 'w1' }), result(1, 'a')]
  const agent = { session: { id: 'budget', header: {}, snapshotEvents: () => events.slice() }, steer: (m) => run.steers.push(m) }
  run.handlers.get('agent/turn-stopping')({ agent, turn: 1 })
  run.handlers.get('agent/turn-stopping')({ agent, turn: 1 })
  assert.equal(run.steers.length, 1)
  events.push(call(1, 'b', 'write', { file_path: 'w2' }), result(1, 'b'))
  run.handlers.get('agent/turn-stopping')({ agent, turn: 1 })
  assert.equal(run.steers.length, 2)
  run.handlers.get('agent/turn-stopping')({ agent, turn: 1 })
  assert.equal(run.steers.length, 2)
})

// 9 — subagents skipped when includeSubagents is false.
check('includeSubagents:false skips depth>0', () => {
  const run = makeRun({ includeSubagents: false })
  const events = [call(1, 'a', 'write', { file_path: 'z' }), result(1, 'a')]
  const agent = { session: { id: 'kid', header: { delegationDepth: 1 }, snapshotEvents: () => events }, steer: (m) => run.steers.push(m) }
  run.handlers.get('agent/turn-stopping')({ agent, turn: 1 })
  assert.equal(run.steers.length, 0)
})

// 10 — a broken session log never throws out of the hook.
check('throwing session log is contained', () => {
  const run = makeRun()
  const agent = { session: { id: 'bad', header: {}, snapshotEvents: () => { throw new Error('boom') } }, steer: () => { throw new Error('unexpected') } }
  assert.doesNotThrow(() => run.handlers.get('agent/turn-stopping')({ agent, turn: 1 }))
  assert.equal(run.warnings.length, 1)
})

// 11 — config validation is loud.
check('bad config throws at mount', () => {
  assert.throws(() => makeRun({ failStreak: 0 }), /positive integer/)
  assert.throws(() => makeRun({ evidence: 'yes' }), /must be a boolean/)
  assert.throws(() => makeRun({ mutationTools: [] }), /must not be empty/)
})

// 12 — documentation-only edits are exempt from the evidence rule.
check('README-only edit -> no steer', () => {
  const run = makeRun()
  run.stop([call(1, 'a', 'write', { file_path: 'C:\\repo\\README.md' }), result(1, 'a')], 1)
  assert.equal(run.steers.length, 0)
})

// 13 — but docs mixed with code still demand a check.
check('README + source edit -> evidence steer', () => {
  const run = makeRun()
  run.stop([
    call(1, 'a', 'write', { file_path: 'README.md' }), result(1, 'a'),
    call(1, 'b', 'edit', { file_path: 'src/core.ts' }), result(1, 'b'),
  ], 1)
  assert.equal(run.steers.length, 1)
  assert.match(text(run.steers[0]), /core\.ts/)
})

// 14 — the nudge names only the edits still unproven: a file edited before the
// last successful check is already proven, so it must not be listed.
check('nudge lists only edits after the last check', () => {
  const run = makeRun()
  run.stop([
    call(1, 'a', 'write', { file_path: 'already-proven.ts' }), result(1, 'a'),
    call(1, 'b', 'pwsh', { command: 'npm test' }), result(1, 'b'),
    call(1, 'c', 'edit', { file_path: 'still-unproven.ts' }), result(1, 'c'),
  ], 1)
  assert.equal(run.steers.length, 1)
  assert.match(text(run.steers[0]), /still-unproven\.ts/)
  assert.doesNotMatch(text(run.steers[0]), /already-proven/)
})

// 15 — the default budget is 2, and the second nudge is worded harder than the
// first so a model that ignored the polite one gets told it already ignored it.
check('default budget 2 -> second nudge reworded', () => {
  const run = makeRun()
  const events = [call(1, 'a', 'write', { file_path: 'q1' }), result(1, 'a')]
  const agent = { session: { id: 'reword', header: {}, snapshotEvents: () => events.slice() }, steer: (m) => run.steers.push(m) }
  run.handlers.get('agent/turn-stopping')({ agent, turn: 1 })
  assert.equal(run.steers.length, 1)
  assert.doesNotMatch(text(run.steers[0]), /a second time/)
  events.push(call(1, 'b', 'write', { file_path: 'q2' }), result(1, 'b'))
  run.handlers.get('agent/turn-stopping')({ agent, turn: 1 })
  assert.equal(run.steers.length, 2)
  assert.match(text(run.steers[1]), /a second time/)
})

// 16 — an unstick nudge is never reworded by the evidence wording: the same
// repeated-failure state must not be spent on a second, differently worded try.
check('unstick nudge does not gain evidence wording on retry', () => {
  const run = makeRun()
  const events = [
    call(1, 'a', 'pwsh', { command: 'x' }), result(1, 'a', true),
    call(1, 'b', 'pwsh', { command: 'x' }), result(1, 'b', true),
  ]
  const agent = { session: { id: 'unstick2', header: {}, snapshotEvents: () => events.slice() }, steer: (m) => run.steers.push(m) }
  run.handlers.get('agent/turn-stopping')({ agent, turn: 1 })
  events.push(call(1, 'c', 'pwsh', { command: 'x' }), result(1, 'c', true))
  run.handlers.get('agent/turn-stopping')({ agent, turn: 1 })
  for (const steer of run.steers) assert.doesNotMatch(text(steer), /a second time/)
})

console.log(`\n${passed} checks passed`)
