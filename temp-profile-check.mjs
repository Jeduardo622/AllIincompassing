import { createClient } from '@supabase/supabase-js';
const url = 'https://wnnjeqheqxxyrgsjmygy.supabase.co';
const anon = 'sb_publishable_1uBddPes40Ge067ANS3NkQ_bkz5ogb7';
const supabase = createClient(url, anon, {
  auth: { persistSession: false },
  global: { headers: { apikey: anon } },
});
const email = 'playwright.superadmin+20251109@example.com';
const password = 'Sup3rAdmin!2025';
const auth = await supabase.auth.signInWithPassword({ email, password });
if (auth.error) {
  console.error('auth error', auth.error);
  process.exit(1);
}
console.log('session', auth.data.session?.access_token.slice(0, 20) + '...');
const profile = await supabase.from('profiles').select('*').eq('id', auth.data.user.id).single();
console.log('profile data', profile.data);
console.log('profile error', profile.error);
