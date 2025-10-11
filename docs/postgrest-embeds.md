# PostgREST embed runbook

This project relies on Supabase/PostgREST for relational queries. The browser recently started issuing
`/rest/v1/clients?select=*,one_supervision_units(*),parent_consult_units(*)` calls, which PostgREST rejected with
`HTTP 400 PGRST200` because the `one_supervision_units` and `parent_consult_units` tokens are **not real relations** in the
`public` schema—they are scalar columns on the `clients` table. PostgREST only understands embeds that map to foreign-key
relationships or explicit join hints.

## Safe pattern for building select clauses

1. List the scalar columns you actually need.
2. Map any "virtual" relations (UI concepts) back to the real column names.
3. Append true embeds only when a foreign key exists (use `alias:table!fk(columns)` to disambiguate).

```ts
import { buildClientSelect } from '../lib/clients/select';

const select = buildClientSelect({
  include: [
    'one_supervision_units', // mapped to supervision_units column
    'parent_consult_units',  // mapped to parent_consult_units column
    'sessions:clients_sessions!inner(id,start_time)', // real embed
  ],
});
```

`buildClientSelect` filters out invalid relations so the resulting clause never includes tokens that would trigger a 400.

## Checklist when a 400 appears

- ✅ Confirm the table/column names via the generated `database.types.ts` or the Supabase UI.
- ✅ Ensure every embed token corresponds to an FK or provide an explicit join hint (`alias:table!fk(columns)`).
- ✅ Keep strings literal and stable—avoid runtime concatenation of relation names pulled from user input.
- ✅ Add a unit test that asserts the final select clause (see `src/lib/clients/__tests__/select.test.ts`).

## Example cURL validation

```bash
curl 'https://<project>.supabase.co/rest/v1/clients?select=id,full_name,one_to_one_units,supervision_units,parent_consult_units' \
  -H 'apikey: ****' \
  -H 'Authorization: Bearer ****'
```

This returns `200 OK` (possibly with an empty array if RLS hides rows) and proves that selecting scalar columns avoids the
400-response failure mode.
