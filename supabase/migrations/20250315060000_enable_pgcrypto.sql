-- Ensure pgcrypto is available before any migrations rely on gen_salt/crypt
create extension if not exists pgcrypto with schema extensions;

