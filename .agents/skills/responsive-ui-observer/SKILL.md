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
- Do not capture DOM text, request or response bodies, query strings, emails, tokens, UUIDs, or credentials in artifacts.
- Abort external-origin requests and methods other than `GET`, `HEAD`, or `OPTIONS`.
- Computer inspection is supplemental only. It is never gating or authoritative for pass/fail.

## Required Viewports

- desktop: `1440x900`
- mobile: `390x844`

## Required Command Shape

```bash
npm run test:ui:responsive -- --base-url=http://127.0.0.1:4173 --route=/example
```

Add one `--route` flag per affected route.

## Required Evidence

For each route and viewport, the observer must write:

- layout-redacted screenshot under `artifacts/responsive-ui-observer`
- sanitized JSON evidence under `artifacts/responsive-ui-observer`
- screenshot hash
- evidence hash

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
