# BCBA Supervision Workflow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route each completed BT ABA note to a deterministically assigned BCBA, let that BCBA review the immutable BT note from Dashboard, and atomically save a separate signed Supervision Session Note.

**Architecture:** A forward Supabase migration owns assignment, authorization, packet reads, backfill, and BCBA attestation. The browser consumes one tenant-checked review-packet RPC and maps it into explicit TypeScript models. Dashboard renders the BT packet read-only above the independent supervision form and uses a generalized typed/drawn signature control.

**Tech Stack:** PostgreSQL/Supabase RLS and security-definer RPCs, React 18, TypeScript, TanStack Query, Vitest/Testing Library, Playwright.

## Global Constraints

- Preserve two independent records: the BT ABA note remains in `client_session_notes`; the BCBA response remains in `supervision_session_notes`.
- BT closeout must succeed when BCBA assignment is missing or ambiguous.
- Resolve assignment in this order: one active same-org linked exact-BCBA; otherwise the sole active exact-BCBA in the organization; otherwise null.
- Treat active `user_roles` joined to `roles.name = 'bcba'` as canonical; do not authorize from `profiles.role` or therapist title alone.
- Assigned exact-BCBA may read and complete only their own same-org request.
- Admin-family users retain same-org operational visibility but cannot complete or sign unless they are the assigned active exact-BCBA.
- The BT note and BT attestation are read-only in the BCBA workflow.
- A successful BCBA completion atomically creates one supervision note, one `bcba` attestation, and completes the request.
- Do not expose service-role credentials or add browser service-role reads.
- Do not include production PHI or customer-identifying values in tests, docs, commits, or screenshots.
- Use a new forward migration timestamp greater than `20260717144005`; never edit an applied migration.

---

## File Map

- Create `supabase/migrations/20260717163000_route_bt_notes_to_assigned_bcba.sql`: assignment resolver, request/reconcile replacement, pending backfill, RLS, review-packet RPC, and signed completion RPC.
- Create `tests/bcbaSupervisionReviewWorkflowMigration.test.ts`: static migration contract and regression coverage.
- Modify `src/lib/supervision-session-notes.ts`: review-packet types, RPC mapping, and completion signature contract.
- Modify `src/lib/__tests__/supervision-session-notes.test.ts`: packet mapping and completion RPC tests.
- Create `src/components/session-notes/ClinicalSignatureInput.tsx`: reusable typed/drawn clinical signature control.
- Modify `src/components/session-notes/SignatureInput.tsx`: BT-specific wrapper preserving the existing API and labels.
- Create `src/components/session-notes/__tests__/ClinicalSignatureInput.test.tsx`: reusable signature behavior tests.
- Modify `src/pages/Dashboard.tsx`: review-first packet UI, controlled BCBA signature, and completion eligibility.
- Modify focused Dashboard tests under `src/pages/__tests__/`: review packet rendering, signature validation, and admin view-only behavior.
- Update `docs/superpowers/specs/2026-07-17-bcba-supervision-workflow-design.md` only if implementation reveals a necessary clarified invariant; no scope additions.

---

### Task 1: Tenant-Safe Assignment, Review Packet, And Atomic BCBA Completion

**Files:**
- Create: `supabase/migrations/20260717163000_route_bt_notes_to_assigned_bcba.sql`
- Create: `tests/bcbaSupervisionReviewWorkflowMigration.test.ts`
- Read for compatibility: `supabase/migrations/20260629233000_create_supervision_session_note_workflow.sql`
- Read for compatibility: `supabase/migrations/20260716212837_bt_aba_session_note_closeout.sql`

**Interfaces:**
- Produces: `app.resolve_supervision_bcba_assignee(uuid, uuid) returns uuid`
- Produces: `public.get_pending_supervision_review_packets() returns table (...)`
- Replaces: `public.create_supervision_session_note_request_for_completed_session(uuid) returns uuid`
- Replaces: `public.reconcile_supervision_session_note_requests(timestamptz) returns integer`
- Replaces: `public.complete_supervision_session_note_request(uuid, uuid, jsonb) returns uuid`

