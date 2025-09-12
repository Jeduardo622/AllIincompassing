The following workflows should be limited to main/develop pushes or manual dispatch, and should not run on pull_request:

Targets:
- .github/workflows/auth-verification.yml  ("Authentication System Verification")
- .github/workflows/database-first-ci.yml  ("Database-First CI/CD Pipeline")
- (No "Supabase Preview" workflow found in this branch)

Edits to apply in each target file:

1) Remove pull_request trigger and keep push + workflow_dispatch only:
```yaml
on:
  push:
  workflow_dispatch:
```

2) Add a job-level guard to every job so they only run on main/develop pushes:
```yaml
jobs:
  <job_id>:
    if: ${{ github.event_name == 'push' && (github.ref == 'refs/heads/main' || github.ref == 'refs/heads/develop') }}
    # ... rest of the existing job config ...
```

Notes:
- Apply the "if:" line under every top-level job (each key under jobs:).
- Do not alter existing steps other than adding the guard.
- Minimal CI for PRs remains in ".github/workflows/ci.yml" and will continue to run.
