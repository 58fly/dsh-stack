/**
 * ds-loop — the harness half of the DeepSeek Stack preset.
 *
 * The upstream pack (https://github.com/aicodeking/deepseek-stack) states two
 * rules as commands a model is supposed to follow on its own:
 *
 *   1. `ds-verify-loop`: after every change, run a real command that proves it,
 *      and put the evidence in the same message as the claim.
 *   2. `ds-unstick`: if the same fix fails twice, stop and test the premise
 *      instead of trying a third variant.
 *
 * Prose in a persona does not survive a long session, so this plugin enforces
 * both at the turn boundary. It listens on `agent/turn-stopping` — the serial
 * hook that runs before an otherwise finished turn closes — reads the turn's
 * own durable log, and when a rule is violated it `steer()`s one short message
 * back into the session. The steering wakes the loop for one more step, which
 * is exactly the "you are not done yet" the pack describes.
 *
 * Deliberate limits:
 *  - At most `maxSteersPerTurn` steers (default 1): an unverified end of turn
 *    is worth one nudge, never a loop of its own.
 *  - The evidence rule only counts MUTATION tools (write/edit/...). A shell
 *    command can both mutate and verify, so shell results are evidence only —
 *    no false positive from `sed -i && npm test` in one call.
 *  - An edit whose every target is prose (`.md`, `.txt`, …) is exempt: there is
 *    no command that proves a documentation change, and demanding one would
 *    cost a step per document.
 *  - Everything is derived from the session log, so a resumed session behaves
 *    like the original one.
 *  - A failure inside this plugin is logged once and never fails the turn.
 */

/** Cordis plugin name used by loader diagnostics. */
export const name = 'ds-stack-loop'

/** Steer messages carry this source kind, so their provenance is explicit. */
const SOURCE_KIND = 'ds-stack-loop'

const DEFAULTS = {
  evidence: true,
  unstick: true,
  failStreak: 2,
  maxSteersPerTurn: 2,
  includeSubagents: true,
  mutationTools: ['write', 'edit'],
  checkTools: ['bash', 'pwsh'],
  documentationSuffixes: ['.md', '.mdx', '.txt', '.rst', '.adoc'],
}

/** Read a session's durable events, tolerating both snapshot shapes. */
function snapshotSessionEvents(session) {
  const events = typeof session.snapshotEvents === 'function'
    ? session.snapshotEvents()
    : session.events
  if (!Array.isArray(events)) throw new TypeError('ds-stack-loop: session history must be an array')
  return events
}

/** Strict boolean config value, defaulting when the key is absent. */
function booleanOption(config, key) {
  const value = config[key]
  if (value === undefined) return DEFAULTS[key]
  if (typeof value !== 'boolean') throw new TypeError(`${name}: ${key} must be a boolean`)
  return value
}

/** Positive integer config value, defaulting when the key is absent. */
function positiveInteger(config, key) {
  const value = config[key]
  if (value === undefined) return DEFAULTS[key]
  if (!Number.isInteger(value) || value < 1) throw new TypeError(`${name}: ${key} must be a positive integer`)
  return value
}

/** String list config value, defaulting when the key is absent. */
function stringList(config, key) {
  const value = config[key]
  if (value === undefined) return DEFAULTS[key]
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) {
    throw new TypeError(`${name}: ${key} must be an array of tool names`)
  }
  return value
}

/** Best-effort target paths named by a tool call's raw JSON arguments. */
function targetsOf(rawArguments) {
  if (typeof rawArguments !== 'string') return []
  let parsed
  try {
    parsed = JSON.parse(rawArguments)
  } catch {
    return []
  }
  if (parsed === null || typeof parsed !== 'object') return []
  const found = []
  for (const key of ['file_path', 'filePath', 'path', 'file']) {
    const value = parsed[key]
    if (typeof value === 'string' && value.length > 0) found.push(value)
  }
  return [...new Set(found)]
}

/** True when every path is prose, where no command can prove the change. */
function onlyDocumentation(paths, suffixes) {
  if (paths.length === 0) return false
  const lowered = suffixes.map(suffix => suffix.toLowerCase())
  return paths.every(candidate => {
    const lower = candidate.toLowerCase()
    return lowered.some(suffix => lower.endsWith(suffix))
  })
}

/**
 * Reduce one turn's events to the facts both rules need: ordered tool outcomes
 * with the tool name correlated from its `tool/call`, the last successful
 * mutation, and whether a successful check followed it.
 */
function analyzeTurn(events, turn, mutationTools, checkTools) {
  const mutations = new Set(mutationTools)
  const checks = new Set(checkTools)
  const names = new Map()
  const targets = new Map()
  const outcomes = []

  for (const event of events) {
    if (event?.data?.turn !== turn) continue
    if (event.type === 'tool/call') {
      if (typeof event.data.name === 'string' && typeof event.data.callId === 'string') {
        names.set(event.data.callId, event.data.name)
        targets.set(event.data.callId, targetsOf(event.data.arguments))
      }
      continue
    }
    if (event.type !== 'tool/result') continue
    const message = event.data.message
    const callId = message?.toolCallId
    outcomes.push({
      name: names.get(callId) ?? 'unknown',
      isError: message?.isError === true,
      targets: targets.get(callId) ?? [],
    })
  }

  let lastMutation = -1
  let lastCheck = -1
  for (let index = 0; index < outcomes.length; index += 1) {
    const outcome = outcomes[index]
    if (outcome.isError) continue
    if (mutations.has(outcome.name)) lastMutation = index
    else if (checks.has(outcome.name)) lastCheck = index
  }

  let failStreak = 0
  for (let index = outcomes.length - 1; index >= 0; index -= 1) {
    if (!outcomes[index].isError) break
    failStreak += 1
  }

  // Only the edits made AFTER the last successful check are unproven. Edits
  // already covered by an earlier check are proven, so naming them in the nudge
  // would point the model at files that need nothing.
  const mutatedFiles = []
  for (let index = lastCheck + 1; index <= lastMutation; index += 1) {
    const outcome = outcomes[index]
    if (!outcome.isError && mutations.has(outcome.name)) mutatedFiles.push(...outcome.targets)
  }

  return {
    /** A mutation happened and no successful check came after it. */
    evidenceMissing: lastMutation >= 0 && lastCheck < lastMutation,
    /** Consecutive failing tool results at the end of the turn. */
    failStreak,
    /** Every path the turn edited (deduplicated), for exemption and nudges. */
    mutatedFiles: [...new Set(mutatedFiles)],
  }
}