- [ ] **Step 1: Write the failing migration contract tests**

Create `tests/bcbaSupervisionReviewWorkflowMigration.test.ts` with focused assertions against the new migration:

```ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const sql = readFileSync(
  join(process.cwd(), 'supabase/migrations/20260717163000_route_bt_notes_to_assigned_bcba.sql'),
  'utf8',
);

describe('BCBA supervision review workflow migration', () => {
  it('resolves a unique linked BCBA before the sole organization BCBA fallback', () => {
    expect(sql).toMatch(/create or replace function app\.resolve_supervision_bcba_assignee/i);
    expect(sql).toMatch(/client_therapist_links/i);
    expect(sql).toMatch(/user_therapist_links/i);
    expect(sql).toMatch(/r\.name = 'bcba'/i);
    expect(sql).toMatch(/if v_linked_count = 1 then[\s\S]*return v_linked_user_id/i);
    expect(sql).toMatch(/if v_org_count = 1 then[\s\S]*return v_org_user_id/i);
    expect(sql).toMatch(/return null/i);
  });

  it('assigns creator and reconciled requests without blocking ambiguous closeout', () => {
    expect(sql).toMatch(/assigned_admin_user_id[\s\S]*app\.resolve_supervision_bcba_assignee/i);
    expect(sql).toMatch(/on conflict \(session_id\) do update[\s\S]*assigned_admin_user_id = coalesce/i);
    expect(sql).not.toMatch(/raise exception[^;]*(ambiguous|bcba assignment)/i);
  });

  it('backfills only pending unassigned deterministic requests', () => {
    expect(sql).toMatch(/update public\.supervision_session_note_requests/i);
    expect(sql).toMatch(/status = 'pending'/i);
    expect(sql).toMatch(/assigned_admin_user_id is null/i);
    expect(sql).toMatch(/resolved\.assigned_user_id is not null/i);
  });

  it('requires the BCBA signature and credential in the canonical template', () => {
    expect(sql).toMatch(/bcba_supervisor_signature[\s\S]*required[\s\S]*true/i);
    expect(sql).toMatch(/bcba_licensure_credential[\s\S]*required[\s\S]*true/i);
    expect(sql).toMatch(/template_type = 'supervision_session_note'/i);
  });

  it('limits BCBA reads to assigned same-org requests while retaining admin visibility', () => {
    expect(sql).toMatch(/assigned_admin_user_id = auth\.uid\(\)/i);
    expect(sql).toMatch(/app\.user_has_role_for_org\([\s\S]*array\['bcba'\]/i);
    expect(sql).toMatch(/array\['admin', 'super_admin', 'org_admin', 'org_super_admin'\]/i);
  });

  it('returns a tenant-checked immutable BT review packet', () => {
    expect(sql).toMatch(/create or replace function public\.get_pending_supervision_review_packets\(\)/i);
    expect(sql).toMatch(/bt_aba_responses/i);
    expect(sql).toMatch(/bt_aba_template_snapshot/i);
    expect(sql).toMatch(/attestation_role = 'bt'/i);
    expect(sql).toMatch(/revoke all on function public\.get_pending_supervision_review_packets\(\) from public, anon/i);
  });

  it('requires the assigned exact BCBA and writes a BCBA attestation atomically', () => {
    expect(sql).toMatch(/v_request\.assigned_admin_user_id is distinct from v_actor/i);
    expect(sql).toMatch(/array\['bcba'\]/i);
    expect(sql).toMatch(/attestation_role[\s\S]*'bcba'/i);
    expect(sql).toMatch(/signature_method[\s\S]*signature_value/i);
    expect(sql).toMatch(/invalid BCBA signature/i);
  });
});
```

- [ ] **Step 2: Run the migration test to prove RED**

Run:

```powershell
$env:Path='C:\Users\test\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin;' + $env:Path
npx vitest run tests/bcbaSupervisionReviewWorkflowMigration.test.ts
```

