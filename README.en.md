# dsh-stack

The `dsh-stack模式` agent preset for DSH (preset id `dsh-stack`), shipped as an installable bundle.

Repository: [58fly/dsh-stack](https://github.com/58fly/dsh-stack) · Skills from [aicodeking/deepseek-stack](https://github.com/aicodeking/deepseek-stack) (MIT, see [NOTICE.md](NOTICE.md))

[aicodeking/deepseek-stack](https://github.com/aicodeking/deepseek-stack) is a pack of `SKILL.md` files that patches four gaps common to cheap models: no plan first, claiming a fix without running anything, retrying the same failing idea, and drifting on long tasks. Two things are missing when you drop that pack into DSH: **persistence** (a skill only applies after the `skill` tool loads it, yet `st-mode` calls itself always-on) and a **hard boundary** (prose rules drift in a long session). This preset supplies those two and copies the rest verbatim.

## Skill pack → this preset

| Skill pack | Becomes | Where |
|---|---|---|
| `st-mode` (an "always-on" working style) | Always-on persona `persona.prefix` (rules condensed, not the full text) | `preset/agent.cordis.yml` |
| 29 `st-*` skills | Skill directory shipped as-is | `preset/skills/` |
| "Verify after every change" | Turn-boundary check: files edited but no successful check afterwards → sent back | `preset/st-loop.mjs` |
| "Stop after the same fix fails twice" | Turn-boundary check: 2 consecutive failures → sent back to re-examine the premise | `preset/st-loop.mjs` |
| `npx skills add` | A DSH bundle (`cordis.patch.yml` + preset declaration) | this repo |

Apart from those three points the tool catalog, sandbox, approvals, compaction and delegation match the built-in `standard` preset row for row — this preset does not change what an agent can do, only how it works.

## Layout

- `cordis.patch.yml` — the bundle patch: inserts one `@deepseek-ai/dsh-agent-preset` declaration (`preset-dsh-stack`, display name `dsh-stack模式`, order 6).
- `preset/agent.cordis.yml` — the composition itself: persona, skill root, loop guard, shell/file/task/goal/plan/compaction/delegation rows.
- `preset/st-loop.mjs` — the two turn-boundary guards (below).
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

Installing registers `preset-dsh-stack`. A preset is selectable only in a **new** session that is still empty; running sessions keep the composition they started with.

## Quick start

### Three steps

1. Install (see above). This registers `preset-dsh-stack`.
2. Create a **new**, empty session and pick `dsh-stack模式` in the picker (the display name is Chinese by design). Running sessions are not switched.
3. Say what you want. **You do not need to name skills** — the persona loads them when the task matches.

The first message buys you the most when it carries three things: **goal, constraints, definition of done**.

```
Rewrite lib/parse.mjs to read CSV in chunks; memory must not scale with file size.
When done, run it on a 500MB sample and report peak RSS.
```

Compare that with "help me optimize parsing performance" — the second one ends with the model guessing your intent, and a second round to fix the guess. To save that round, use `/st-sharpen` or just fill in the three items yourself.

### Is it actually working

| What you see | Meaning |
|---|---|
| Messages like `st-stack checkpoint — this turn edited …` | A guard is steering. Normal behaviour, not an error (see next section) |
| The model restates the task, reads files, then runs a command the moment it edits | The persona is active |
| A skill catalog appears in the first turn | The 29 skill summaries (~1.7k tokens of durable prefix) are injected |
| You want the preset version | `node -p "require('dsh-stack/package.json').version"` (from the profile directory) |

After editing preset files **you must restart DSH**: the main process reads the composition tree into memory at install time and does not re-read YAML from disk while running.

## Which skill, when

A skill only acts once loaded; you will never name most of these 29 — describe the task and the model picks. This table is for the moment you are stuck and want to point at one.

### Before you start

| Your situation | Gesture |
|---|---|
| The request is vague and you fear the wrong direction | `/st-sharpen` |
| Several files, steps easy to miss | `/st-plan-loop` |
| You want types and module shape settled before code | `/st-blueprint` |
| Unsure which approach wins, want variants | `/st-best-of-n` |

### While writing

| Your situation | Gesture |
|---|---|
| Bug fix that needs a test to stop it recurring | `/st-tdd` |
| Code is written; you want it driven to green | `/st-verify-loop` |
| A risky change — what else does it break | `/st-blast-radius` |
| **The same fix failed twice** | `/st-unstick` |
| New page/component that must not look AI-generated | `/st-design` |
| Existing UI looks rough; fix it on evidence | `/st-design-audit` |

### Delivering

| Your situation | Gesture |
|---|---|
| Self-review before you commit | `/st-review-loop` |
| Just open a PR | `/st-pr` |
| All the way through the merge (it merges) | `/st-ship` |
| All the way to mergeable, **a human clicks merge** | `/st-ready` |
| It watches CI and review while you do something else | `/st-watch-pr` |
| It replies on the PR for you | `/st-pr-comments` |

### Long runs and parallelism

| Your situation | Gesture |
|---|---|
| Multi-phase run that could drift | `/st-ledger` |
| Context past half, the model starts repeating itself | `/st-context-reset` |
| You were away; "where are we" | `/st-catchup` |
| Fan out N parallel passes | `/st-swarm` |
| Several models review independently, then converge | `/st-jury` |

### Taking over and looking back

| Your situation | Gesture |
|---|---|
| Inheriting someone else's PR / branch / session | `/st-adopt` |
| An old PR needs a rebase, or a verdict on whether it still matters | `/st-revive` |
| The same class of mistake, third time | `/st-lessons` |
| Prose and comments need the AI smell removed | `/st-unslop` |
| You want a stretch of code explained | `/st-explain` |
| No idea which one | `/st-help` |

## Four examples

### 1. A vague request, narrowed before any edit

```
You: this module keeps breaking, take a look
```

The model should not start editing. A good opening restates and narrows (`/st-sharpen` is exactly this):

```
You: this module keeps breaking, take a look
Model: First, scope — does "keeps breaking" mean errors, wrong data, or slowness?
       The repo shows six fix commits under src/ingest/ in three weeks, all
       touching the same retry branch. If that is the one, I would first write a
       test that reproduces it, then change the logic.
You: wrong data, and yes, the retry part
```

### 2. Edited without proof, steered back

This is the message you will **actually** see; verbatim from `preset/st-loop.mjs`:

```
st-stack checkpoint — this turn edited `lib/parse.mjs` but ran no successful
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
You: /st-context-reset
```

The model writes a `PROGRESS.md` first (goal, done, next, decisions made), then continues in a new session or a subagent reading only that file. Use it when a task spans many steps, the model starts forgetting, or the context is past half.

If you would rather not manage that by hand, use `/st-ledger`: one line per decision, read back before each step, which keeps long runs on course.

### 4. Before delivering, make it review itself

```
You: /st-review-loop
```

The author's view and a fresh-context reviewer's view, up to four rounds, until both agree a thing is right. Much cheaper than opening a PR and waiting for someone to poke holes.

Then pick `/st-ready` (make it mergeable, a human merges) or `/st-ship` (it merges) as appropriate.

## Tips

1. **Gestures and plain language are equivalent, gestures are more deterministic.** "check whether this PR can merge" and `/st-ready` usually take the same path; when stuck, use the gesture so the model cannot pick wrong.
2. **The persona is resident, skills are loaded.** Apart from `st-mode` (already internalised in the persona), the other 28 need to be invoked. "Installed but I feel nothing" almost always means the task did not match — describe it concretely.
3. **Give the acceptance criterion up front, save a whole round.** "run `npm test`, all green" beats "tell me when done" by one round trip.
4. **Do not hand it three goals at once.** The persona says one change at a time; three threads make it re-weigh in the middle.
5. **If the catalog feels expensive, delete directories.** 29 summaries cost ~1.7k tokens, resent every turn; delete the skills you never use and they leave the catalog. Do not shrink `catalogDescriptionMaxLength` — the pack puts "Use when …" at the end of each description, so truncation drops the trigger first.
6. **Subagents are guarded too** (`includeSubagents: true`). Delegated work is held to the same evidence rule.
7. **On Windows the check tool is `pwsh`**, already the default; change the executor and you must change `checkTools`, or the guard goes silent.

## Anti-patterns

| Do not | Why |
|---|---|
| One `bash` call that edits files and runs commands | A single `bash` counts as verification, not as a mutation, so the first guard cannot see it (a deliberate trade-off: otherwise `sed -i && npm test` would false-positive) |
| Expect it to remember last session's conclusions | Nothing crosses sessions; hand off with `PROGRESS.md` (`/st-context-reset`) or run `/st-catchup` |
| Edit `preset/agent.cordis.yml` and expect it to apply | Restart DSH |
| Switch presets inside an existing session | Not supported; only in a blank new session |
| Paste thousands of log lines and say "look at this" | The persona says read only the range you need; volume dilutes judgement |

## The two guards (st-loop)

On `agent/turn-stopping` (the turn is about to close, not yet committed) the guard reads this turn's durable event log and, when a rule is violated, `steer`s one short message so the turn takes one more step:

1. **Edited without verifying**: the turn had a successful file mutation (`write` / `edit`) and no successful shell check (`bash` / `pwsh`) afterwards. The message names only the files that are **still unproven** (files already covered by an earlier check are omitted) and asks for the smallest proving command, or one line explaining why none can run.
2. **Two failures in a row**: the turn ends with ≥2 consecutive failing tool results. The message asks the model to stop trying a third variant and to test the premise the attempts share instead.

Deliberate limits:

- At most 2 nudges per turn (`maxSteersPerTurn`); the **second is worded harder** — it says outright that this is the second close without evidence, because the polite first one clearly was not taken. The cap still holds, so the guard cannot become a loop.
- Shell results count as verification only, never as a mutation — `sed -i … && npm test` in one call is not a false positive.
- Documentation-only edits (`.md`, `.txt`, …) are exempt from the first rule: no command proves a README change. Docs mixed with code are not exempt.
- Plain question turns and plan-mode turns mutate nothing, so they never trigger.
- An exception inside the guard is logged once and never blocks the turn from closing.

Tunable fields (the `st-loop` row in `preset/agent.cordis.yml`):

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

- **The skill root uses `customSkillDirs` (rank 300), not `bundledSkillDir`**: the former is additive — project roots (100/200) still win, the user's own roots (400/500) still load, and the deployment's bundled root is untouched; the latter would replace the deployment default outright. The cost: a same-named `st-*` skill in `~/.dsh/skills` loses to this package (identical content, usually imperceptible).
- **Skill content is never rewritten**: to upgrade, re-mirror the pack `skills/` over `preset/skills/`. This package does not touch skill bodies, so there is nothing to merge.
- **The skill catalog costs a fixed prefix every turn**: 29 summaries, 6830 chars (≈1708 tokens), resent as durable prefix. To spend less, **delete the skill directories you do not use** (the directory is the only source of truth); do not lower `catalogDescriptionMaxLength` — the pack puts the "Use when …" clause at the end of each description, so truncation drops the routing signal first, and that signal is exactly what the token buys.
- **The guard has no platform branch**: on Windows the shell tool is `pwsh`, already in the `checkTools` default. If you disable `tool-pwsh` for a different executor, update that list or the guard silently stops matching.
- **This package writes exactly one line of your profile config**: retracting a dangling default-preset pointer in the profile's `cordis.patch.yml`, one scalar value. While the plugin is still usable it does not touch the file — closing DSH normally never loses your default preset.
- **`bash` can bypass the first rule**: one `bash` call that writes files and runs a command counts as verification only. That is a deliberate trade (otherwise `sed -i && npm test` would be a false positive); the cost is that an all-bash editing style is unconstrained.

## Disabling and uninstalling

This preset registers one preset candidate with the host. Once you pick it as the default, that choice is stored in the profile's `cordis.patch.yml` (the `selectedDefault` of the `agent-preset-registry` row). Disabling the bundle removes only the bundle listing; uninstalling removes only the directory. **Neither touches that pointer** — and a dangling pointer makes every new session throw `agent-preset/not-found` while resolving the preset. What you see is "after installing this plugin, DSH cannot start a session any more", and uninstalling does not heal it.

So this package ships a guard and a command:

| Situation | What to do | What happens |
|---|---|---|
| You want to disable it, plugin still installed | Disable it in the plugin manager | The guard retracts the pointer on disable; re-enabling restores your previous choice automatically (unless you picked another preset meanwhile) |
| You want it gone for good | Run `npx dsh-stack uninstall` first, then uninstall in the plugin manager | Pointer retracted first, then the bundle listing, dependency and directory go — no window in between |
| Already broken, no new sessions | `npx dsh-stack doctor`, then `npx dsh-stack doctor --fix` | Retracts the pointer, clears leftover listings and the preset marker in old session caches; restart DSH |
| You just want to look | `npx dsh-stack status` | One block per profile: package present, bundle listed, where the pointer aims |

The command finds `~/.dsh` by itself (`--home` to point elsewhere, `--profile` to handle one), is idempotent, and `--dry-run` reports without writing. It rewrites the value of that single `selectedDefault` scalar plus the bookkeeping entries that must follow — it never reflows your YAML/JSON and never touches session bodies or titles.

Why not a UI button: a button only exists while the plugin is still installed, and this failure happens exactly when it is not.

## Self-checks

Everything is dependency-free, Node ≥ 22:

```
npm test
```

| Command | What it checks |
|---|---|
| `node test/st-loop.test.mjs` | Guard behaviour, 17 assertions |
| `node test/preset.test.mjs` | Static assembly assertions, 15 (persona present, guard config matches module defaults, disabled rows untouched, prompt variables all registered by the host, uninstall guard agrees with the preset id in all three places) |
| `node test/uninstall-guard.test.mjs` | Disable/uninstall behaviour, 25 (a normal exit writes nothing, disabling retracts the pointer, re-installing restores it, a user-chosen preset is never overwritten, session caches keep everything but the preset field) |
| `node scripts/verify-lines.mjs` | **Preset line contract**: whether each line's package/subpath resolves on the current host and whether its `Config` accepts the keys we pass. Falls back to the `test/host-surface.json` specifier snapshot when no host is readable (regenerate with `scripts/snapshot-host-surface.mjs` after a host upgrade) |
| `node scripts/verify-preset.mjs` | Assembly integrity: include path = package name + directory, skill root derived from baseUrl, cap fits the longest description |
| `node scripts/verify-skills.mjs` | Skill validity: frontmatter, directory ↔ `name`, description length, no dead `/st-*` cross-references |
| `node scripts/verify-manifest.mjs` | Manifest and shipped artifact: allowlist, `engines`, actual `npm pack` contents |
| `node scripts/verify-mount.mjs` | Mounting: lays the package out like a real install in a temporary profile and lets the host loader resolve both relative paths, proving the guard and the include land on the right files (9 checks, SKIPs without a DSH install) |
| `node scripts/verify-host-api.mjs` | Host-private contracts: `agent/turn-stopping`, `agent.steer`, `session.snapshotEvents`, tool-name registry, `effect` disposer semantics, disabling a bundle never touching the pointer (9 checks; on an asar-packed desktop build it prints the extract command and SKIPs) |

Before publishing, `scripts/verify-release.mjs` additionally requires a clean tree, a tag matching the version, and a CHANGELOG section for the current version.

An installed copy (`node_modules/dsh-stack`) can run the same commands — `scripts/` ships too. `verify-release` is the exception: it reads Git history, so inside an installed copy it reports "not a git repository" and exits non-zero. That is expected.

## Why installing here matters

If the profile installs this bundle via `link:` (junction / symlink), then **editing files here edits the preset**: the next new session picks the new content up without reinstalling; existing sessions keep the composition they started with.

## Maintenance

This repo is maintained in-house. Version history lives in [CHANGELOG.md](CHANGELOG.md); the release process and directory conventions are maintainer-local and not published with the repo.