/** The nudge for a turn that edited files and then tried to close. */
function evidenceText(mutatedFiles, attempt = 1) {
  const where = mutatedFiles.length === 0
    ? 'this turn edited files'
    : `this turn edited ${mutatedFiles.map(file => `\`${file}\``).join(', ')}`
  if (attempt > 1) {
    return [
      `ds-stack checkpoint — still no successful check after ${where}.`,
      'You are closing the turn without evidence a second time. Run one command now, even a trivial one that reads the file back or executes the program.',
      'If the command genuinely cannot run here, reply with one line naming what blocked it and what you could not verify. Then stop.',
    ].join(' ')
  }
  return [
    `ds-stack checkpoint — ${where} but ran no successful check afterwards.`,
    'Run the smallest command that proves the change (the test, the build, or the program itself), then report its result in the same message as the claim.',
    'If no check is possible here, say so in one line and name exactly what you could not verify.',
  ].join(' ')
}

/** The nudge for a turn that closed after repeating a failing idea. */
function unstickText(failStreak) {
  return [
    `ds-stack checkpoint — the last ${failStreak} tool calls failed in a row.`,
    'Do not try a third variant of the same fix. Name the premise those attempts share, test that premise directly (ds-unstick), then change the approach and say what changed.',
  ].join(' ')
}

export function apply(ctx, config) {
  const evidence = booleanOption(config, 'evidence')
  const unstick = booleanOption(config, 'unstick')
  const includeSubagents = booleanOption(config, 'includeSubagents')
  const failStreak = positiveInteger(config, 'failStreak')
  const maxSteersPerTurn = positiveInteger(config, 'maxSteersPerTurn')
  const mutationTools = stringList(config, 'mutationTools')
  const checkTools = stringList(config, 'checkTools')
  const documentationSuffixes = stringList(config, 'documentationSuffixes')

  if (mutationTools.length === 0) throw new TypeError(`${name}: mutationTools must not be empty`)

  /**
   * Per `sessionId:turn` nudge budget. `seen` is how much of the turn had
   * happened at the last nudge, so a re-entered hook with no new activity
   * cannot nudge again for the same state. Returns the 1-based nudge number
   * this call spends, or 0 when the budget is gone.
   */
  const claimed = new Map()
  const CLAIM_LIMIT = 200

  const claim = (key, seen) => {
    const entry = claimed.get(key)
    if (entry !== undefined && (entry.count >= maxSteersPerTurn || seen <= entry.seen)) return 0
    const count = (entry?.count ?? 0) + 1
    claimed.set(key, { count, seen })
    if (claimed.size > CLAIM_LIMIT) {
      const oldest = claimed.keys().next().value
      claimed.delete(oldest)
    }
    return count
  }

  let warned = false
  const warnOnce = message => {
    if (warned) return
    warned = true
    try {
      ctx.logger.warn(message)
    } catch {
      // Logger unavailable — the guard exists only to avoid log spam.
    }
  }

  ctx.on('agent/turn-stopping', ({ agent, turn }) => {
    try {
      if (typeof agent?.steer !== 'function') return
      const session = agent.session
      if (session === undefined) return
      if (!includeSubagents && (session.header?.delegationDepth ?? 0) > 0) return

      const events = snapshotSessionEvents(session)
      const turnEvents = events.filter(event => event?.data?.turn === turn)
      const key = `${session.id}:${turn}`

      const { evidenceMissing, failStreak: streak, mutatedFiles } =
        analyzeTurn(turnEvents, turn, mutationTools, checkTools)

      let text
      if (unstick && streak >= failStreak) text = unstickText(streak)
      else if (evidence && evidenceMissing && !onlyDocumentation(mutatedFiles, documentationSuffixes)) {
        text = evidenceText(mutatedFiles.slice(0, 3))
      }
      if (text === undefined) return

      // Claim only after the decision: a turn that violates nothing keeps its
      // whole budget, and a repeated hook call with no new turn activity is a
      // no-op instead of a second nudge for the same state.
      const attempt = claim(key, turnEvents.length)
      if (attempt === 0) return

      // The second nudge for the same rule is phrased harder: the first one
      // already asked politely and the model closed anyway.
      if (attempt > 1 && evidence && evidenceMissing) {
        text = evidenceText(mutatedFiles.slice(0, 3), attempt)
      }

      agent.steer({
        id: `${SOURCE_KIND}-${session.id}-${turn}`,
        role: 'user',
        content: [{ type: 'text', text }],
        source: { kind: SOURCE_KIND },
      })
    } catch (error) {
      warnOnce(`${name}: turn check failed, leaving the turn to close: ${String((error && error.message) || error)}`)
    }
  })
}