Expected: FAIL because `20260717163000_route_bt_notes_to_assigned_bcba.sql` does not exist.

- [ ] **Step 3: Implement the forward migration**

Create `app.resolve_supervision_bcba_assignee` as `stable security definer` with `search_path = public, app, auth`. Reject null inputs by returning null. Verify the client belongs to `p_organization_id`. Count distinct active exact-BCBA users through same-org `client_therapist_links -> therapists -> user_therapist_links -> profiles`, requiring active/unexpired `user_roles`. Return the user only when that linked count is one. Otherwise count active exact-BCBA users whose profile belongs to the organization and return the user only when that count is one.

Use the exact skeleton:

```sql
create or replace function app.resolve_supervision_bcba_assignee(
  p_organization_id uuid,
  p_client_id uuid
) returns uuid
language plpgsql stable security definer
set search_path = public, app, auth
as $$
declare
  v_linked_count integer := 0;
  v_linked_user_id uuid;
  v_org_count integer := 0;
  v_org_user_id uuid;
begin
  if p_organization_id is null or p_client_id is null
     or not exists (
       select 1 from public.clients c
       where c.id = p_client_id and c.organization_id = p_organization_id
     ) then
    return null;
  end if;

  select count(distinct utl.user_id),
         (array_agg(distinct utl.user_id order by utl.user_id))[1]
    into v_linked_count, v_linked_user_id
  from public.client_therapist_links ctl
  join public.therapists t
    on t.id = ctl.therapist_id
   and t.organization_id = p_organization_id
   and lower(coalesce(t.status, 'active')) = 'active'
   and t.deleted_at is null
  join public.user_therapist_links utl on utl.therapist_id = t.id
  join public.profiles p
    on p.id = utl.user_id and p.organization_id = p_organization_id
  where ctl.client_id = p_client_id
    and ctl.organization_id = p_organization_id
    and exists (
      select 1 from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = utl.user_id and r.name = 'bcba'
        and coalesce(ur.is_active, true)
        and (ur.expires_at is null or ur.expires_at > now())
    );

  if v_linked_count = 1 then return v_linked_user_id; end if;

  select count(distinct p.id),
         (array_agg(distinct p.id order by p.id))[1]
    into v_org_count, v_org_user_id
  from public.profiles p
  where p.organization_id = p_organization_id
    and exists (
      select 1 from public.user_roles ur
      join public.roles r on r.id = ur.role_id
      where ur.user_id = p.id and r.name = 'bcba'
        and coalesce(ur.is_active, true)
        and (ur.expires_at is null or ur.expires_at > now())
    );

  if v_org_count = 1 then return v_org_user_id; end if;
  return null;
end;
$$;
```

Recreate both request-creation functions from their latest definitions. Add `assigned_admin_user_id` to their inserts using the resolver. On creator conflict, preserve an existing assignee and fill only a null assignee:

```sql
assigned_admin_user_id = coalesce(
  supervision_session_note_requests.assigned_admin_user_id,
  excluded.assigned_admin_user_id
)
```

Backfill pending unassigned rows with a lateral resolver and require the resolved value to be non-null.

Permit the reconcile RPC for same-org admin-family users and active exact-BCBA users. This keeps the existing Dashboard reconciliation call valid for standalone BCBAs; the request RLS and packet RPC still ensure each BCBA sees only assigned work.

Update the canonical Supervision Session Note template JSON so `bcba_supervisor_signature` and `bcba_licensure_credential` have `required: true`. Scope the update by `template_type = 'supervision_session_note'` and `template_name = 'Supervision Session Note'`, preserving every other field property and order.

Replace request and note select policies with this predicate:

```sql
app.user_has_role_for_org(
  auth.uid(), organization_id,
  array['admin', 'super_admin', 'org_admin', 'org_super_admin']
)
or (
  assigned_admin_user_id = auth.uid()
  and app.user_has_role_for_org(auth.uid(), organization_id, array['bcba'])
)
```

