import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

const ROOT = process.cwd();
const APP_PATH = path.join(ROOT, 'src', 'App.tsx');
const AUDIT_PATH = path.join(ROOT, 'scripts', 'route-audit.ts');

const normalizeRoles = (roles: string[]): string[] =>
  [...new Set(roles.map((role) => role.trim()).filter((role) => role.length > 0))].sort();

const parseRoleList = (value: string): string[] => {
  const matches = value.match(/'([^']+)'/g) ?? [];
  return normalizeRoles(matches.map((entry) => entry.replace(/'/g, '')));
};

const parseAuditRouteRoles = (source: string): Map<string, string[]> => {
  const routeMap = new Map<string, string[]>();
  const routeRegex = /\{\s*path:\s*'([^']+)'.*?roles:\s*\[([^\]]+)\]/gs;
  let match = routeRegex.exec(source);

  while (match) {
    routeMap.set(match[1], parseRoleList(match[2]));
    match = routeRegex.exec(source);
  }

  return routeMap;
};

const parseAppRouteRoles = (source: string): Map<string, string[]> => {
  const routeMap = new Map<string, string[]>();
  routeMap.set('/login', ['public']);
  routeMap.set('/signup', ['public']);
  routeMap.set('/auth/recovery', ['public']);
  routeMap.set('/unauthorized', ['public']);
  routeMap.set('/', normalizeRoles(['client', 'bt', 'therapist', 'midtier', 'admin_schedule', 'admin', 'bcba', 'super_admin']));

  const routeEntries: Array<{ readonly index: number; readonly path: string }> = [];
  const routePathRegex = /<Route\b[\s\S]*?path="([^"]+)"/g;
  let routeMatch = routePathRegex.exec(source);
  while (routeMatch) {
    routeEntries.push({ index: routeMatch.index, path: routeMatch[1] });
    routeMatch = routePathRegex.exec(source);
  }

  for (let index = 0; index < routeEntries.length; index += 1) {
    const entry = routeEntries[index];
    if (entry.path.startsWith('/')) {
      continue;
    }

    const snippetEnd = routeEntries[index + 1]?.index ?? source.length;
    const snippet = source.slice(entry.index, snippetEnd);
    if (snippet.includes('<Navigate ')) {
      continue;
    }

    const rolesMatch = snippet.match(/RoleGuard[\s\S]*?roles=\{\[([^\]]+)\]\}/);
    const roles = rolesMatch
      ? parseRoleList(rolesMatch[1])
      : normalizeRoles(['client', 'bt', 'therapist', 'midtier', 'admin_schedule', 'admin', 'bcba', 'super_admin']);

    routeMap.set(`/${entry.path.replace(/^\//, '')}`, roles);
  }

  return routeMap;
};

describe('route-audit role matrix parity', () => {
  it('matches route roles defined in App routing policy', () => {
    const appSource = readFileSync(APP_PATH, 'utf8');
    const auditSource = readFileSync(AUDIT_PATH, 'utf8');

    const appRoutes = parseAppRouteRoles(appSource);
    const auditRoutes = parseAuditRouteRoles(auditSource);

    for (const [routePath, appRoles] of appRoutes.entries()) {
      expect(auditRoutes.has(routePath), `route-audit is missing route ${routePath}`).toBe(true);
      expect(auditRoutes.get(routePath), `route role mismatch for ${routePath}`).toEqual(appRoles);
    }
  });
});
