# dsh-stack

The DeepSeek Stack mode (`ds-stack`) agent preset for DSH, shipped as an installable bundle.

Repository: [58fly/dsh-stack](https://github.com/58fly/dsh-stack) · Skills from [aicodeking/deepseek-stack](https://github.com/aicodeking/deepseek-stack) (MIT, see [NOTICE.md](NOTICE.md)) · Upstream preset: [TonyZiYuan/dsh-ds-stack-preset](https://github.com/TonyZiYuan/dsh-ds-stack-preset)

[aicodeking/deepseek-stack](https://github.com/aicodeking/deepseek-stack) is a pack of `SKILL.md` files that patches four gaps common to cheap models: no plan first, claiming a fix without running anything, retrying the same failing idea, and drifting on long tasks. Two things are missing when you drop that pack into DSH: **persistence** (a skill only applies after the `skill` tool loads it, yet `ds-mode` calls itself always-on) and a **hard boundary** (prose rules drift in a long session). This preset supplies those two and copies the rest verbatim.

## Upstream → this preset

| Upstream | Becomes | Where |
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
- `preset/skills/` — the 29 upstream skills, byte-for-byte.

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

## Usage

- Pick 「DeepSeek Stack 模式」 when creating a session and the persona applies immediately.
- The first turn carries a catalog of the 29 skills (each summary capped at 400 chars, ~6.8k chars ≈ 1.7k tokens of durable prefix). The model loads what it needs with the `skill` tool; you can also type a gesture such as `/ds-plan-loop`, `/ds-verify-loop`, `/ds-unstick`.
- `/ds-help` makes the model choose a skill itself.

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
- **Upstream is not followed automatically**: to upgrade, re-mirror upstream `skills/` over `preset/skills/`. This package never rewrites skill content, so there is nothing to merge.
- **The skill catalog costs a fixed prefix every turn**: 29 summaries, 6830 chars (≈1708 tokens), resent as durable prefix. To spend less, delete the skill directories you do not use (the directory is the only source of truth) or lower `catalogDescriptionMaxLength` — but upstream puts the "Use when …" clause at the end of each description, so truncation drops the routing signal first.
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

This repo is maintained in-house and does not auto-follow upstream. Release process and directory conventions live in [AGENTS.md](AGENTS.md); version history in [CHANGELOG.md](CHANGELOG.md).
