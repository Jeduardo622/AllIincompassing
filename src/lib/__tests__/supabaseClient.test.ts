import { describe, expect, it } from 'vitest';
import { clearSupabaseAuthStorage } from '../supabaseClient';

describe('clearSupabaseAuthStorage', () => {
  it('removes Supabase auth tokens from session/local storage', () => {
    window.sessionStorage.setItem('sb-project-auth-token', 'token-a');
    window.localStorage.setItem('sb-project-auth-token', 'token-b');
    window.sessionStorage.setItem('unrelated-key', 'keep-me');

    clearSupabaseAuthStorage();

    expect(window.sessionStorage.getItem('sb-project-auth-token')).toBeNull();
    expect(window.localStorage.getItem('sb-project-auth-token')).toBeNull();
    expect(window.sessionStorage.getItem('unrelated-key')).toBe('keep-me');
  });
});
