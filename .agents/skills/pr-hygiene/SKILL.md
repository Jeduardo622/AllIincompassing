---
name: pr-hygiene
description: Verify that a completed non-trivial code or config change is isolated, reviewable, and ready for PR submission in this repository. Use after implementation and before finalizing low-risk autonomous or other non-trivial changes to check branch, PR, and Linear readiness, unrelated file drift, generated artifact drift, protected-path drift, missing summaries, and whether the diff is still single-purpose.
---
# PR Hygiene

## Purpose

Use this skill after implementing a non-trivial code or config change and before finalizing to confirm the diff is still small, isolated, and ready for human PR review.

This is a review-only skill. Do not modify application logic while running it.
Do not use this skill for docs-only or process-only changes that stay within the repo's existing low-risk exception.
Assume implementation work should land on a dedicated branch and end in a PR, not a direct push to `main`. For high-risk work, also assume the PR should map to a Linear issue.

Sources of truth:
- `AGENTS.md`
- `.agents/skills/route-task/SKILL.md`
- `.agents/skills/verify-change/SKILL.md`
- `docs/ai/high-risk-paths.md`
- `docs/ai/verification-matrix.md`

## Steps

1. Re-read the task intent and inspect the current diff with `git status`, `git diff --stat`, and targeted `git diff`.
2. Check branch readiness.
   - Confirm the work is on a dedicated branch rather than `main`.
   - For Codex-created implementation branches, prefer the `codex/` prefix.
   - Flag the change as not PR-ready if it still lives only on `main`.
3. Check for unrelated file changes.
   - Flag files that do not support the stated task.
   - Flag opportunistic cleanup, drive-by refactors, or mixed concerns.
4. Check for generated artifact drift.
   - Flag generated outputs that changed without their source inputs.
   - Flag source changes that normally require regenerated outputs when those outputs were not updated.
5. Check for protected-path drift.
   - Compare touched files against `AGENTS.md` and `docs/ai/high-risk-paths.md`.
   - If any protected path is touched, reclassify the change with `route-task` as high risk and treat human review as mandatory.
6. Check whether the diff is still single-purpose.
   - Confirm the change can be explained as one reviewable intent.
   - If not, recommend splitting the work before PR submission.
7. Check for a missing change summary.
   - Ensure there is a short summary of what changed and why.
8. Check for a missing verification summary.
   - Ensure required checks from `verify-change` are summarized with commands run, pass/fail, and blocked checks.
9. Check tracking readiness.
   - Confirm high-risk work is linked to a Linear issue.
   - For other non-trivial work, flag missing Linear tracking when the task would benefit from auditable handoff.
10. Check PR handoff readiness.
   - Confirm the branch can be pushed cleanly.
   - Confirm there is enough summary material for a PR title and body.
11. Use `reviewer` before finalizing.
   - Ask for focused review on auth, tenant isolation, CI-policy, protected-path drift, and regression risk.
12. Report a final PR-hygiene verdict.

## Output Format

- `pr-ready`: yes or no
- `branch-ready`: yes or no
- `linear-ready`: yes or no
- `single-purpose`: yes or no
- `unrelated changes`: none or explicit files
- `generated artifact drift`: none or explicit files and why
- `protected-path drift`: none or explicit files
- `change summary`: present or missing
- `verification summary`: present or missing
- `pr handoff`: ready or missing branch/push/PR details
- `reviewer`: completed or blocked
- `required follow-up`: short actionable list
- `handoff summary`: 2-4 sentences suitable for PR/body reuse

## Rules

- Prefer the smallest reviewable diff.
- Do not treat work on `main` as PR-ready implementation state.
- Do not treat high-risk work without Linear tracking as PR-ready.
- Escalate immediately if protected paths appear, even if the task started low risk.
- Do not treat missing verification as PR-ready.
- Do not treat mixed-purpose diffs as PR-ready.
- Do not modify app logic as part of this pass.
