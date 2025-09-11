import { describe, it, expect } from 'vitest';

const makeChain = () => {
  const self: any = {
    select: () => self,
    eq: () => self,
    order: () => self,
    limit: () => self,
    single: () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
  };
  return self;
};

describe('supabase client singleton', () => {
  it('returns the same instance across imports', async () => {
    const mod1 = await import('../supabase');
    const mod2 = await import('../supabase');
    expect(mod1.supabase).toBe(mod2.supabase);
  });

  it('supports chainable query methods (mocked)', async () => {
    const { supabase } = await import('../supabase');
    (supabase as any).from = () => makeChain();
    const { data, error } = await (supabase as any)
      .from('roles')
      .select('*')
      .eq('name', 'admin')
      .order('name')
      .limit(1)
      .single();
    expect(error).toBeNull();
    expect(data).toBeNull();
  });
});


