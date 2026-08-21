# WIN-43 Owner Dispatch Current-Main Anchor

Date: 2026-08-21
Issue: `WIN-43`
Base current `main`: [`a53c82c2ea766a00e91a6b59ceed534834a1c064`](https://github.com/Jeduardo622/AllIincompassing/commit/a53c82c2ea766a00e91a6b59ceed534834a1c064)
Base provenance PR only: [#991](https://github.com/Jeduardo622/AllIincompassing/pull/991) (`WIN-275`; not an eligible rotation dispatch PR)
Related failed-closed workflow runs:

- [Run 32435953468](https://github.com/Jeduardo622/AllIincompassing/actions/runs/32435953468)
- [Run 32436083599](https://github.com/Jeduardo622/AllIincompassing/actions/runs/32436083599)

## Purpose

This checkpoint records the owner-manual-only review anchor after rotation workflow runs `32435953468` and `32436083599` failed closed before checkout or mutation.

This document grants no authority, changes no policy, and is not a new attestation. Codex must not dispatch the rotation workflow. The repository owner must personally inspect and merge this PR, and after owner merge plus current-`main` exact-head required CI success, the owner may supply this PR's number, its exact post-merge current-`main` SHA, and the literal acknowledgement documented below to the existing Rotate Persistent QA Persona Credentials workflow.

Do not infer credential rotation success from this file, the failed-closed runs, or any later PR existence.

This PR must remain based on commit `a53c82c2ea766a00e91a6b59ceed534834a1c064` through owner review. The exact post-merge current-`main` SHA produced by the owner's merge, regardless of GitHub merge method, then becomes the only eligible dispatch SHA. Any other `main` movement before merge requires this branch to be refreshed and re-reviewed; any later `main` movement after this PR merges invalidates the dispatch candidate and requires a fresh checkpoint on the then-current `main`.

## Routing

- classification: `high-risk human-reviewed`
- lane: `critical`
- why: the file is documentation-only, but its operational purpose is a protected owner-only checkpoint tied to credential-rotation dispatch eligibility and merge sequencing
- triggering paths:
  - `docs/ai/handoffs/WIN-43-owner-dispatch-current-main-anchor-2026-08-21.md`
  - protected operational context only; no protected repository surface changed

## Scope

- task intent: create one owner-manual-only handoff file that anchors the current-`main` checkpoint for the next WIN-43 PR
- files touched:
  - `docs/ai/handoffs/WIN-43-owner-dispatch-current-main-anchor-2026-08-21.md`
- single-purpose diff: `yes`
- non-goals:
  - no workflow change
  - no script change
  - no test change
  - no attestation change
  - no protected surface change
  - no secrets change
  - no Supabase change
  - no Playwright change
  - no dispatch action
  - no credential value disclosure
  - no success inference

## Failure Evidence

- Run `32435953468` failed closed before checkout or mutation because its supplied `commit_sha` was not current `main`: <https://github.com/Jeduardo622/AllIincompassing/actions/runs/32435953468>
- Run `32436083599` failed closed before checkout or mutation because PR `#990` and the corrected current-`main` SHA were not the same merged WIN-43 PR: <https://github.com/Jeduardo622/AllIincompassing/actions/runs/32436083599>
- The later missing-artifact annotations are secondary noise after each early approval-gate failure; diagnose the first failed validation step rather than the artifact upload.
- Base current `main` provenance came from merged PR `#991`, which references `WIN-275` and is not an eligible rotation workflow `pull_request_number`: <https://github.com/Jeduardo622/AllIincompassing/pull/991>

## Eligibility Gates

The PR containing this file is eligible for owner manual use with the existing Rotate Persistent QA Persona Credentials workflow only if all conditions below are true:

1. This PR explicitly references `WIN-43`.
2. The owner personally inspects the PR contents.
3. The owner personally merges the PR to `main`.
4. The exact post-merge SHA produced by this PR is the current live GitHub `main` head, regardless of merge method.
5. The live strict required checks `policy`, `lint-typecheck`, `unit-tests`, `build`, `tier0-browser`, `auth-browser-smoke`, and `ci-gate` pass at that exact SHA.
6. No later `main` drift has occurred after this PR's post-merge SHA.
7. The owner personally dispatches the existing workflow after the merge and exact-head CI proof.

If any gate above is missing, stale, or ambiguous, this checkpoint must not be treated as sufficient dispatch support.

## Owner Dispatch Inputs After Merge

Do not rerun either failed workflow job and do not reuse PR `#990`, PR `#991`, or commit `a53c82c2ea766a00e91a6b59ceed534834a1c064` as dispatch inputs. Immediately before dispatch, verify the live GitHub `main` head rather than a local branch pointer. After this PR is personally merged by the owner and its required current-`main` checks pass, the owner must personally start a new workflow run from `main` with:

- `commit_sha`: the exact post-merge current-`main` SHA produced by this PR, regardless of merge method
- `pull_request_number`: this PR's number
- `approval_acknowledgement`: `I_APPROVE_WIN_43_QA_PERSONA_CREDENTIAL_ROTATION`

The PR number and SHA must identify the same merged WIN-43 PR. Mixed pairs such as PR `#990` with `a53c82c2ea766a00e91a6b59ceed534834a1c064`, or PR `#991` with any SHA, fail validation. Codex must not type or submit these rotation dispatch inputs.

## Verification Card

- required checks:
  - `git diff --cached --name-only` and `git diff --cached --check`
  - credential-pattern scan of the new document
  - Git-blob SHA-256 comparison for all 11 rotation attestation protected surfaces
  - `npm test -- --run tests/workflows/rotate-qa-persona-credentials.test.ts`
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
  - live GitHub `main`, branch-protection, and failed-run evidence readback
  - owner review and merge of this WIN-43 PR
  - exact-head required CI on post-merge current `main`
- required agents:
  - `specification-engineer`
  - `software-architect`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
  - `security-engineer`
  - `devops-engineer`
- executed checks:
  - one-file staged path and patch check: pass
  - credential-pattern scan: pass
  - all 11 Git-blob protected-surface hashes: pass
  - focused rotation workflow contract: pass (`6/6`)
  - focused policy checks: pass
  - lint: pass
  - typecheck: pass
  - build: pass
  - live remote `main`, strict seven-check branch protection, and failed-run evidence readback: pass
  - specification, implementation, architecture, security, test, code, and DevOps agent reviews: complete
- reviewer: corrected code-review and DevOps re-reviews pass
- blocked checks:
  - `npm run test:ci`: blocked by the known Windows 4 GB Node heap limit after broad test progress (`Reached heap limit Allocation failed - JavaScript heap out of memory`)
  - `npm run verify:local`: not rerun because it includes the same blocked `test:ci` aggregate
  - owner review of this PR: pending future owner action
  - owner merge of this PR: pending future owner action
  - exact-head required CI on merged current `main`: pending future merge state
- result: `pass-with-blocked-checks`
- residual risk: this file becomes stale if `main` moves before this PR merges or after its post-merge SHA is established, if this PR differs materially from the anchored intent, or if required CI and owner-only manual steps are not completed exactly as stated

## PR Hygiene

- branch-ready: `yes`
- linear-ready: `yes` via `WIN-43`
- protected-path drift: `none`
- unrelated changes: `not assessed in this document; this checkpoint owns only the single file above`
- generated artifact drift: `none`
- verification summary: `present`
- pr-ready: `yes`, for this documentation checkpoint only
- required follow-up:
  - open a new PR that references `WIN-43`
  - keep the diff limited to this handoff file
  - require personal owner inspection and merge
  - require exact-head CI on merged current `main`
  - require separate personal owner dispatch of the existing workflow

## Handoff Summary

This file records a protected operational checkpoint on `main` as of 2026-08-21 at commit `a53c82c2ea766a00e91a6b59ceed534834a1c064`, after workflow runs `32435953468` and `32436083599` failed closed before checkout or mutation. It does not authorize anything new, does not change policy, and does not replace owner review, owner merge, exact-head CI, or separate owner dispatch. If `main` changes, this anchor is invalid and must be regenerated from the new current `main`.
