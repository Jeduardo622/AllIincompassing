# UI Style Guide – Therapist Onboarding

## Voice & Copy
- Plain-language, clinician-friendly wording; avoid jargon unless required (e.g., NPI, BCBA).
- Action-driven labels (“Upload License”, “Continue to Services”) to reinforce progress.
- Error states specify fix + hint (“Add your license number before continuing.”).

## Visual Treatment
- Maintain current palette; highlight required fields using existing accent color.
- Use inline validation with concise helper text rather than modal alerts.
- For document uploads, show filename chips with status icon (pending ✅/failed ⚠️).

## Accessibility
- Ensure file upload buttons remain keyboard operable (`label` + `input[type="file"]`).
- Provide ARIA descriptions for document requirements; keep contrast ≥ 4.5:1.
- After runtime-config fix, regression-test headings/landmarks for screen-reader navigation (Playwright + Axe optional).

## Change Management Guidelines
- Coordinate copy updates with Tone guide to keep reassurance messaging consistent.
- Capture before/after screenshots via MCP browser tool for design review.
- Run Lighthouse MCP accessibility audit if layout is modified.
