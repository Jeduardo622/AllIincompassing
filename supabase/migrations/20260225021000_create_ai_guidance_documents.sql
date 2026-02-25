begin;

create table if not exists public.ai_guidance_documents (
  id uuid primary key default gen_random_uuid(),
  guidance_key text not null unique,
  title text not null,
  source_type text not null check (source_type in ('book', 'manual', 'policy', 'other')),
  source_reference text,
  guidance_text text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default timezone('utc', now()),
  updated_at timestamptz not null default timezone('utc', now())
);

alter table public.ai_guidance_documents enable row level security;

insert into public.ai_guidance_documents (
  guidance_key,
  title,
  source_type,
  source_reference,
  guidance_text,
  is_active
)
values (
  'white_bible_core',
  'White Bible ABA Guidance',
  'book',
  'Applied Behavior Analysis (Cooper, Heron, Heward) - curated operational guidance',
  $$- Keep goals socially significant and directly tied to prioritized client outcomes.
- Write goals as observable behavior change targets, not personality traits or vague skills.
- Use operational definitions so two clinicians can score behavior consistently.
- Tie interventions and goals to function-based understanding from the FBA context.
- Include baseline context when available and avoid overstating certainty when data is missing.
- Prefer explicit measurement methods (frequency, duration, latency, percentage, or interval recording).
- Include clear mastery criteria (criterion level + context + consistency requirement).
- Keep wording implementation-ready for therapists and caregivers in routine settings.
- Avoid duplicative goals by ensuring each goal targets a distinct behavior or condition.
- Favor conservative, realistic targets that can be progressed across sessions.$$,
  true
)
on conflict (guidance_key)
do update set
  title = excluded.title,
  source_type = excluded.source_type,
  source_reference = excluded.source_reference,
  guidance_text = excluded.guidance_text,
  is_active = excluded.is_active,
  updated_at = timezone('utc', now());

commit;
