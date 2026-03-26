import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../../../test/utils';
import { FileCabinetSettings } from '../FileCabinetSettings';
import { LocationSettings } from '../LocationSettings';
import { ReferringProviderSettings } from '../ReferringProviderSettings';
import { ServiceLineSettings } from '../ServiceLineSettings';
import { supabase } from '../../../lib/supabase';
import { useAuth } from '../../../lib/authContext';

vi.mock('../../../lib/authContext', () => ({
  useAuth: vi.fn(),
}));

vi.mock('../../../lib/toast', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

type QueryResponse<T> = Promise<{ data: T; error: null }>;

type Config = {
  name: string;
  component: React.ComponentType;
  title: string;
  deleteButtonName: string;
  confirmMessage: string;
  deleteTable: string;
  deleteId: string;
  serviceLineLocationId?: string;
};

const FILE_CABINET_ID = 'cab-1';
const LOCATION_ID = 'loc-1';
const PROVIDER_ID = 'prov-1';
const SERVICE_LINE_ID = 'svc-1';

const mockFrom = vi.mocked(supabase.from);

const makeDeleteChain = (deleteEqSpy: ReturnType<typeof vi.fn>) => ({
  delete: vi.fn(() => ({
    eq: deleteEqSpy,
  })),
});

const configureFileCabinet = (deleteEqSpy: ReturnType<typeof vi.fn>) => {
  mockFrom.mockImplementation((table: string) => {
    if (table !== 'file_cabinet_settings') {
      throw new Error(`Unexpected table: ${table}`);
    }

    return {
      select: vi.fn(() => ({
        order: vi.fn((): QueryResponse<Array<Record<string, unknown>>> =>
          Promise.resolve({
            data: [
              {
                id: FILE_CABINET_ID,
                category_name: 'Assessments',
                description: null,
                allowed_file_types: ['.pdf'],
                max_file_size_mb: 10,
                retention_period_days: null,
                requires_signature: false,
                is_active: true,
              },
            ],
            error: null,
          }),
        ),
      })),
      ...makeDeleteChain(deleteEqSpy),
    } as unknown as ReturnType<typeof supabase.from>;
  });
};

const configureLocations = (deleteEqSpy: ReturnType<typeof vi.fn>) => {
  mockFrom.mockImplementation((table: string) => {
    if (table !== 'locations') {
      throw new Error(`Unexpected table: ${table}`);
    }

    return {
      select: vi.fn(() => ({
        order: vi.fn((): QueryResponse<Array<Record<string, unknown>>> =>
          Promise.resolve({
            data: [
              {
                id: LOCATION_ID,
                name: 'Main Clinic',
                type: 'clinic',
                address_line1: '123 Main',
                address_line2: null,
                city: 'Anaheim',
                state: 'CA',
                zip_code: '92801',
                phone: null,
                fax: null,
                email: null,
                is_active: true,
                operating_hours: {
                  monday: { start: '09:00', end: '17:00' },
                },
              },
            ],
            error: null,
          }),
        ),
      })),
      ...makeDeleteChain(deleteEqSpy),
    } as unknown as ReturnType<typeof supabase.from>;
  });
};

const configureProviders = (deleteEqSpy: ReturnType<typeof vi.fn>) => {
  mockFrom.mockImplementation((table: string) => {
    if (table !== 'referring_providers') {
      throw new Error(`Unexpected table: ${table}`);
    }

    return {
      select: vi.fn(() => ({
        order: vi.fn((): QueryResponse<Array<Record<string, unknown>>> =>
          Promise.resolve({
            data: [
              {
                id: PROVIDER_ID,
                first_name: 'Casey',
                last_name: 'Provider',
                credentials: ['MD'],
                npi_number: null,
                facility_name: null,
                specialty: null,
                phone: null,
                fax: null,
                email: null,
                address_line1: null,
                address_line2: null,
                city: null,
                state: null,
                zip_code: null,
                is_active: true,
              },
            ],
            error: null,
          }),
        ),
      })),
      ...makeDeleteChain(deleteEqSpy),
    } as unknown as ReturnType<typeof supabase.from>;
  });
};

const configureServiceLines = (deleteEqSpy: ReturnType<typeof vi.fn>, locationId: string) => {
  mockFrom.mockImplementation((table: string) => {
    if (table === 'service_lines') {
      return {
        select: vi.fn(() => ({
          order: vi.fn((): QueryResponse<Array<Record<string, unknown>>> =>
            Promise.resolve({
              data: [
                {
                  id: SERVICE_LINE_ID,
                  name: 'ABA Therapy',
                  code: null,
                  description: null,
                  rate_per_hour: null,
                  billable: true,
                  requires_authorization: false,
                  documentation_required: false,
                  available_locations: [locationId],
                  is_active: true,
                },
              ],
              error: null,
            }),
          ),
        })),
        ...makeDeleteChain(deleteEqSpy),
      } as unknown as ReturnType<typeof supabase.from>;
    }

    if (table === 'locations') {
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn((): QueryResponse<Array<Record<string, unknown>>> =>
              Promise.resolve({
                data: [{ id: locationId, name: 'Main Clinic' }],
                error: null,
              }),
            ),
          })),
        })),
        delete: vi.fn(() => ({
          eq: vi.fn(() => Promise.resolve({ error: null })),
        })),
      } as unknown as ReturnType<typeof supabase.from>;
    }

    throw new Error(`Unexpected table: ${table}`);
  });
};