For `supervision_session_notes`, use an `exists` join to its request for the assigned-BCBA branch.

Create `public.get_pending_supervision_review_packets()` returning table columns:

```sql
request_id uuid,
organization_id uuid,
session_id uuid,
client_id uuid,
bt_therapist_id uuid,
assigned_reviewer_user_id uuid,
request_status text,
request_created_at timestamptz,
session_start_time timestamptz,
session_end_time timestamptz,
place_of_service text,
client_name text,
bt_therapist_name text,
bt_therapist_title text,
bt_note_id uuid,
bt_responses jsonb,
bt_template_snapshot jsonb,
bt_signature_method text,
bt_signed_at timestamptz,
supervision_template_id uuid,
supervision_template_name text,
supervision_template_structure jsonb,
can_complete boolean
```

Select only pending requests authorized by the same policy predicate. Return `sessions.location_type` as `place_of_service`. Join exactly one `client_session_notes` row by `session_id`; use a lateral query ordered by `updated_at desc, id` with `limit 1` because the table does not enforce one note row per session. Join the BT attestation by `note_id` and `attestation_role = 'bt'`; return signature method and timestamp, never `signature_value`. Join the same-org supervision template with `template_type = 'supervision_session_note'`. Set `can_complete` only when the actor equals the assignee and has active exact-BCBA role.

Recreate `complete_supervision_session_note_request` from the current function, retaining its complete required/conditional-field validation. Replace the admin gate with assigned active exact-BCBA authorization. Read structured signature from `p_responses->'bcba_supervisor_signature'`:

```sql
v_signature_method := btrim(coalesce(p_responses #>> '{bcba_supervisor_signature,method}', ''));
v_signature_value := btrim(coalesce(p_responses #>> '{bcba_supervisor_signature,value}', ''));
```

Require method in `('typed','drawn')`, non-empty value, and `char_length(v_signature_value) <= 4096`. Validate drawn `points:` JSON with the same 256-point, two-coordinate, 0..1 rules used by BT closeout. After inserting `supervision_session_notes`, find the canonical BT `client_session_notes.id` for the session and insert:

```sql
insert into public.session_note_attestations (
  organization_id, note_id, signer_user_id, attestation_role,
  signature_method, signature_value, signed_at
) values (
  v_actor_org, v_bt_note_id, v_actor, 'bcba',
  v_signature_method, v_signature_value, timezone('utc', now())
);
```

Do not use `on conflict do nothing` for the BCBA attestation; a duplicate must roll back the note completion. Keep all operations in one RPC transaction. Revoke from public/anon and grant resolver only to service_role, review/completion RPCs to authenticated and service_role. Finish with `notify pgrst, 'reload schema'` and `commit`.

- [ ] **Step 4: Run focused migration and existing workflow tests**

Run:

