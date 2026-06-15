# Lifecycle Fallback And Target Index Guard

## Scope

- Accept `409 ALREADY_TERMINAL` from the authenticated lifecycle fallback when the requested terminal state was already reached by the UI path.
- Preserve blank target slots while editing and saving later indexed goal-measurement targets in `AddSessionNoteModal`.

## Verification

- `npm run test -- src/scripts/__tests__/playwrightSessionLifecycleFallback.test.ts src/components/__tests__/AddSessionNoteModal.test.tsx src/lib/__tests__/goal-measurements.test.ts`
- `npm run lint`
- `npm run typecheck`
- `npm run ci:check-focused`
- `npm run build`
- `npm run test:ci` -> failed outside this slice because untargeted `src/server/__tests__/orgRoleRpcEquivalence.contract.test.ts` now requires `VITE_SUPABASE_URL` from process env or `.env.codex` in this worktree.

## Residual Risk

- The authenticated fallback now treats any `409` response carrying `code: "ALREADY_TERMINAL"` as success and relies on the existing post-close session-status assertion to reject mismatched terminal states.
- Full `test:ci` remains blocked by baseline env setup unrelated to the touched files.
