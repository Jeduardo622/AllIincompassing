# Dashboard Role Route Endpoint Matrix

## Purpose

This matrix defines intended dashboard behavior for all application roles and is the baseline for the remediation rollout.

## Roles

- `super_admin`
- `admin`
- `therapist`
- `client`

## Route Access Matrix

| Route | super_admin | admin | therapist | client | Notes |
| --- | --- | --- | --- | --- | --- |
| `/` | Allow | Allow | Redirect | Redirect | Staff dashboard route is admin-facing only. |
| `/family` | Deny | Deny | Deny | Allow (guardian only) | Requires `client` + guardian flag. |
| `/schedule` | Allow | Allow | Allow | Deny | Therapist and above. |
| `/monitoring` | Allow | Allow | Deny | Deny | Admin-focused operational dashboard. |
| `/super-admin/*` | Allow | Deny | Deny | Deny | Super-admin tools only. |

## Dashboard Endpoint Matrix

| Endpoint / Source | super_admin | admin | therapist | client | Enforced By |
| --- | --- | --- | --- | --- | --- |
| `get-dashboard-data` edge function | Allow | Allow | Deny | Deny | `RouteOptions.admin` middleware. |
| `/api/dashboard` netlify/server route | Allow | Allow | Deny | Deny | Proxy to edge authority with bearer token. |
| `get_dashboard_data` RPC direct call | Deny (direct) | Deny (direct) | Deny | Deny | Execute restricted; call via edge/API only. |

## Data Flow Matrix

| Surface | Primary Data Path | Fallback Path | Response Contract |
| --- | --- | --- | --- |
| Admin dashboard UI (`/`) | `supabase.functions.invoke('get-dashboard-data')` | `GET /api/dashboard` | `{ success: true, data: ... }` |
| Guardian dashboard UI (`/family`) | Guardian-specific hooks / RPCs | None | Role-specific payloads |
| Monitoring dashboard (`/monitoring`) | Monitoring hooks + edge/RPC calls | None | Monitoring-specific payloads |

## Non-goals

- This matrix does not redefine schedule, billing, or onboarding routes outside dashboard-related behavior.
- This matrix does not replace RLS policy docs; it complements them with route-level expectations.