const testConfigs: Config[] = [
  {
    name: 'FileCabinetSettings',
    component: FileCabinetSettings,
    title: 'Assessments',
    deleteButtonName: 'Delete category Assessments',
    confirmMessage: 'Are you sure you want to delete this category?',
    deleteTable: 'file_cabinet_settings',
    deleteId: FILE_CABINET_ID,
  },
  {
    name: 'LocationSettings',
    component: LocationSettings,
    title: 'Main Clinic',
    deleteButtonName: 'Delete location Main Clinic',
    confirmMessage: 'Are you sure you want to delete this location?',
    deleteTable: 'locations',
    deleteId: LOCATION_ID,
  },
  {
    name: 'ReferringProviderSettings',
    component: ReferringProviderSettings,
    title: 'Casey Provider',
    deleteButtonName: 'Delete referring provider Casey Provider',
    confirmMessage: 'Are you sure you want to delete this referring provider?',
    deleteTable: 'referring_providers',
    deleteId: PROVIDER_ID,
  },
  {
    name: 'ServiceLineSettings',
    component: ServiceLineSettings,
    title: 'ABA Therapy',
    deleteButtonName: 'Delete service line ABA Therapy',
    confirmMessage: 'Are you sure you want to delete this service line?',
    deleteTable: 'service_lines',
    deleteId: SERVICE_LINE_ID,
    serviceLineLocationId: LOCATION_ID,
  },
];

describe('Settings destructive confirmation gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useAuth).mockReturnValue({
      hasRole: (role: string) => role === 'admin',
      loading: false,
    } as unknown as ReturnType<typeof useAuth>);
  });

  it.each(testConfigs)('$name does not run delete mutation when confirmation is canceled', async (config) => {
    const deleteEqSpy = vi.fn(() => Promise.resolve({ error: null }));

    if (config.deleteTable === 'file_cabinet_settings') {
      configureFileCabinet(deleteEqSpy);
    } else if (config.deleteTable === 'locations' && !config.serviceLineLocationId) {
      configureLocations(deleteEqSpy);
    } else if (config.deleteTable === 'referring_providers') {
      configureProviders(deleteEqSpy);
    } else {
      configureServiceLines(deleteEqSpy, config.serviceLineLocationId ?? LOCATION_ID);
    }

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false);
    try {
      renderWithProviders(React.createElement(config.component), {
        auth: { role: 'admin' },
      });

      await screen.findByText(config.title);
      const deleteButton = screen.getByRole('button', { name: config.deleteButtonName });

      await userEvent.click(deleteButton);

      expect(confirmSpy).toHaveBeenCalledWith(config.confirmMessage);
      expect(deleteEqSpy).not.toHaveBeenCalled();
    } finally {
      confirmSpy.mockRestore();
    }
  });

  it.each(testConfigs)('$name runs delete mutation only after confirmation is accepted', async (config) => {
    const deleteEqSpy = vi.fn(() => Promise.resolve({ error: null }));

    if (config.deleteTable === 'file_cabinet_settings') {
      configureFileCabinet(deleteEqSpy);
    } else if (config.deleteTable === 'locations' && !config.serviceLineLocationId) {
      configureLocations(deleteEqSpy);
    } else if (config.deleteTable === 'referring_providers') {
      configureProviders(deleteEqSpy);
    } else {
      configureServiceLines(deleteEqSpy, config.serviceLineLocationId ?? LOCATION_ID);
    }

    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    try {
      renderWithProviders(React.createElement(config.component), {
        auth: { role: 'admin' },
      });

      await screen.findByText(config.title);
      const deleteButton = screen.getByRole('button', { name: config.deleteButtonName });

      await userEvent.click(deleteButton);

      expect(confirmSpy).toHaveBeenCalledWith(config.confirmMessage);
      expect(mockFrom).toHaveBeenCalledWith(config.deleteTable);
      await waitFor(() => {
        expect(deleteEqSpy).toHaveBeenCalledWith('id', config.deleteId);
      });
    } finally {
      confirmSpy.mockRestore();
    }
  });
});