```powershell
npx vitest run tests/bcbaSupervisionReviewWorkflowMigration.test.ts tests/supervisionSessionNoteWorkflowMigration.test.ts tests/btAbaSessionNoteMigration.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Run protected-path static gates**

Run:

```powershell
npm run ci:check-focused
npm run validate:tenant
```

Expected: both commands exit 0; connection-dependent checks may report explicit local skips, but static migration/RLS checks pass.

- [ ] **Step 6: Commit Task 1**

```powershell
git add supabase/migrations/20260717163000_route_bt_notes_to_assigned_bcba.sql tests/bcbaSupervisionReviewWorkflowMigration.test.ts
git commit -m "feat: route BT notes to assigned BCBA"
```

---

### Task 2: Typed Review-Packet Client Contract

**Files:**
- Modify: `src/lib/supervision-session-notes.ts`
- Modify: `src/lib/__tests__/supervision-session-notes.test.ts`

**Interfaces:**
- Consumes: `public.get_pending_supervision_review_packets()` from Task 1
- Produces: `ClinicalSignatureValue`, `SupervisionBtReviewPacket`, extended `PendingSupervisionSessionNoteRequest`
- Preserves: `completeSupervisionSessionNote(input) -> { noteId: string }`

- [ ] **Step 1: Replace the pending-loader test with a failing RPC packet-mapping test**

Add this fixture and assertions to `src/lib/__tests__/supervision-session-notes.test.ts`:

```ts
rpcMock.mockResolvedValueOnce({
  data: [{
    request_id: 'request-1', organization_id: 'org-1', session_id: 'session-1',
    client_id: 'client-1', bt_therapist_id: 'bt-1', assigned_reviewer_user_id: 'bcba-1',
    request_status: 'pending', request_created_at: '2026-07-17T12:00:00Z',
    session_start_time: '2026-07-17T10:00:00Z', session_end_time: '2026-07-17T11:00:00Z',
    place_of_service: '12 - Home', client_name: 'Test Client', bt_therapist_name: 'Test BT',
    bt_therapist_title: 'BT', bt_note_id: 'note-1',
    bt_responses: { client_status: 'Ready for treatment.' },
    bt_template_snapshot: { sections: [] }, bt_signature_method: 'typed',
    bt_signed_at: '2026-07-17T11:05:00Z', supervision_template_id: 'template-1',
    supervision_template_name: 'Supervision Session Note',
    supervision_template_structure: { sections: [{ key: 'summary', fields: [] }] },
    can_complete: true,
  }],
  error: null,
});

const result = await fetchPendingSupervisionSessionNoteRequests('org-1');
expect(rpcMock).toHaveBeenCalledWith('get_pending_supervision_review_packets', {});
expect(result.requests[0]).toMatchObject({
  id: 'request-1', assignedAdminUserId: 'bcba-1', canComplete: true,
  btReview: {
    noteId: 'note-1', responses: { client_status: 'Ready for treatment.' },
    signatureMethod: 'typed', signedAt: '2026-07-17T11:05:00Z',
  },
});
expect(result.template?.id).toBe('template-1');
```

Update completion expectations so `responses` includes:

```ts
bcba_supervisor_signature: { method: 'typed', value: 'Test BCBA' }
```

- [ ] **Step 2: Run the library test to prove RED**

Run:

```powershell
npx vitest run src/lib/__tests__/supervision-session-notes.test.ts
```

Expected: FAIL because the loader still queries raw tables and the mapped packet fields do not exist.

- [ ] **Step 3: Implement the packet types and RPC mapping**

Add these public types:

```ts
export type ClinicalSignatureValue = {
  method: 'typed' | 'drawn';
  value: string;
};

export type SupervisionBtReviewPacket = {
  noteId: string;
  responses: Record<string, unknown>;
  templateSnapshot: { sections?: SupervisionTemplateSection[] };
  signatureMethod: 'typed' | 'drawn' | null;
  signedAt: string | null;
};
```

Extend `PendingSupervisionSessionNoteRequest` with `placeOfService: string | null`, `canComplete: boolean`, and `btReview: SupervisionBtReviewPacket`.

Replace raw request/template queries in `fetchPendingSupervisionSessionNoteRequests` with:

```ts
const { data, error } = await callRpc('get_pending_supervision_review_packets', {});
if (error) throw error;
```

Map snake-case packet rows defensively. Require `bt_note_id`; throw `new Error('Completed BT note is unavailable for supervision review.')` if it is absent. Derive the single returned template from the first packet and return null only for an empty queue. Keep the existing organization-context precondition even though the RPC derives tenant context from auth.

Remove the separate raw table template fetch from this loader. Leave the lightweight badge count unchanged because RLS now scopes it.

- [ ] **Step 4: Run the library tests**

```powershell
npx vitest run src/lib/__tests__/supervision-session-notes.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit Task 2**

```powershell
git add src/lib/supervision-session-notes.ts src/lib/__tests__/supervision-session-notes.test.ts
git commit -m "feat: load BCBA supervision review packets"
```

---

### Task 3: Reusable Clinical Signature And Review-First Dashboard

