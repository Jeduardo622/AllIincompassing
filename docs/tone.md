# Tone Guide – Therapist Onboarding Remediation

## Audience Segments
- **Internal engineering & platform teams**: focus on technical precision, actionable next steps.
- **Customer success & operations**: emphasize reassurance, timeline, and user impact mitigation.
- **Leadership updates**: high-level status, risk framing, mitigation confidence.

## Tone Principles
- **Transparent**: Ack the staging regression and outline concrete fixes without blame.
- **Solution-forward**: Lead with remediation status, blockers, and the next validation step.
- **Reassuring**: Reinforce that document uploads remain secure and monitored.
- **Data-backed**: Reference artifacts (runtime-config output, Playwright logs, storage listings) when communicating progress.

## Messaging Patterns
- Start with current state (`Detected staging runtime-config gap; fix deploying now`).
- Follow with immediate action + owner (`Platform releasing runtime-config patch in 15m`).
- Close with verification plan (`Eng/QA rerunning onboarding + automation once patch live`).

## Escalation Tone
- PagerDuty / incident channels: concise, severity-tagged, include MCP evidence links.
- Stakeholder emails/slack: markdown bullets, attach screenshots from MCP browser/Playwright runs.
- Post-mortem: collaborative tone, highlight preventive actions (runtime-config contract test).

## MCP Evidence Callouts
When referencing MCP tooling in updates, name the tool + artifact:
- “Supabase MCP → `/api/runtime-config` response (includes `defaultOrganizationId`).”
- “Playwright MCP smoke run `artifacts/playwright/onboarding.png`.”
- “Lighthouse MCP mobile score 84 after UI fix.”
