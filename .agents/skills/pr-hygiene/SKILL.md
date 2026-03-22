---
name: pr-hygiene
description: Verify that a completed non-trivial code or config change is isolated, reviewable, and ready for PR submission in this repository. Use after implementation and before finalizing low-risk autonomous or other non-trivial changes to check unrelated file drift, generated artifact drift, protected-path drift, missing summaries, and whether the diff is still single-purpose.
---
# PR Hygiene

## Purpose

Use this skill after implementing a non-trivial code or config change and before finalizing to confirm the diff is still small, isolated, and ready for human PR review.

This is a review-only skill. Do not modify application logic while running it.
Do not use this skill for docs-only or process-only changes that stay within the repo's existing low-risk exception.

Sources of truth:
- `AGENTS.md`
- `.agents/skills/route-task/SKILL.md`
- `.agents/skills/verify-change/SKILL.md`
- `docs/ai/high-risk-paths.md`
- `docs/ai/verification-matrix.md`

## Steps

1. Re-read the task intent and inspect the current diff with `git status`, `git diff --stat`, and targeted `git diff`.
2. Check for unrelated file changes.
   - Flag files that do not support the stated task.
   - Flag opportunistic cleanup, drive-by refactors, or mixed concerns.
3. Check for generated artifact drift.
   - Flag generated outputs that changed without their source inputs.
   - Flag source changes that normally require regenerated outputs when those outputs were not updated.
4. Check for protected-path drift.
   - Compare touched files against `AGENTS.md` and `docs/ai/high-risk-paths.md`.
   - If any protected path is touched, reclassify the change with `route-task` as high risk and treat human review as mandatory.
5. Check whether the diff is still single-purpose.
   - Confirm the change can be explained as one reviewable intent.
   - If not, recommend splitting the work before PR submission.
6. Check for a missing change summary.
   - Ensure there is a short summary of what changed and why.
7. Check for a missing verification summary.
   - Ensure required checks from `verify-change` are summarized with commands run, pass/fail, and blocked checks.
8. Use `reviewer` before finalizing.
   - Ask for focused review on auth, tenant isolation, CI-policy, protected-path drift, and regression risk.
9. Report a final PR-hygiene verdict.

## Output Format

- `pr-ready`: yes or no
- `single-purpose`: yes or no
- `unrelated changes`: none or explicit files
- `generated artifact drift`: none or explicit files and why
- `protected-path drift`: none or explicit files
- `change summary`: present or missing
- `verification summary`: present or missing
- `reviewer`: completed or blocked
- `required follow-up`: short actionable list
- `handoff summary`: 2-4 sentences suitable for PR/body reuse

## Rules

- Prefer the smallest reviewable diff.
- Escalate immediately if protected paths appear, even if the task started low risk.
- Do not treat missing verification as PR-ready.
- Do not treat mixed-purpose diffs as PR-ready.
- Do not modify app logic as part of this pass.
