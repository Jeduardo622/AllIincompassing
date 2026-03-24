# Integrations Catalog

## Active integrations
| System | Purpose | Interface | Owner |
| --- | --- | --- | --- |
| Supabase | Auth, database, edge functions | Supabase client + RPC | Platform |
| Netlify | Hosting and serverless functions | Netlify functions | Platform |
| Slack | Alerting notifications | Webhook via `alert:slack` | Platform |

## Internal tooling
| Tooling | Purpose | Interface |
| --- | --- | --- |
| Playwright | E2E smoke tests | `npm run playwright:preflight`, `npm run ci:playwright` |
| Cypress | UI regression tests | `npm run test:e2e` |
| Lighthouse | Performance/a11y audits | `audits/lighthouse/*` |

## Planned / TBD
| Planned integration | Owner | Tracking hook | Notes |
| --- | --- | --- | --- |
| EHR integrations | Platform (TBD assignee) | Linear: create linked issue before implementation | Planning only; no implementation commitment in this catalog. |
| Billing system integrations | Platform + Ops (TBD assignee) | Linear: create linked issue before implementation | Planning only; no implementation commitment in this catalog. |
| SSO beyond current auth stack | Platform/Auth (TBD assignee) | Linear: create linked issue before implementation | Planning only; no implementation commitment in this catalog. |
