import { vi } from 'vitest';

type GlobalWithDeno = typeof globalThis & {
  Deno?: {
    env: {
      get: (key: string) => string;
    };
  };
};

export function stubDenoEnv(getter: (key: string) => string) {
  const globalObj = globalThis as GlobalWithDeno;
  const existing = globalObj.Deno;

  if (existing?.env && typeof existing.env.get === 'function') {
    vi.spyOn(existing.env, 'get').mockImplementation(getter);
    return;
  }

  vi.stubGlobal('Deno', {
    env: {
      get: getter,
    },
  });
}

