import { afterEach, describe, expect, it, vi } from 'vitest';

vi.unmock('../supabase');

let supabaseMock: ReturnType<typeof createSupabaseMock>;

vi.mock('../supabaseClient', () => ({
  get supabase() {
    return supabaseMock;
  },
}));

const createQueryBuilder = () => {
  const result = { data: [{ count: 0 }], error: null };
  const builder: any = { promise: Promise.resolve(result) };
  builder.select = vi.fn().mockImplementation(() => {
    builder.promise = Promise.resolve(result);
    return builder;
  });
  builder.limit = vi.fn().mockImplementation(() => Promise.resolve(result));
  builder.order = vi.fn().mockReturnValue(builder);
  builder.eq = vi.fn().mockReturnValue(builder);
  builder.is = vi.fn().mockReturnValue(builder);
  builder.in = vi.fn().mockReturnValue(builder);
  builder.gte = vi.fn().mockReturnValue(builder);
  builder.lte = vi.fn().mockReturnValue(builder);
  builder.then = (...args: unknown[]) => builder.promise.then(...args);
  builder.catch = (...args: unknown[]) => builder.promise.catch(...args);
  builder.finally = (...args: unknown[]) => builder.promise.finally(...args);
  return builder;
};

const createSupabaseMock = () => {
  const authGetSession = vi.fn().mockResolvedValue({ data: { session: null }, error: null });
  const from = vi.fn().mockImplementation(() => createQueryBuilder());
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null });

  return {
    auth: { getSession: authGetSession },
    from,
    rpc,
  };
};

const setupModule = async () => {
  supabaseMock = createSupabaseMock();
  vi.resetModules();
  const mod = await import('../supabase');
  return { mod, supabaseMock };
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

describe('supabase connection diagnostics guard', () => {
  it('skips diagnostics when running under test harness', async () => {
    vi.stubEnv('VITEST', 'true');
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const { mod, supabaseMock } = await setupModule();

    expect(mod.shouldRunConnectionDiagnostics()).toBe(false);
    expect(supabaseMock.auth.getSession).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalledWith(
      expect.stringContaining('Running connection diagnostics'),
      expect.anything()
    );
  });

  it('does not run diagnostics in production builds', async () => {
    vi.stubEnv('DEV', 'false');
    vi.stubEnv('VITEST', 'false');
    vi.stubEnv('VITE_ENABLE_CONNECTION_DIAGNOSTICS', 'false');
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const { mod, supabaseMock } = await setupModule();

    expect(mod.shouldRunConnectionDiagnostics()).toBe(false);
    expect(supabaseMock.auth.getSession).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalledWith(
      '[supabase] Running connection diagnostics',
      expect.anything()
    );
  });

  it('runs diagnostics automatically in development', async () => {
    vi.stubEnv('DEV', 'true');
    vi.stubEnv('VITEST', 'false');
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const { mod, supabaseMock } = await setupModule();

    expect(mod.shouldRunConnectionDiagnostics()).toBe(true);
    expect(supabaseMock.auth.getSession).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith('[supabase] Running connection diagnostics', {
      scope: 'supabase.connectionDiagnostics',
    });
  });

  it('respects explicit diagnostics flag overrides', async () => {
    vi.stubEnv('DEV', 'false');
    vi.stubEnv('VITEST', 'false');
    vi.stubEnv('VITE_ENABLE_CONNECTION_DIAGNOSTICS', 'true');
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const { mod, supabaseMock } = await setupModule();

    expect(mod.shouldRunConnectionDiagnostics()).toBe(true);
    expect(supabaseMock.auth.getSession).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith('[supabase] Running connection diagnostics', {
      scope: 'supabase.connectionDiagnostics',
    });
  });

  it('disables diagnostics when flag is explicitly false', async () => {
    vi.stubEnv('DEV', 'true');
    vi.stubEnv('VITEST', 'false');
    vi.stubEnv('VITE_ENABLE_CONNECTION_DIAGNOSTICS', 'false');
    const consoleSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    const { mod, supabaseMock } = await setupModule();

    expect(mod.shouldRunConnectionDiagnostics()).toBe(false);
    expect(supabaseMock.auth.getSession).not.toHaveBeenCalled();
    expect(consoleSpy).not.toHaveBeenCalledWith(
      '[supabase] Running connection diagnostics',
      expect.anything()
    );
  });
});
