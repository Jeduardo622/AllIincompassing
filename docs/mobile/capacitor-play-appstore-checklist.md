# Capacitor: Google Play & Apple App Store — team checklist

This repository ships a **React + Vite** web app. Listing on mobile stores requires a **native wrapper** (for example **Capacitor**) plus each store’s enrollment, signing, and policy workflows.

Use this checklist with **`AGENTS.md`**, **`docs/ai/cto-lane-contract.md`**, and **`docs/ai/verification-matrix.md`**. For non-trivial slices, run **`route-task`** before implementation and **`verify-change`** / **`pr-hygiene`** before merge.

## Legend

| Label | Meaning |
| --- | --- |
| **Skill** | Repo skill under `.agents/skills/` or `.cursor/skills/` — see `AGENTS.md` |
| **Subagent** | Task subagent types (for example `implementation-engineer`, `devops-engineer`) — use for scoped work or review |
| **Tool** | CLI, IDE, or vendor console |

---

## Phase 0 — Scope, lane, and ownership

| # | Task | Owner | Skill / workflow | Subagent (optional) | Tools / artifacts |
| --- | --- | --- | --- | --- | --- |
| 0.1 | Classify work (hybrid web shell vs full native rewrite), timelines, and **macOS requirement for iOS** | Tech lead | `route-task` → lane (`fast` / `standard` / `critical`) | `specification-engineer`, `software-architect` | `docs/ai/cto-lane-contract.md` |
| 0.2 | Linear issue for non-trivial / store program | PM / lead | Per `AGENTS.md` | — | Linear |
| 0.3 | Isolated branch before implementation | Dev | `codex/` branch prefix | — | `git` |

---

## Phase 1 — Capacitor + Vite integration

| # | Task | Owner | Skill | Subagent | Tools |
| --- | --- | --- | --- | --- | --- |
| 1.1 | Add Capacitor; point **`webDir`** at Vite **`dist`**; define env strategy for prod/staging API URLs | Frontend | Follow `verify-change` when code lands | `implementation-engineer` | **Node**, **`@capacitor/core`**, **`@capacitor/cli`**, `npx cap init`, `npm run build` |
| 1.2 | Add platforms: `npx cap add android` and `npx cap add ios` (iOS on **macOS**) | Frontend + platform owners | — | `implementation-engineer` | **`npx cap add`**, **Android Studio**, **Xcode** |
| 1.3 | Icons, splash, safe areas, status bar | Frontend / design | — | `implementation-engineer` | Capacitor Splash Screen / asset pipeline |
| 1.4 | Document build-and-sync for humans and CI (`npm run build && npx cap sync`) | Dev | `documentation-engineer` if process is new | `documentation-engineer` | Internal runbook or README section |

---

## Phase 2 — Auth, redirects, and tenant-safe configuration

| # | Task | Owner | Skill | Subagent | Tools |
| --- | --- | --- | --- | --- | --- |
| 2.1 | OAuth / magic links / session: **redirect URIs** for custom URL scheme or universal links | Auth / frontend | **`auth-routing-guard`** | `implementation-engineer`, **`security-engineer`** (review) | Supabase dashboard (redirect URLs), Capacitor **App** / **Browser** plugins as needed |
| 2.2 | No widening of tenant or RLS boundaries for mobile clients | Backend | **`supabase-tenant-safety`** | `supabase-engineer`, `security-engineer` | Supabase policies; migrations only with governance (`docs/migrations/MIGRATION_GOVERNANCE.md`) |
| 2.3 | Secrets stay off the client; align with runtime config and hosting parity | Frontend + DevOps | Repo env / runtime-config rules | `security-engineer` | Env vars, Netlify or host settings |

---

## Phase 3 — Android → Google Play

| # | Task | Owner | Skill | Subagent | Tools |
| --- | --- | --- | --- | --- | --- |
| 3.1 | Debug/release **signing** (keystore, Play App Signing) | DevOps / Android | — | `devops-engineer` | **Android Studio**, **Gradle**, Play Console → App Signing |
| 3.2 | Versioning (`versionCode` / `versionName`), min/target SDK | Android | — | `implementation-engineer` | `android/` project, `npx cap sync` after web build |
| 3.3 | Internal testing track, **AAB** upload | Release | — | `devops-engineer` | **Google Play Console**, **bundletool** (optional, for AAB debugging) |
| 3.4 | Data safety, content rating, **privacy policy URL** | Product / legal / eng | — | `security-engineer` (data mapping) | Play Console forms |

