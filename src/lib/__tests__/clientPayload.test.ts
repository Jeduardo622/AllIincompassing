import { describe, expect, it, vi } from 'vitest';
import { prepareClientPayload, updateClientRecord } from '../clientPayload';
import type { Client } from '../../types';

describe('prepareClientPayload', () => {
  it('sanitizes strings and recomputes full_name after sanitization', () => {
    const payload = prepareClientPayload({
      first_name: '  Jane  ',
      middle_name: '  Q ',
      last_name: '  Doe ',
      email: ' Jane.Doe@Example.Com ',
      insurance_info: null,
      service_preference: ['  In-Home  ', 'Telehealth '],
    });

    expect(payload.first_name).toBe('Jane');
    expect(payload.middle_name).toBe('Q');
    expect(payload.last_name).toBe('Doe');
    expect(payload.email).toBe('jane.doe@example.com');
    expect(payload.full_name).toBe('Jane Q Doe');
    expect(payload.insurance_info).toBeNull();
    expect(payload.service_preference).toEqual(['In-Home', 'Telehealth']);
  });

  it('does not overwrite full_name when names are absent', () => {
    const payload = prepareClientPayload({
      phone: '(555) 555-1212',
      full_name: 'Existing Name',
    });

    expect(payload.full_name).toBe('Existing Name');
    expect(payload.phone).toBe('5555551212');
  });

  it('enforces full_name when requested even if names are missing', () => {
    const payload = prepareClientPayload(
      {
        full_name: ' Legacy Value ',
      },
      { enforceFullName: true }
    );

    expect(payload.full_name).toBe('Legacy Value');
  });

  it('treats empty insurance info strings as null', () => {
    const payload = prepareClientPayload({
      first_name: 'Sample',
      last_name: 'Client',
      insurance_info: '',
    });

    expect(payload.insurance_info).toBeNull();
  });

  it('strips documents_consent from payload before validation', () => {
    const payload = prepareClientPayload({
      first_name: 'Consent',
      last_name: 'Checked',
      documents_consent: true,
    } as Partial<Client> & { documents_consent: boolean });

    expect('documents_consent' in payload).toBe(false);
  });
});

describe('updateClientRecord', () => {
  it('sanitizes payload before sending update to Supabase', async () => {
    const single = vi.fn().mockResolvedValue({ data: { id: 'client-1' }, error: null });
    const select = vi.fn(() => ({ single }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));

    const supabaseMock = { from };

    const result = await updateClientRecord(supabaseMock, 'client-1', {
      first_name: '  jane ',
      last_name: ' doe  ',
      email: ' JANE.DOE@EXAMPLE.COM ',
    });

    expect(result).toEqual({ id: 'client-1' });
    expect(from).toHaveBeenCalledWith('clients');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        first_name: 'jane',
        last_name: 'doe',
        email: 'jane.doe@example.com',
        full_name: 'jane doe',
      })
    );
    expect(eq).toHaveBeenCalledWith('id', 'client-1');
  });

  it('throws an error when Supabase update fails', async () => {
    const failure = new Error('update failed');
    const single = vi.fn().mockResolvedValue({ data: null, error: failure });
    const select = vi.fn(() => ({ single }));
    const eq = vi.fn(() => ({ select }));
    const update = vi.fn(() => ({ eq }));
    const from = vi.fn(() => ({ update }));

    const supabaseMock = { from };

    await expect(
      updateClientRecord(supabaseMock, 'client-1', { first_name: ' Test ' })
    ).rejects.toThrow('update failed');
  });
});
