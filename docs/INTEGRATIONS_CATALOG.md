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
| Playwright | E2E smoke tests | `npm run playwright:*` |
| Cypress | UI regression tests | `npm run test:e2e` |
| Lighthouse | Performance/a11y audits | `audits/lighthouse/*` |

## Planned / TBD
- EHR integrations (TBD)
- Billing system integrations (TBD)
- SSO beyond current auth stack (TBD)
