import { describe, expect, it, vi } from 'vitest';
import { createAuthorizationWithServices, updateAuthorizationDocuments } from '../mutations';

describe('createAuthorizationWithServices', () => {
  it('calls the RPC with allowlisted arguments', async () => {
    const { supabase } = await import('../../supabase');
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'auth-id' }, error: null });
    (supabase as any).rpc = rpc;

    await createAuthorizationWithServices({
      client_id: 'client-id',
      provider_id: 'provider-id',
      authorization_number: 'AUTH-123',
      diagnosis_code: 'F84.0',
      diagnosis_description: 'desc',
      start_date: '2026-01-01',
      end_date: '2026-12-31',
      status: 'pending',
      insurance_provider_id: null,
      plan_type: 'Medical',
      member_id: 'M123',
      services: [
        {
          service_code: '97153',
          service_description: 'ABA Service',
          from_date: '2026-01-01',
          to_date: '2026-12-31',
          requested_units: 10,
          approved_units: null,
          unit_type: 'Units',
          decision_status: 'pending',
        },
      ],
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith(
      'create_authorization_with_services',
      expect.any(Object),
    );

    const args = rpc.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(Object.keys(args).sort()).toEqual(
      [
        'p_authorization_number',
        'p_client_id',
        'p_diagnosis_code',
        'p_diagnosis_description',
        'p_end_date',
        'p_insurance_provider_id',
        'p_member_id',
        'p_plan_type',
        'p_provider_id',
        'p_services',
        'p_start_date',
        'p_status',
      ].sort(),
    );
  });
});

describe('updateAuthorizationDocuments', () => {
  it('calls the RPC with allowlisted arguments', async () => {
    const { supabase } = await import('../../supabase');
    const rpc = vi.fn().mockResolvedValue({ data: { id: 'auth-id' }, error: null });
    (supabase as any).rpc = rpc;

    await updateAuthorizationDocuments({
      authorization_id: 'auth-id',
      documents: [
        {
          name: 'doc.pdf',
          path: 'clients/client-id/authorizations/auth-id/doc.pdf',
          size: 123,
          type: 'application/pdf',
        },
      ],
    });

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('update_authorization_documents', {
      p_authorization_id: 'auth-id',
      p_documents: [
        {
          name: 'doc.pdf',
          path: 'clients/client-id/authorizations/auth-id/doc.pdf',
          size: 123,
          type: 'application/pdf',
        },
      ],
    });
  });
});

