import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { routeGuards } from '../../src/server/routes/guards';

const ROOT = process.cwd();
const APP_PATH = path.join(ROOT, 'src', 'App.tsx');

const normalizeRoles = (roles: readonly string[]): string[] => {
  return [...new Set(roles.map((role) => role.trim()).filter((role) => role.length > 0))].sort();
};

const parseRoleList = (value: string): string[] => {
  const matches = value.match(/'([^']+)'/g) ?? [];
  return normalizeRoles(matches.map((entry) => entry.replace(/'/g, '')));
};

const parseGuardedRoutesFromApp = (source: string): Map<string, string[]> => {
  const routeMap = new Map<string, string[]>();
  routeMap.set('/', normalizeRoles(['client', 'therapist', 'admin', 'super_admin']));

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
      : normalizeRoles(['client', 'therapist', 'admin', 'super_admin']);

    routeMap.set(`/${entry.path.replace(/^\//, '')}`, roles);
  }

  return routeMap;
};

describe('route guard parity against App routes', () => {
  it('keeps guarded route paths and role matrices in sync', () => {
    const appSource = readFileSync(APP_PATH, 'utf8');
    const appGuardedRoutes = parseGuardedRoutesFromApp(appSource);
    const guardMap = new Map(routeGuards.map((guard) => [guard.path, normalizeRoles(guard.allowedRoles)]));

    expect([...guardMap.keys()].sort()).toEqual([...appGuardedRoutes.keys()].sort());

    for (const [pathKey, appRoles] of appGuardedRoutes.entries()) {
      expect(guardMap.get(pathKey), `role mismatch for ${pathKey}`).toEqual(appRoles);
    }
  });
});
