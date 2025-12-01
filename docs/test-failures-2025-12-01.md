# Test Failures – 2025-12-01

Run context:

```text
cd C:\Users\test\Desktop\AllIincompassing && npm test -- --runInBand --watch=false
```

Vitest summary (`terminals/4.txt`):

| Suite | Test | Failure | Notes |
| --- | --- | --- | --- |
| `src/server/__tests__/bookHandler.integration.test.ts` | `calls edge functions with the bearer token from the request` | `vi.mock` hoisting error while mocking modules | Needs module factory refactor |
| | `rejects unauthorized requests before invoking edge functions` | Same `vi.mock` hoisting error | ^
| | `bootstraps Supabase runtime config for server handlers` | Supabase runtime config missing `supabaseUrl` | Possibly missing env setup |
| `src/pages/__tests__/Schedule.event.test.tsx` | `opens modal based on pendingSchedule in localStorage` | `expect(element).toBeInTheDocument()` failed | DOM setup/localStorage seeding needed |
| `src/components/settings/__tests__/AdminSettings.test.tsx` | `adds organization metadata when creating an admin user` | spy never called | Likely new admin RPC path |

See `terminals/4.txt` for full console output. Keep this log up to date until failures are resolved.

