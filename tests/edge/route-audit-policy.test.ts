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
  routeMap.set('/unauthorized', ['public']);
  routeMap.set('/', normalizeRoles(['client', 'therapist', 'admin', 'super_admin']));

  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const routeMatch = lines[index].match(/<Route\s+path="([^"]+)"/);
    if (!routeMatch) {
      continue;
    }

    const rawPath = routeMatch[1];
    if (rawPath.startsWith('/')) {
      continue;
    }

    let nextRouteIndex = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (/<Route\b/.test(lines[cursor])) {
        nextRouteIndex = cursor;
        break;
      }
    }

    const snippet = lines.slice(index, nextRouteIndex).join('\n');
    if (snippet.includes('<Navigate ')) {
      continue;
    }

    const rolesMatch = snippet.match(/RoleGuard\s+roles=\{\[([^\]]+)\]\}/);
    const roles = rolesMatch
      ? parseRoleList(rolesMatch[1])
      : normalizeRoles(['client', 'therapist', 'admin', 'super_admin']);

    routeMap.set(`/${rawPath.replace(/^\//, '')}`, roles);
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
