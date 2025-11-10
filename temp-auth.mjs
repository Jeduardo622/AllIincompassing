import { createClient } from '@supabase/supabase-js';
const url = 'https://wnnjeqheqxxyrgsjmygy.supabase.co';
const anon = 'sb_publishable_1uBddPes40Ge067ANS3NkQ_bkz5ogb7';
const supabase = createClient(url, anon);
const email = 'playwright.superadmin+20251109@example.com';
const password = 'Sup3rAdmin!2025';
const auth = await supabase.auth.signInWithPassword({ email, password });
console.log(JSON.stringify(auth, null, 2));
