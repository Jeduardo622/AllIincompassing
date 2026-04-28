/**
 * Live session capture (per-goal notes / trials) is normally tied to an approved authorization and
 * a service code for billing. When this gate is relaxed, any authorization status may be used and
 * the server skips strict billing alignment checks so capture can persist while billing is still
 * being configured.
 *
 * Default is relaxed (`!== 'false'`) so capture saves without blocking; set to the literal `false`
 * string on both client and server before enforcing billing again.
 *
 * @see docs/session-capture-billing-gate.md
 */
export const isSessionCaptureBillingGateRelaxed = (): boolean =>
  import.meta.env.VITE_SESSION_CAPTURE_RELAX_BILLING_GATE !== 'false';

export function pickPrimaryBillingAuthorization<
  T extends { id: string; status: string; services?: Array<{ service_code: string | null }> | null },
>(rows: readonly T[]): T | undefined {
  if (rows.length === 0) {
    return undefined;
  }
  const approved = rows.find((row) => row.status === 'approved');
  return approved ?? rows[0];
}

export function firstServiceCodeOnAuthorization<
  T extends { services?: Array<{ service_code: string | null }> | null },
>(auth: T | undefined): string {
  const codes = (auth?.services ?? [])
    .map((service) => service.service_code?.trim())
    .filter((code): code is string => Boolean(code));
  return codes[0] ?? '';
}

/** Placeholder service code when relaxed mode has an authorization but no linked services row. */
export const SESSION_CAPTURE_RELAXED_FALLBACK_SERVICE_CODE = 'UNSPECIFIED' as const;
