# Post-merge: therapist–client link visibility (Option A)

Use this checklist after the change that aligns **`client_therapist_links`** with therapist-facing client lists on **`/schedule`** and **`/clients`** (read path: primary `clients.therapist_id`, link table, and session history where applicable).

## Product / support

- [ ] **Therapist sees link-only clients:** As an admin, link a client to a therapist **without** setting that client’s primary therapist to them. Sign in as that therapist and confirm the client appears in the **Schedule** client filter and the **Clients** list without requiring a prior session.
- [ ] **Primary therapist unchanged:** Confirm linking alone does not unintentionally change primary assignment behavior unless that is explicitly performed elsewhere in the product.

## Engineering

- [ ] **RLS:** If `client_therapist_links` SELECT fails for a therapist in staging or production logs, treat it as a policy issue (separate from the UI merge logic).
- [ ] **Staging / preview:** Repeat the smoke on a deployed environment.

## Reference

- Shared helper: `src/lib/clients/therapistClientScope.ts` (`fetchLinkedClientIdsForTherapist`, `getMissingClientIds`).
- Schedule filtering: `visibleClients` in `src/pages/Schedule.tsx` includes linked IDs after the linked-ID query succeeds (avoids empty dropdown flash while loading).