---

## Phase 4 — iOS → App Store

| # | Task | Owner | Skill | Subagent | Tools |
| --- | --- | --- | --- | --- | --- |
| 4.1 | **Apple Developer** enrollment, App ID, certificates, provisioning profiles | iOS / release | — | `devops-engineer` | **Apple Developer Program**, **Xcode** → Accounts |
| 4.2 | Archive, **TestFlight**, on-device testing | iOS | — | `implementation-engineer`, `test-engineer` | **Xcode**, **TestFlight**, **App Store Connect** |
| 4.3 | Privacy nutrition labels, encryption export compliance, **Sign in with Apple** if required by policy | Legal + eng | — | `security-engineer` | App Store Connect |
| 4.4 | Screenshots for required device sizes | Design / QA | — | — | Simulator or physical devices |

---

## Phase 5 — QA and regression

| # | Task | Owner | Skill | Subagent | Tools |
| --- | --- | --- | --- | --- | --- |
| 5.1 | Critical paths on **real devices** (auth, scheduling, offline/error states) | QA | Mobile is primarily manual unless you add **Detox** / **Appium** | `test-engineer` | Physical devices, TestFlight, Play internal testing |
| 5.2 | Web regression parity after auth or route changes | QA / frontend | **`playwright-regression-triage`** (web) | `test-engineer` | `npm run ci:playwright`, tier-0 routes as applicable |

---

## Phase 6 — Repository gates and ship

| # | Task | Owner | Skill | Subagent | Tools |
| --- | --- | --- | --- | --- | --- |
| 6.1 | Lint, typecheck, tests, build per change type | Dev | **`verify-change`** | `test-engineer` | `npm run verify:local` where applicable; see **`docs/ai/verification-matrix.md`** |
| 6.2 | PR readiness | Dev | **`pr-hygiene`** | `code-review-engineer` | GitHub PR, CI |
| 6.3 | Push branch, open PR, human review (required for high-risk paths in **`AGENTS.md`**) | Team | — | — | GitHub |

---

## Quick reference: skills and subagents by workstream

| Workstream | Primary skill | Primary subagents | Notes |
| --- | --- | --- | --- |
| Capacitor + Android/iOS shells | — | `implementation-engineer` | Day-to-day integration |
| CI, signing, store uploads | — | `devops-engineer` | Keystores, Mac runner for iOS, Play/App Store |
| Auth URLs and mobile redirects | **`auth-routing-guard`** | `security-engineer`, `implementation-engineer` | Avoid broken OAuth in WebView / in-app browser |
| Supabase, RLS, tenant boundaries | **`supabase-tenant-safety`** | `supabase-engineer` | Treat mobile like any new client surface |
| Slice routing before coding | **`route-task`** | — | Required for classified non-trivial work |
| Pre-merge | **`verify-change`**, **`pr-hygiene`** | `test-engineer`, `code-review-engineer` | As required by lane |

---

## Tools summary (Capacitor and stores)

| Category | Tools |
| --- | --- |
| Capacitor | `@capacitor/cli`, `npx cap sync`, `npx cap open android`, `npx cap open ios` |
| Android | Android Studio, JDK, Android SDK, Gradle, **AAB** → Play Console |
| iOS | **macOS**, Xcode, CocoaPods (commonly), archive → App Store Connect / TestFlight |
| Vendors | [Google Play Console](https://play.google.com/console), [App Store Connect](https://appstoreconnect.apple.com) |
| Optional automation | Fastlane, Mac CI for iOS builds |

---

## Related documents

- `AGENTS.md` — workflow, high-risk paths, verification commands
- `docs/ai/verification-matrix.md` — required checks by change type
- `docs/ai/high-risk-paths.md` — paths that need extra review
- `docs/pwa_readme.md` — PWA notes (store listing usually still needs a native binary)
