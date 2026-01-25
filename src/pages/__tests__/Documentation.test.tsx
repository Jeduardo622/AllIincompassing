import { describe, expect, it, vi, beforeEach } from 'vitest';
import { renderWithProviders, screen, userEvent, waitFor } from '../../test/utils';
import { Documentation } from '../Documentation';

const tableData = {
  therapist_documents: [
    {
      id: 'td-1',
      document_key: 'license',
      bucket_id: 'therapist-documents',
      object_path: 'therapists/user-1/license/license.pdf',
      created_at: '2025-01-10T00:00:00.000Z',
    },
  ],
  ai_session_notes: [
    {
      id: 'note-1',
      session_date: '2025-01-05',
      client_id: 'client-1',
      therapist_id: 'user-1',
      created_at: '2025-01-06T00:00:00.000Z',
      signed_at: null,
      ai_confidence_score: 0.91,
    },
  ],
  clients: [
    {
      id: 'client-1',
      full_name: 'Jane Client',
      created_at: '2025-01-02T00:00:00.000Z',
      created_by: 'user-1',
      email: 'user@example.com',
      documents: [
        {
          name: 'intake.pdf',
          path: 'clients/client-1/intake/intake.pdf',
          size: 1200,
          type: 'application/pdf',
        },
      ],
    },
  ],
  authorizations: [
    {
      id: 'auth-1',
      authorization_number: 'AUTH-100',
      created_at: '2025-01-03T00:00:00.000Z',
      created_by: 'user-1',
      documents: [
        {
          name: 'auth-form.pdf',
          path: 'clients/client-1/authorizations/auth-1/auth-form.pdf',
          size: 2048,
          type: 'application/pdf',
        },
      ],
    },
  ],
};

const buildQuery = (table: keyof typeof tableData) => {
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    order: vi.fn(() => builder),
    limit: vi.fn(() => builder),
    then: (resolve: (value: { data: unknown; error: null }) => void, reject: (reason?: unknown) => void) =>
      Promise.resolve({ data: tableData[table], error: null }).then(resolve, reject),
  };
  return builder;
};

vi.mock('../../lib/authContext', () => ({
  useAuth: () => ({
    user: { id: 'user-1', email: 'user@example.com' },
    profile: { id: 'user-1', email: 'user@example.com' },
  }),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: keyof typeof tableData) => buildQuery(table),
    storage: {
      from: () => ({
        createSignedUrl: vi.fn(),
      }),
    },
  },
}));

vi.mock('../../lib/toast', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

vi.mock('../../lib/logger/logger', () => ({
  logger: {
    error: vi.fn(),
  },
}));

describe('Documentation page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders sections and filters results by search', async () => {
    renderWithProviders(<Documentation />);

    await waitFor(() => {
      expect(screen.getByText('Therapist Uploads')).toBeInTheDocument();
    });

    expect(screen.getByText('license • license.pdf')).toBeInTheDocument();
    expect(screen.getByText('auth-form.pdf')).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText('Search documentation...');
    await userEvent.clear(searchInput);
    await userEvent.type(searchInput, 'authorization');

    expect(screen.getByText('auth-form.pdf')).toBeInTheDocument();
    expect(screen.queryByText('license • license.pdf')).not.toBeInTheDocument();
  });
});
