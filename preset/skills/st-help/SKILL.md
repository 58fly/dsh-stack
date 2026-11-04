---
name: st-help
description: "Pick the right skill from this pack for a task, and explain how the pack fits together. Use when the user asks which skill to use, what the pack contains, or types /st-help."
---

# st-help

Match the task to one skill, say why in one line, then run it.

## Pick a skill

| If the task is... | Use |
|---|---|
| Any coding session (always on) | st-mode |
| Vague or high stakes | st-sharpen, then st-plan-loop |
| More than one file or step | st-plan-loop |
| A new module or API shape | st-blueprint |
| Any code change | st-verify-loop |
| A bug with a cheap test target | st-tdd |
| The same failure twice | st-unstick |
| A long run or a full context | st-context-reset, st-ledger |
| A hard artifact where one try may miss | st-best-of-n |
| Wide coverage, audits or races | st-swarm |
| A review before merge | st-review-loop, or st-jury for several models |
| A risky change | st-blast-radius |
| A new UI | st-design |
| A UI that looks generic | st-design-audit |
| Opening a PR | st-pr |
| Watching CI and bots | st-watch-pr |
| Change to merged PR, unattended | st-ship |
| Same, but stop before merge | st-ready |
| Someone else's PR or branch | st-adopt |
| An old PR | st-revive |
| Understanding code | st-explain |
| Coming back after a long run | st-catchup |
| Repeated agent mistakes | st-lessons |
| Writing prose or docs | st-unslop |
| Rules of thumb | st-principles |

## Rules

- Recommend one skill. Name a second only if the task clearly has two phases.
- If no skill fits, say so and work with st-mode alone.
