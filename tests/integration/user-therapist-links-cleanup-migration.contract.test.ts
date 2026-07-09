// @vitest-environment node
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const MIGRATION_PATH = path.join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260709170000_quarantine_stale_user_therapist_links.sql'
);

const readMigration = () => fs.readFileSync(MIGRATION_PATH, 'utf8').replace(/\r\n/g, '\n');

const QUARANTINE_BATCH = '20260709170000_quarantine_stale_user_therapist_links';
const SUPPORTED_ROLES = [
  'therapist',
  'bt',
  'midtier',
  'admin_schedule',
  'admin',
  'bcba',
  'super_admin',
  'org_admin',
  'org_super_admin',
] as const;

type LinkRow = {
  id: string;
  userId: string;
  therapistId: string;
  createdAt: string;
};

type TherapistRow = {
  id: string;
  organizationId: string | null;
  status?: string | null;
  deletedAt?: string | null;
};

type UserRoleRow = {
  userId: string;
  role: string;
  isActive?: boolean | null;
  expiresAt?: string | null;
};

type QuarantineRow = {
  quarantineBatch: string;
  linkId: string;
  reason: string;
  userOrganizationId: string | null;
  therapistOrganizationId: string | null;
  therapistStatus: string | null;
  therapistDeletedAt: string | null;
  hadSupportedActiveRole: boolean;
};

type CleanupState = {
  links: LinkRow[];
  therapists: TherapistRow[];
  userOrganizations: Map<string, string | null>;
  userRoles: UserRoleRow[];
  quarantine: QuarantineRow[];
};

const now = new Date('2026-07-09T00:00:00.000Z');

const hasSupportedActiveRole = (roles: UserRoleRow[], userId: string) =>
  roles.some((role) => {
    const expiresAt = role.expiresAt ? new Date(role.expiresAt) : null;
    return (
      role.userId === userId &&
      (role.isActive ?? true) &&
      (!expiresAt || expiresAt > now) &&
      SUPPORTED_ROLES.includes(role.role as (typeof SUPPORTED_ROLES)[number])
    );
  });

const applyCleanupModel = (state: CleanupState) => {
  const evaluated = state.links.map((link) => {
    const therapist = state.therapists.find((candidate) => candidate.id === link.therapistId);
    const userOrganizationId = state.userOrganizations.get(link.userId) ?? null;
    const therapistOrganizationId = therapist?.organizationId ?? null;
    const therapistStatus = therapist?.status ?? null;
    const therapistDeletedAt = therapist?.deletedAt ?? null;
    const hadSupportedActiveRole = hasSupportedActiveRole(state.userRoles, link.userId);
    const isStale =
      userOrganizationId === null ||
      therapistOrganizationId === null ||
      userOrganizationId !== therapistOrganizationId ||
      (therapistStatus ?? 'active').toLowerCase() !== 'active' ||
      therapistDeletedAt !== null ||
      !hadSupportedActiveRole;
    const reason = [
      userOrganizationId === null ? 'missing_user_organization' : null,
      therapistOrganizationId === null ? 'missing_therapist' : null,
      userOrganizationId !== null && therapistOrganizationId !== null && userOrganizationId !== therapistOrganizationId
        ? 'organization_mismatch'
        : null,
      (therapistStatus ?? 'active').toLowerCase() !== 'active' ? 'inactive_therapist' : null,
      therapistDeletedAt !== null ? 'deleted_therapist' : null,
      !hadSupportedActiveRole ? 'missing_supported_active_role' : null,
    ]
      .filter(Boolean)
      .join(';');

    return {
      link,
      isStale,
      reason,
      userOrganizationId,
      therapistOrganizationId,
      therapistStatus,
      therapistDeletedAt,
      hadSupportedActiveRole,
    };
  });

  const newlyQuarantined = new Set<string>();

  for (const stale of evaluated.filter((candidate) => candidate.isStale)) {
    const alreadyQuarantined = state.quarantine.some(
      (row) => row.quarantineBatch === QUARANTINE_BATCH && row.linkId === stale.link.id
    );

    if (!alreadyQuarantined) {
      state.quarantine.push({
        quarantineBatch: QUARANTINE_BATCH,
        linkId: stale.link.id,
        reason: stale.reason,
        userOrganizationId: stale.userOrganizationId,
        therapistOrganizationId: stale.therapistOrganizationId,
        therapistStatus: stale.therapistStatus,
        therapistDeletedAt: stale.therapistDeletedAt,
        hadSupportedActiveRole: stale.hadSupportedActiveRole,
      });
      newlyQuarantined.add(stale.link.id);
    }
  }

  const staleByLinkId = new Map(evaluated.map((candidate) => [candidate.link.id, candidate.isStale]));
  const deleteCandidates = new Set([
    ...newlyQuarantined,
    ...state.quarantine
      .filter((row) => row.quarantineBatch === QUARANTINE_BATCH && staleByLinkId.get(row.linkId) === true)
      .map((row) => row.linkId),
  ]);

  state.links = state.links.filter((link) => !deleteCandidates.has(link.id));
};

