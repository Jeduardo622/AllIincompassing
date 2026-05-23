# Message Sender Names Handoff

## Routing

- classification: `low-risk autonomous`
- lane: `standard`
- why: bounded messaging UI behavior change across existing client message components and tests, with no auth, server, CI, deploy, or schema edits
- triggering paths:
  - `src/components/messages/**`
  - `src/pages/messages/**`

## Scope

- task intent: show sender names for messages in the messaging thread route, including outbound messages from the current user
- follow-up slice: add participant names to inbox rows and direct-message thread titles, and keep direct-message participant fetching bounded to threads that actually render those names
- files touched:
  - `src/components/messages/ThreadRow.tsx`
  - `src/lib/messages/fetchers.ts`
  - `src/lib/messages/types.ts`
  - `src/lib/messages/__tests__/fetchMessageThread.test.ts`
  - `src/pages/messages/MessageThread.tsx`
  - `src/pages/messages/MessagesInbox.tsx`
  - `src/pages/messages/__tests__/MessagesInbox.test.tsx`
  - `src/components/messages/MessageList.tsx`
  - `src/pages/messages/__tests__/MessageThread.test.tsx`
  - `docs/ai/2026-05-22-message-sender-names-handoff.md`
- single-purpose diff: yes

## Required Agents

- required sequence:
  - `specification-engineer`
  - `implementation-engineer`
  - `code-review-engineer`
  - `test-engineer`
- agents used:
  - `reviewer`
  - `tester`
- reviewer: completed

## Verification Card

- required checks:
  - `npm run ci:check-focused`
  - `npm run lint`
  - `npm run typecheck`
  - `npm run test:ci`
  - `npm run build`
  - `npm run verify:local`
- executed checks:
  - `npx vitest run src/lib/messages/__tests__/fetchMessageThread.test.ts src/pages/messages/__tests__/MessagesInbox.test.tsx src/pages/messages/__tests__/MessageThread.test.tsx`: pass
  - `npx vitest run src/pages/messages/__tests__/MessageThread.test.tsx`: pass
  - `npm run ci:check-focused`: pass
  - `npm run lint`: pass
  - `npm run typecheck`: pass
  - `npm run test:ci`: pass with local dummy env values for `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
  - `npm run build`: pass
  - `npm run verify:local`: pass with local dummy env values for `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`
- blocked checks:
  - none
- result: pass
- residual risk: the change is still UI-bounded, but participant names for direct-message chrome now depend on the existing participant-name RPC. Group-thread naming remains subject-driven, and the branch still inherits pre-existing non-fatal test warnings from unrelated suites.

## PR Hygiene

- branch-ready: yes
- linear-ready: yes (`WIN-158`)
- protected-path drift: none
- unrelated changes: none
- generated artifact drift: none after restoring `reports/test-reliability-latest.json`
- verification summary: present
- pr-ready: yes
- required follow-up:
  - push branch
  - open PR for human review

## Handoff Summary

The messaging UI now shows names in the three places needed to answer “who is messaging who”: outbound sender labels inside the thread, inbox rows for subjectless direct messages, and direct-message thread titles. The fetcher work preserves the `fetchMessageThread()` null contract, limits participant-name lookups to direct threads that need the names, and extends inbox search to match participant names. The slice passed focused messaging tests, policy checks, lint, typecheck, full Vitest coverage, build, and `verify:local`.
