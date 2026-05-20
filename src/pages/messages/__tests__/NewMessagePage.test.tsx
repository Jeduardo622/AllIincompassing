import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Routes, Route } from 'react-router-dom';
import { renderWithProviders, screen } from '../../../test/utils';
import { NewMessagePage } from '../NewMessagePage';
import { PHI_POLICY_BANNER } from '../../../lib/messages/constants';

const { useAuthMock, useEligibleStaffMock, useCreateThreadMutationMock } = vi.hoisted(() => ({
  useAuthMock: vi.fn(),
  useEligibleStaffMock: vi.fn(),
  useCreateThreadMutationMock: vi.fn(),
}));

vi.mock('../../../lib/authContext', () => ({
  useAuth: () => useAuthMock(),
  AuthProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('../../../lib/messages/hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../lib/messages/hooks')>();
  return {
    ...actual,
    useEligibleStaff: () => useEligibleStaffMock(),
    useCreateThreadMutation: () => useCreateThreadMutationMock(),
  };
});

const staff = [
  { id: 'admin-user-id', fullName: 'Admin User', email: 'admin@example.com' },
  { id: 'staff-b', fullName: 'Staff B', email: 'b@example.com' },
];

describe('NewMessagePage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useEligibleStaffMock.mockReturnValue({ data: staff, isLoading: false });
    useCreateThreadMutationMock.mockReturnValue({
      mutateAsync: vi.fn().mockResolvedValue('new-thread-id'),
      isPending: false,
    });
  });

  it('shows PHI banner and hides group option for therapists', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'therapist-user-id' },
      effectiveRole: 'therapist',
    });

    renderWithProviders(
      <Routes>
        <Route path="/messages/new" element={<NewMessagePage />} />
      </Routes>,
      { router: { initialEntries: ['/messages/new'] } },
    );

    expect(screen.getByText(PHI_POLICY_BANNER)).toBeInTheDocument();
    expect(screen.getByText(/direct \(1:1\) conversations only/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/Group/i)).not.toBeInTheDocument();
  });

  it('shows group option for admins', () => {
    useAuthMock.mockReturnValue({
      user: { id: 'admin-user-id' },
      effectiveRole: 'admin',
    });

    renderWithProviders(
      <Routes>
        <Route path="/messages/new" element={<NewMessagePage />} />
      </Routes>,
      { router: { initialEntries: ['/messages/new'] } },
    );

    expect(screen.getByLabelText(/Group/i)).toBeInTheDocument();
  });
});
