# Connector Health Readiness

`npm run ci:connector-health` writes a read-only connector readiness artifact:

- `artifacts/latest/readiness/connector-health-readiness.json`
- `artifacts/latest/readiness/connector-health-readiness.md`

The script checks only read-only endpoints or commands and never writes token values.

## Status values

- `live`: read-only validation succeeded
- `unauthenticated`: a connector or API returned an auth failure
- `missing`: credentials or local tool configuration were not present
- `intentionally_disabled`: disabled through an explicit `CONNECTOR_HEALTH_*_DISABLED=true` variable
- `not_validated`: a read-only check could not complete for another reason

## Connector inputs

| Connector | Read-only check | Required input |
|---|---|---|
| GitHub | `gh auth status` plus `gh repo view --json nameWithOwner` | local `gh` auth |
| Supabase | project lookup through Supabase Management API | `SUPABASE_ACCESS_TOKEN`, `SUPABASE_PROJECT_REF` |
| Netlify | site listing through Netlify API | `NETLIFY_AUTH_TOKEN` |
| Linear | GraphQL `viewer` query | `LINEAR_API_KEY` |
| Postman | `/me` lookup | `POSTMAN_API_KEY` |

## Intentional disable switches

Use these when a connector should be absent in a given environment:

- `CONNECTOR_HEALTH_GITHUB_DISABLED=true`
- `CONNECTOR_HEALTH_SUPABASE_DISABLED=true`
- `CONNECTOR_HEALTH_NETLIFY_DISABLED=true`
- `CONNECTOR_HEALTH_LINEAR_DISABLED=true`
- `CONNECTOR_HEALTH_POSTMAN_DISABLED=true`

This script is intended for operator readiness and troubleshooting. It does not replace the app-level plugin/MCP auth state inside Cursor or Codex.
