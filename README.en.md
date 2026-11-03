# dsh-stack

The DeepSeek Stack mode (`ds-stack`) agent preset for DSH, shipped as an installable bundle.

Repository: [58fly/dsh-stack](https://github.com/58fly/dsh-stack) · Skills from [aicodeking/deepseek-stack](https://github.com/aicodeking/deepseek-stack) (MIT, see [NOTICE.md](NOTICE.md))

[aicodeking/deepseek-stack](https://github.com/aicodeking/deepseek-stack) is a pack of `SKILL.md` files that patches four gaps common to cheap models: no plan first, claiming a fix without running anything, retrying the same failing idea, and drifting on long tasks. Two things are missing when you drop that pack into DSH: **persistence** (a skill only applies after the `skill` tool loads it, yet `ds-mode` calls itself always-on) and a **hard boundary** (prose rules drift in a long session). This preset supplies those two and copies the rest verbatim.

## Skill pack → this preset

| Skill pack | Becomes | Where |
|---|---|---|
| `ds-mode` (an "always-on" working style) | Always-on persona `persona.prefix` (rules condensed, not the full text) | `preset/agent.cordis.yml` |
| 29 `ds-*` skills | Skill directory shipped as-is | `preset/skills/` |
| "Verify after every change" | Turn-boundary check: files edited but no successful check afterwards → sent back | `preset/ds-loop.mjs` |
| "Stop after the same fix fails twice" | Turn-boundary check: 2 consecutive failures → sent back to re-examine the premise | `preset/ds-loop.mjs` |
| `npx skills add` | A DSH bundle (`cordis.patch.yml` + preset declaration) | this repo |

Apart from those three points the tool catalog, sandbox, approvals, compaction and delegation match the built-in `standard` preset row for row — this preset does not change what an agent can do, only how it works.

## Layout

- `cordis.patch.yml` — the bundle patch: inserts one `@deepseek-ai/dsh-agent-preset` declaration (`preset-ds-stack`, display name 「DeepSeek Stack 模式」, order 6).
- `preset/agent.cordis.yml` — the composition itself: persona, skill root, loop guard, shell/file/task/goal/plan/compaction/delegation rows.
- `preset/ds-loop.mjs` — the two turn-boundary guards (below).
- `preset/skills/` — the 29 skills from the pack, byte-for-byte.

## Install

**npm source first** (version numbers stay traceable; the plugin page shows `0.1.0` rather than a commit SHA):

```
plugin_manager({ action: "install_bundle", target: "dsh-stack" })
```

Or install it into the profile directly:

```
npm install dsh-stack
```

then add `dsh-stack` to the profile's `package.json` → `dsh.profile.bundles`.

**Git source as the fallback** (tracks the tip of `main`, useful for trying unreleased changes):

```
plugin_manager({ action: "install_bundle", target: "https://github.com/58fly/dsh-stack" })
```

Difference: the host checks a Git-sourced install for updates with `git ls-remote -- <repo> HEAD`, so the commit is its version identity and the plugin page shows a commit SHA (e.g. `afaa2ac`) instead of a version number. Use the npm source when you need to know which version is installed.

Installing registers `preset-ds-stack`. A preset is selectable only in a **new** session that is still empty; running sessions keep the composition they started with.

## Quick start

### Three steps

1. Install (see above). This registers `preset-ds-stack`.
2. Create a **new**, empty session and pick 「DeepSeek Stack 模式」 in the picker. Running sessions are not switched.
3. Say what you want. **You do not need to name skills** — the persona loads them when the task matches.

The first message buys you the most when it carries three things: **goal, constraints, definition of done**.

```
Rewrite lib/parse.mjs to read CSV in chunks; memory must not scale with file size.
When done, run it on a 500MB sample and report peak RSS.
```

Compare that with "help me optimize parsing performance" — the second one ends with the model guessing your intent, and a second round to fix the guess. To save that round, use `/ds-sharpen` or just fill in the three items yourself.

### Is it actually working

| What you see | Meaning |
|---|---|
| Messages like `ds-stack checkpoint — this turn edited …` | A guard is steering. Normal behaviour, not an error (see next section) |
| The model restates the task, reads files, then runs a command the moment it edits | The persona is active |
| A skill catalog appears in the first turn | The 29 skill summaries (~1.7k tokens of durable prefix) are injected |
| You want the preset version | `node -p "require('dsh-stack/package.json').version"` (from the profile directory) |

After editing preset files **you must restart DSH**: the main process reads the composition tree into memory at install time and does not re-read YAML from disk while running.

## Which skill, when

A skill only acts once loaded; you will never name most of these 29 — describe the task and the model picks. This table is for the moment you are stuck and want to point at one.

### Before you start

| Your situation | Gesture |
|---|---|
| The request is vague and you fear the wrong direction | `/ds-sharpen` |
| Several files, steps easy to miss | `/ds-plan-loop` |
| You want types and module shape settled before code | `/ds-blueprint` |
| Unsure which approach wins, want variants | `/ds-best-of-n` |

### While writing

| Your situation | Gesture |
|---|---|
| Bug fix that needs a test to stop it recurring | `/ds-tdd` |
| Code is written; you want it driven to green | `/ds-verify-loop` |
| A risky change — what else does it break | `/ds-blast-radius` |
| **The same fix failed twice** | `/ds-unstick` |
| New page/component that must not look AI-generated | `/ds-design` |
| Existing UI looks rough; fix it on evidence | `/ds-design-audit` |

### Delivering

| Your situation | Gesture |
|---|---|
| Self-review before you commit | `/ds-review-loop` |
| Just open a PR | `/ds-pr` |
| All the way through the merge (it merges) | `/ds-ship` |
| All the way to mergeable, **a human clicks merge** | `/ds-ready` |
| It watches CI and review while you do something else | `/ds-watch-pr` |
| It replies on the PR for you | `/ds-pr-comments` |

### Long runs and parallelism

| Your situation | Gesture |
|---|---|
| Multi-phase run that could drift | `/ds-ledger` |
| Context past half, the model starts repeating itself | `/ds-context-reset` |
| You were away; "where are we" | `/ds-catchup` |
| Fan out N parallel passes | `/ds-swarm` |
| Several models review independently, then converge | `/ds-jury` |

### Taking over and looking back

| Your situation | Gesture |
|---|---|
| Inheriting someone else's PR / branch / session | `/ds-adopt` |
| An old PR needs a rebase, or a verdict on whether it still matters | `/ds-revive` |
| The same class of mistake, third time | `/ds-lessons` |
| Prose and comments need the AI smell removed | `/ds-unslop` |
| You want a stretch of code explained | `/ds-explain` |
| No idea which one | `/ds-help` |

## Four examples

### 1. A vague request, narrowed before any edit

```
You: this module keeps breaking, take a look
```

The model should not start editing. A good opening restates and narrows (`/ds-sharpen` is exactly this):

```
You: this module keeps breaking, take a look
Model: First, scope — does "keeps breaking" mean errors, wrong data, or slowness?
       The repo shows six fix commits under src/ingest/ in three weeks, all
       touching the same retry branch. If that is the one, I would first write a
       test that reproduces it, then change the logic.
You: wrong data, and yes, the retry part
```

### 2. Edited without proof, steered back

This is the message you will **actually** see; verbatim from `preset/ds-loop.mjs`:

```
ds-stack checkpoint — this turn edited `lib/parse.mjs` but ran no successful
check afterwards. Run the smallest command that proves the change (the test,
the build, or the program itself), then report its result in the same message
as the claim. If no check is possible here, say so in one line and name
exactly what you could not verify.
```

It blocks "edited, therefore done". Three things worth knowing:

- It lists only files **not yet proven**. Edit `a.mjs`, run the tests, then edit `b.mjs` — it names `b.mjs` alone.
- Documentation-only edits (`.md`, `.txt`, …) do not trigger it; no command can prove a README is correct.
- At most two steers per turn, and the second one is blunter (it says outright that you are closing the turn without evidence a second time).

To **let it through** you do not disable the guard: have the model run one command that reads the file back. The guard is satisfied by any successful command.

### 3. Long task, change the air on purpose

```
You: /ds-context-reset
```

The model writes a `PROGRESS.md` first (goal, done, next, decisions made), then continues in a new session or a subagent reading only that file. Use it when a task spans many steps, the model starts forgetting, or the context is past half.

If you would rather not manage that by hand, use `/ds-ledger`: one line per decision, read back before each step, which keeps long runs on course.

### 4. Before delivering, make it review itself

```
You: /ds-review-loop
```

The author's view and a fresh-context reviewer's view, up to four rounds, until both agree a thing is right. Much cheaper than opening a PR and waiting for someone to poke holes.

Then pick `/ds-ready` (make it mergeable, a human merges) or `/ds-ship` (it merges) as appropriate.

## Tips

1. **Gestures and plain language are equivalent, gestures are more deterministic.** "check whether this PR can merge" and `/ds-ready` usually take the same path; when stuck, use the gesture so the model cannot pick wrong.
2. **The persona is resident, skills are loaded.** Apart from `ds-mode` (already internalised in the persona), the other 28 need to be invoked. "Installed but I feel nothing" almost always means the task did not match — describe it concretely.
3. **Give the acceptance criterion up front, save a whole round.** "run `npm test`, all green" beats "tell me when done" by one round trip.
4. **Do not hand it three goals at once.** The persona says one change at a time; three threads make it re-weigh in the middle.
5. **If the catalog feels expensive, delete directories.** 29 summaries cost ~1.7k tokens, resent every turn; delete the skills you never use and they leave the catalog. Do not shrink `catalogDescriptionMaxLength` — the pack puts "Use when …" at the end of each description, so truncation drops the trigger first.
6. **Subagents are guarded too** (`includeSubagents: true`). Delegated work is held to the same evidence rule.
7. **On Windows the check tool is `pwsh`**, already the default; change the executor and you must change `checkTools`, or the guard goes silent.

## Anti-patterns

| Do not | Why |
|---|---|
| One `bash` call that edits files and runs commands | A single `bash` counts as verification, not as a mutation, so the first guard cannot see it (a deliberate trade-off: otherwise `sed -i && npm test` would false-positive) |
| Expect it to remember last session's conclusions | Nothing crosses sessions; hand off with `PROGRESS.md` (`/ds-context-reset`) or run `/ds-catchup` |
| Edit `preset/agent.cordis.yml` and expect it to apply | Restart DSH |
| Switch presets inside an existing session | Not supported; only in a blank new session |
| Paste thousands of log lines and say "look at this" | The persona says read only the range you need; volume dilutes judgement |

## The two guards (ds-loop)

On `agent/turn-stopping` (the turn is about to close, not yet committed) the guard reads this turn's durable event log and, when a rule is violated, `steer`s one short message so the turn takes one more step:

1. **Edited without verifying**: the turn had a successful file mutation (`write` / `edit`) and no successful shell check (`bash` / `pwsh`) afterwards. The message names only the files that are **still unproven** (files already covered by an earlier check are omitted) and asks for the smallest proving command, or one line explaining why none can run.
2. **Two failures in a row**: the turn ends with ≥2 consecutive failing tool results. The message asks the model to stop trying a third variant and to test the premise the attempts share instead.

Deliberate limits:

- At most 2 nudges per turn (`maxSteersPerTurn`); the **second is worded harder** — it says outright that this is the second close without evidence, because the polite first one clearly was not taken. The cap still holds, so the guard cannot become a loop.
- Shell results count as verification only, never as a mutation — `sed -i … && npm test` in one call is not a false positive.
- Documentation-only edits (`.md`, `.txt`, …) are exempt from the first rule: no command proves a README change. Docs mixed with code are not exempt.
- Plain question turns and plan-mode turns mutate nothing, so they never trigger.
- An exception inside the guard is logged once and never blocks the turn from closing.

Tunable fields (the `ds-loop` row in `preset/agent.cordis.yml`):

| Field | Default | Meaning |
|---|---|---|
| `evidence` | `true` | Enable the "edited without verifying" check |
| `unstick` | `true` | Enable the "consecutive failures" check |
| `failStreak` | `2` | Failure threshold |
| `maxSteersPerTurn` | `2` | Max nudges per turn (the second is worded harder) |
| `includeSubagents` | `true` | Whether subagents are checked too |
| `mutationTools` | `[write, edit]` | Tools counted as a mutation; only names the host actually registers |
| `checkTools` | `[bash, pwsh]` | Tools counted as a check; only names the host actually registers |
| `documentationSuffixes` | `[.md, .mdx, .txt, .rst, .adoc]` | When **every** edited file has one of these suffixes, the evidence rule is skipped |

## Boundaries

- **The skill root uses `customSkillDirs` (rank 300), not `bundledSkillDir`**: the former is additive — project roots (100/200) still win, the user's own roots (400/500) still load, and the deployment's bundled root is untouched; the latter would replace the deployment default outright. The cost: a same-named `ds-*` skill in `~/.dsh/skills` loses to this package (identical content, usually imperceptible).
- **Skill content is never rewritten**: to upgrade, re-mirror the pack `skills/` over `preset/skills/`. This package does not touch skill bodies, so there is nothing to merge.
- **The skill catalog costs a fixed prefix every turn**: 29 summaries, 6830 chars (≈1708 tokens), resent as durable prefix. To spend less, **delete the skill directories you do not use** (the directory is the only source of truth); do not lower `catalogDescriptionMaxLength` — the pack puts the "Use when …" clause at the end of each description, so truncation drops the routing signal first, and that signal is exactly what the token buys.
- **The guard has no platform branch**: on Windows the shell tool is `pwsh`, already in the `checkTools` default. If you disable `tool-pwsh` for a different executor, update that list or the guard silently stops matching.
- **`bash` can bypass the first rule**: one `bash` call that writes files and runs a command counts as verification only. That is a deliberate trade (otherwise `sed -i && npm test` would be a false positive); the cost is that an all-bash editing style is unconstrained.

## Self-checks

Everything is dependency-free, Node ≥ 22:

```
npm test
```

| Command | What it checks |
|---|---|
| `node test/ds-loop.test.mjs` | Guard behaviour, 17 assertions |
| `node test/preset.test.mjs` | Static assembly assertions, 12 (persona present, guard config matches module defaults, disabled rows untouched) |
| `node scripts/verify-preset.mjs` | Assembly integrity: include path = package name + directory, skill root derived from baseUrl, cap fits the longest description |
| `node scripts/verify-skills.mjs` | Skill validity: frontmatter, directory ↔ `name`, description length, no dead `/ds-*` cross-references |
| `node scripts/verify-manifest.mjs` | Manifest and shipped artifact: allowlist, `engines`, actual `npm pack` contents |
| `node scripts/verify-host-api.mjs` | Host-private contracts: `agent/turn-stopping`, `agent.steer`, `session.snapshotEvents`, tool-name registry (SKIPs without a DSH install) |

Before publishing, `scripts/verify-release.mjs` additionally requires a clean tree, a tag matching the version, and a CHANGELOG section for the current version.

## Why installing here matters

If the profile installs this bundle via `link:` (junction / symlink), then **editing files here edits the preset**: the next new session picks the new content up without reinstalling; existing sessions keep the composition they started with.

## Maintenance

This repo is maintained in-house. Release process and directory conventions live in [AGENTS.md](AGENTS.md); version history in [CHANGELOG.md](CHANGELOG.md).
