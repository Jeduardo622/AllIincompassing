---
name: responsive-ui-observer
description: Deterministic desktop and mobile layout observation for visible UI changes using local loopback Playwright only.
---

# Responsive UI Observer

Use this skill for visible UI changes that affect rendered routes, shared styling, layout, or route-level interaction surfaces.

## Mission

Make deterministic responsive observation mandatory for visible UI changes without widening authority. This is local-only engineering evidence. It is not a functional browser-auth replacement, not a hosted probe, and not an approval surface.

## Hard Boundaries

- Accept only explicit `--base-url=http://127.0.0.1:<port>` or `http://localhost:<port>`.
- Accept only one or more explicit `--route=/relative/path` arguments.
- Do not read `.env*` files.
- Do not import the shared Playwright env loader.
- Do not reuse browser sessions, cookies, storage state, HAR, trace, or video.
- Persist only layout-redacted screenshots: text, carets, media, SVG/canvas content, and background imagery must be hidden before capture while measured geometry remains unchanged.
- Use the full SHA-256 route digest in every artifact filename; never truncate route identity.
- Treat artifact writes as one run: remove the current partial pair and every earlier pair from that invocation if any write or observation throws.
- Do not capture DOM text, request or response bodies, query strings, emails, tokens, UUIDs, or credentials in artifacts.
- Abort external-origin requests and methods other than `GET`, `HEAD`, or `OPTIONS`. A built-in scenario may fulfill a `POST` only when its fixed parser proves the body is a read operation; every other `POST` must fail closed.
- `--scenario=schedule-overlap` is valid only on exactly one `/schedule` route.
- `--scenario=clients-directory` is valid only on exactly one `/clients` route. It seeds the fixed PHI-free localhost admin-schedule stub and fulfills only the exact runtime-config, unread-message, client-list, payroll-day, and payroll-review read shapes required by that route.
- Built-in scenarios may load only the loopback route shell/static assets and their enumerated same-origin in-memory responses. They must not contact an external host, accept caller-selected identities or fixture paths, or mutate the loopback server.
- Computer inspection is supplemental only. It is never gating or authoritative for pass/fail.

## Required Viewports

- desktop: `1440x900`
- mobile: `390x844`

## Required Command Shape

```bash
npm run test:ui:responsive -- --base-url=http://127.0.0.1:4173 --route=/example
```

Add one `--route` flag per affected route.

For the fixed schedule-overlap proof only:

```bash
npm run test:ui:responsive -- --base-url=http://127.0.0.1:4173 --route=/schedule --scenario=schedule-overlap
```

For the fixed Clients directory proof, start the local app with `VITE_DEV_DIAGNOSTICS=0` in the dev-server process, then run:

```bash
npm run test:ui:responsive -- --base-url=http://127.0.0.1:4173 --route=/clients --scenario=clients-directory
```

The scenario name is an enum, not a fixture path or caller-selected identity. It is rejected for every other route and does not replace auth/session browser gates. In scenario mode, overflow and clipped fixed-control checks remain document-wide while touch-target measurement is scoped to the exact overlap dialog named by the trigger's `aria-controls`, so unrelated background schedule controls do not change the dialog-state verdict.

## Required Evidence

For each route and viewport, the observer must write:

- layout-redacted screenshot under `artifacts/responsive-ui-observer`
- sanitized JSON evidence under `artifacts/responsive-ui-observer`
- screenshot hash
- evidence hash
- fixed scenario ID when a built-in synthetic scenario is active

## Failure Conditions

The observer must fail when any of the following occur:

- page error
- error-level console event
- failed same-origin request
- horizontal overflow
- clipped fixed or sticky controls
- undersized visible mobile touch targets
- blocked external-origin request
- blocked non-read request method

## Output Contract

Return a machine-safe JSON summary only:

- `ok`
- `baseUrl`
- `results[]`

Each result must include only:

- `routeId` (SHA-256 only; raw route text is never persisted or echoed)
- `viewportName`
- `result`
- `failureCodes`
- `screenshotPath`
- `evidencePath`

Every failed result must contain at least one canonical machine-safe `failureCodes` entry. Raw failure text is never returned.