**Files:**
- Create: `src/components/session-notes/ClinicalSignatureInput.tsx`
- Modify: `src/components/session-notes/SignatureInput.tsx`
- Create: `src/components/session-notes/__tests__/ClinicalSignatureInput.test.tsx`
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/pages/__tests__/Dashboard.noFallback.test.tsx`

**Interfaces:**
- Consumes: `ClinicalSignatureValue` and packet models from Task 2
- Produces: `ClinicalSignatureInput(props)` with configurable heading, typed label, draw label, and field key
- Preserves: existing `SignatureInput` BT API and behavior

- [ ] **Step 1: Write failing reusable signature tests**

Create `ClinicalSignatureInput.test.tsx` covering typed and drawn values:

```tsx
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { ClinicalSignatureInput } from '../ClinicalSignatureInput';

describe('ClinicalSignatureInput', () => {
  it('captures a typed BCBA signature with configurable labels', () => {
    const onChange = vi.fn();
    render(<ClinicalSignatureInput
      heading="BCBA Signature"
      typedLabel="Type BCBA signature"
      drawLabel="Draw BCBA signature"
      fieldKey="bcba_supervisor_signature"
      value={{ method: 'typed', value: '' }}
      onChange={onChange}
    />);
    fireEvent.change(screen.getByLabelText('Type BCBA signature'), { target: { value: 'Test BCBA' } });
    expect(onChange).toHaveBeenCalledWith({ method: 'typed', value: 'Test BCBA' });
  });

  it('serializes normalized drawn points and clears them', () => {
    const onChange = vi.fn();
    render(<ClinicalSignatureInput
      heading="BCBA Signature" typedLabel="Type BCBA signature" drawLabel="Draw BCBA signature"
      fieldKey="bcba_supervisor_signature" value={{ method: 'drawn', value: '' }} onChange={onChange}
    />);
    const pad = screen.getByRole('application', { name: 'Draw BCBA signature' });
    fireEvent.pointerDown(pad, { clientX: 10, clientY: 10, pointerId: 1 });
    fireEvent.pointerUp(pad, { clientX: 20, clientY: 20, pointerId: 1 });
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ method: 'drawn' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear signature' }));
    expect(onChange).toHaveBeenLastCalledWith({ method: 'drawn', value: '' });
  });
});
```

- [ ] **Step 2: Add failing Dashboard tests**

Render `DashboardView` with one packet. Assert:

```tsx
expect(screen.getByText('Completed BT ABA Session Note')).toBeInTheDocument();
expect(screen.getByText('Ready for treatment.')).toBeInTheDocument();
expect(screen.getByText(/BT signed/i)).toBeInTheDocument();
expect(screen.getByText('Supervision Session Note')).toBeInTheDocument();
expect(screen.getByLabelText('Type BCBA signature')).toBeInTheDocument();
```

Add a packet with `canComplete: false`; assert the review content is visible and the submit button is disabled with operational copy explaining that only the assigned BCBA can sign.

- [ ] **Step 3: Run focused UI tests to prove RED**

```powershell
npx vitest run src/components/session-notes/__tests__/ClinicalSignatureInput.test.tsx src/pages/__tests__/Dashboard.noFallback.test.tsx
```

Expected: FAIL because the generalized component and review-first content do not exist.

- [ ] **Step 4: Generalize the signature component without regressing BT closeout**

Move the existing point parsing, serialization, drawing, method switching, and clear behavior into `ClinicalSignatureInput`. Use props:

```ts
export type ClinicalSignatureInputProps = {
  heading: string;
  typedLabel: string;
  drawLabel: string;
  fieldKey: string;
  value: ClinicalSignatureValue;
  onChange: (value: ClinicalSignatureValue) => void;
  disabled?: boolean;
  error?: string;
};
```

Use `fieldKey` to derive unique ids and `data-field`; keep `MAX_POINTS = 256`, the `points:` prefix, coordinate clamping, and the current SVG rendering. Make `SignatureInput.tsx` a wrapper that passes the existing BT labels and `fieldKey="bt_signature"`, preserving its exported props and BT response type compatibility.

- [ ] **Step 5: Implement the Dashboard review-first form**

Add controlled state:

```ts
const [bcbaSignature, setBcbaSignature] = useState<ClinicalSignatureValue>({
  method: 'drawn', value: '',
});
```

Reset it when opening, cancelling, or successfully submitting a request. Do not render a textarea for template fields with `type === 'signature'`; render `ClinicalSignatureInput` for `bcba_supervisor_signature` and pass the controlled value.

Extend `collectSupervisionResponses` with a third argument and assign the structured signature before required-field validation:

```ts
responses.bcba_supervisor_signature = signature;
const hasSignature = signature.value.trim().length > 0;
if (field.key === 'bcba_supervisor_signature' && fieldRequiresResponse(field, responses) && !hasSignature) {
  errors[field.key] = 'BCBA Supervisor Signature is required.';
}
```

Render a read-only “Completed BT ABA Session Note” section before the supervision form. Iterate the BT template snapshot sections and fields, read values by field key, and format arrays with comma separators, booleans as Yes/No, strings directly, and objects as a non-editable JSON summary only when no known formatter applies. Do not render the BT signature value. Show only its method and signed timestamp.

Disable submission when `activeSupervisionRequest.canComplete` is false. Render: “Only the assigned BCBA can complete and sign this supervision note.” Keep Cancel available. Change the submit label to “Sign and Complete Supervision Note.”

- [ ] **Step 6: Run focused signature, Dashboard, and BT closeout tests**

```powershell
npx vitest run src/components/session-notes/__tests__/ClinicalSignatureInput.test.tsx src/components/session-notes/__tests__/SignatureInput.test.tsx src/pages/__tests__/Dashboard.noFallback.test.tsx src/lib/__tests__/supervision-session-notes.test.ts
```

Expected: all tests PASS.

- [ ] **Step 7: Run lint and typecheck for integrated frontend proof**

```powershell
npm run lint
npm run typecheck
```

Expected: both commands exit 0.

- [ ] **Step 8: Commit Task 3**

```powershell
git add src/components/session-notes/ClinicalSignatureInput.tsx src/components/session-notes/SignatureInput.tsx src/components/session-notes/__tests__/ClinicalSignatureInput.test.tsx src/pages/Dashboard.tsx src/pages/__tests__ src/lib/supervision-session-notes.ts
git commit -m "feat: add BCBA review and signature dashboard"
```

---

### Task 4: Critical-Lane Verification, Documentation, And PR Readiness

**Files:**
- Update tracking: Linear `WIN-222`
- No production behavior changes unless a failing required check identifies an in-scope defect.

**Interfaces:**
- Consumes: all prior task commits
- Produces: verification card, PR-hygiene verdict, review-ready branch, hosted migration application after human PR approval/merge policy permits it

- [ ] **Step 1: Run the full required local verification matrix**

```powershell
npm run ci:check-focused
npm run lint
npm run typecheck
npm run test:ci
npm run validate:tenant
npm run build
npm run test:routes:tier0
npm run ci:playwright
npm run verify:local
```

Expected: every locally meaningful command exits 0. Record any explicit secret/protected-system skip separately; do not report skipped checks as passing.

- [ ] **Step 2: Run verify-change**

Produce the required card with:

```text
classification: high-risk human-reviewed
lane: critical
required checks: policy, lint, typecheck, test:ci, tenant, build, tier0, auth/session Playwright, verify:local
executed checks: exact commands and exit codes
blocked checks: exact reason and environment requirement
result: pass or fail
residual risk: hosted RLS behavior and deterministic production backfill until migration apply
```

- [ ] **Step 3: Obtain independent specialist reviews**

Dispatch:

- `code-review-engineer` for full diff correctness and regression risk;
- `security-engineer` for exact-BCBA auth, tenant boundaries, signature attestation, and no PHI spillover;
- `supabase-reviewer` for migration replay, grants, RLS, security-definer search paths, and backfill;
- `test-engineer` for verification coverage and negative cases.

Resolve every Critical or Important finding and rerun covering tests before re-review.

- [ ] **Step 4: Run pr-hygiene**

Require:

```text
pr-ready: yes
branch: codex/win-222-bcba-supervision-review
issue: WIN-222
protected paths: supabase/migrations/**
human review required: yes
verification evidence: linked commands and outcomes
residual risk: hosted apply and deployed role-path smoke
```

- [ ] **Step 5: Push and create the human-review PR**

```powershell
git push -u origin codex/win-222-bcba-supervision-review
$body = @'
## Summary
- route completed BT notes to a deterministic assigned BCBA
- expose an authorized read-only BT review packet and separate supervision form
- require an atomic BCBA signature attestation

## Verification
- critical-lane commands and outcomes are listed in the verification card

## Risk
- protected migration/RLS/RPC change; human review and hosted post-apply proof required

Linear: WIN-222
'@
gh pr create --base main --head codex/win-222-bcba-supervision-review --title "WIN-222 Route completed BT notes to assigned BCBA" --body $body
```

The PR body must summarize the two-note flow, resolver order, RLS/RPC boundary, BCBA attestation, tests, migration risk, and `Closes WIN-222` only when Linear/GitHub integration policy supports that syntax.

- [ ] **Step 6: Close live CI and review blockers**

Inspect required checks and unresolved review threads. Fix only in-scope defects, rerun the minimum covering local proof, push focused commits, and wait with bounded polling. Do not merge while a required approval or check is missing.

- [ ] **Step 7: Apply and verify the authorized hosted migration**

After the migration is approved for production and the merge/deployment sequence is confirmed, use the Supabase plugin `apply_migration` with the exact reviewed SQL and migration name `route_bt_notes_to_assigned_bcba`.

Verify with aggregate/synthetic evidence only:

```sql
select status, assigned_admin_user_id is null as unassigned, count(*)
from public.supervision_session_note_requests
group by status, assigned_admin_user_id is null;
```

Confirm deterministic existing pending requests are assigned, ambiguous requests remain unassigned, migration ledger contains the new version, RLS policies match the reviewed SQL, and the deployed app loads the assigned BCBA queue without exposing another BCBA’s request.

- [ ] **Step 8: Update WIN-222 and commit any final documentation-only clarification**

Comment with PR, verification card, migration ledger proof, deployed smoke result, and residual risks. Mark Done only after the deployed workflow audit proves every objective requirement.

---

## Plan Self-Review Results

- Spec coverage: assignment, ambiguity fallback, non-blocking BT closeout, assigned-only completion, admin view-only behavior, immutable BT packet, separate supervision note, BCBA attestation, UI, backfill, and rollout proof each map to a task.
- Placeholder scan: no deferred implementation markers or unspecified test steps remain.
- Type consistency: SQL packet columns map one-to-one to Task 2 row fields; `ClinicalSignatureValue` is shared by Tasks 2 and 3; the completion RPC signature remains unchanged while the structured signature travels inside `p_responses`.
- Scope check: one coherent vertical slice; staffing/reassignment UI and general role refactors remain excluded.

## Implementation Status (2026-07-17)

- Implemented through commit `848f7bdd` on `codex/win-222-bcba-supervision-review`.
- Focused workflow verification: 4 files, 27 tests passed; lint, typecheck, tenant validation, policy checks, and production build passed.
- Independent security, Supabase, architecture, and whole-branch code reviews approved the final head after protected-path fixes.
- Full `test:ci` remains non-green because two unchanged failures reproduce on `main`: the synthetic BCBA workflow-env contract and Node's Blob test compatibility. Browser/auth gates remain blocked locally by test credentials; hosted CI is the next authoritative gate.
- Hosted migration apply and aggregate role/queue smoke remain pending until PR review and merge sequencing are complete.