describe('stale user therapist link cleanup migration contract', () => {
  it('quarantines matching links before deleting them from the live table', () => {
    const sql = readMigration();

    expect(sql).toContain('create table if not exists public.user_therapist_links_quarantine');
    expect(sql).toContain('with stale_links as (');
    expect(sql).toContain('or not evaluated.had_supported_active_role as is_stale');
    expect(sql).toContain('), quarantined as (');
    expect(sql).toContain('insert into public.user_therapist_links_quarantine');
    expect(sql).toContain('from stale_links\n  where is_stale');
    expect(sql).toContain('), quarantined_links as (');
    expect(sql).toContain("where q.quarantine_batch = '20260709170000_quarantine_stale_user_therapist_links'\n    and sl.is_stale");
    expect(sql).toContain('delete from public.user_therapist_links utl\nusing quarantined_links q\nwhere utl.id = q.link_id;');
    expect(sql.indexOf('insert into public.user_therapist_links_quarantine')).toBeLessThan(
      sql.indexOf('delete from public.user_therapist_links utl')
    );
    expect(sql).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('uses the supported admin and provider link semantics in the stale predicate', () => {
    const sql = readMigration();

    expect(sql).toContain('app.resolve_user_organization_id(utl.user_id) as user_organization_id');
    for (const role of [
      'therapist',
      'bt',
      'midtier',
      'admin_schedule',
      'admin',
      'bcba',
      'super_admin',
      'org_admin',
      'org_super_admin',
    ]) {
      expect(sql).toContain(`'${role}'`);
    }
    expect(sql).toContain('user_organization_id is null');
    expect(sql).toContain('therapist_organization_id is null');
    expect(sql).toContain('user_organization_id is distinct from therapist_organization_id');
    expect(sql).toContain("lower(coalesce(therapist_status, 'active')) <> 'active'");
    expect(sql).toContain('therapist_deleted_at is not null');
    expect(sql).toContain('not had_supported_active_role');
    expect(sql).toContain('missing_user_organization');
    expect(sql).toContain('missing_supported_active_role');
    expect(sql).not.toContain('left join public.profiles');
  });

  it('keeps quarantine records service-role only', () => {
    const sql = readMigration();

    expect(sql).toContain('alter table public.user_therapist_links_quarantine enable row level security;');
    expect(sql).toContain('alter table public.user_therapist_links_quarantine force row level security;');
    expect(sql).toContain('drop policy if exists user_therapist_links_quarantine_service_role_select');
    expect(sql).toContain('create policy user_therapist_links_quarantine_service_role_select');
    expect(sql).toContain('on public.user_therapist_links_quarantine');
    expect(sql).toContain('for select');
    expect(sql).toContain('to service_role');
    expect(sql).toContain('using (true)');
    expect(sql).toContain('revoke all on table public.user_therapist_links_quarantine from public;');
    expect(sql).toContain('revoke all on table public.user_therapist_links_quarantine from anon;');
    expect(sql).toContain('revoke all on table public.user_therapist_links_quarantine from authenticated;');
    expect(sql).toContain('revoke all on table public.user_therapist_links_quarantine from service_role;');
    expect(sql).toContain('grant select on table public.user_therapist_links_quarantine to service_role;');
    expect(sql).not.toContain('grant select, insert');
    expect(sql).not.toContain('grant select, insert, delete');
    expect(sql).not.toContain('grant select on table public.user_therapist_links_quarantine to authenticated;');
    expect(sql).not.toContain('grant select on table public.user_therapist_links_quarantine to anon;');
  });

  it('keeps cleanup stable across reruns and only deletes links that still evaluate stale', () => {
    const state: CleanupState = {
      links: [
        { id: 'valid-link', userId: 'valid-user', therapistId: 'therapist-a', createdAt: '2026-07-01T00:00:00Z' },
        { id: 'missing-org-link', userId: 'missing-org-user', therapistId: 'therapist-a', createdAt: '2026-07-01T00:00:00Z' },
        { id: 'cross-org-link', userId: 'cross-org-user', therapistId: 'therapist-a', createdAt: '2026-07-01T00:00:00Z' },
        { id: 'inactive-therapist-link', userId: 'valid-user', therapistId: 'therapist-inactive', createdAt: '2026-07-01T00:00:00Z' },
        { id: 'missing-role-link', userId: 'missing-role-user', therapistId: 'therapist-a', createdAt: '2026-07-01T00:00:00Z' },
      ],
      therapists: [
        { id: 'therapist-a', organizationId: 'org-a', status: 'active', deletedAt: null },
        { id: 'therapist-inactive', organizationId: 'org-a', status: 'inactive', deletedAt: null },
      ],
      userOrganizations: new Map([
        ['valid-user', 'org-a'],
        ['missing-org-user', null],
        ['cross-org-user', 'org-b'],
        ['missing-role-user', 'org-a'],
      ]),
      userRoles: [
        { userId: 'valid-user', role: 'therapist' },
        { userId: 'missing-org-user', role: 'bt' },
        { userId: 'cross-org-user', role: 'admin' },
        { userId: 'missing-role-user', role: 'client' },
      ],
      quarantine: [],
    };

    applyCleanupModel(state);
    expect(state.links.map((link) => link.id)).toEqual(['valid-link']);
    expect(state.quarantine.map((row) => row.linkId).sort()).toEqual([
      'cross-org-link',
      'inactive-therapist-link',
      'missing-org-link',
      'missing-role-link',
    ]);
    expect(state.quarantine.find((row) => row.linkId === 'missing-org-link')?.reason).toBe('missing_user_organization');

    applyCleanupModel(state);
    expect(state.links.map((link) => link.id)).toEqual(['valid-link']);
    expect(state.quarantine).toHaveLength(4);

    state.links.push({
      id: 'missing-org-link',
      userId: 'missing-org-user',
      therapistId: 'therapist-a',
      createdAt: '2026-07-01T00:00:00Z',
    });
    state.userOrganizations.set('missing-org-user', 'org-a');

    applyCleanupModel(state);
    expect(state.links.map((link) => link.id).sort()).toEqual(['missing-org-link', 'valid-link']);
    expect(state.quarantine).toHaveLength(4);

    state.links.push({
      id: 'new-stale-link',
      userId: 'new-stale-user',
      therapistId: 'therapist-a',
      createdAt: '2026-07-01T00:00:00Z',
    });
    state.userOrganizations.set('new-stale-user', null);
    state.userRoles.push({ userId: 'new-stale-user', role: 'bt' });

    applyCleanupModel(state);
    expect(state.links.map((link) => link.id).sort()).toEqual(['missing-org-link', 'valid-link']);
    expect(state.quarantine.map((row) => row.linkId)).toContain('new-stale-link');
    expect(state.quarantine).toHaveLength(5);
  });
});
