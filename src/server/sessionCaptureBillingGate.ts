/**
 * Mirrors client `sessionCaptureBillingGate` for `/api/session-notes/upsert`.
 * Set `SESSION_CAPTURE_RELAX_BILLING_GATE=false` on the server to restore strict billing checks.
 *
 * @see docs/session-capture-billing-gate.md
 */
export const isSessionCaptureBillingGateRelaxed = (): boolean =>
  process.env.SESSION_CAPTURE_RELAX_BILLING_GATE !== 'false';
