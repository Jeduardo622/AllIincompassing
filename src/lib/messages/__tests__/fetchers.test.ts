import { beforeEach, describe, expect, it, vi } from 'vitest';
import { listEligibleStaff, listInboxThreads } from '../fetchers';

const {
  fromMock,
  participantsSelectMock,
  participantsEqMock,
  participantsIsMock,
  messagesSelectMock,
  messagesInMock,
  messagesOrderMock,
  profilesSelectMock,
  profilesEqMock,
  profilesSecondEqMock,
  rolesSelectMock,
  rolesInMock,
} = vi.hoisted(() => {
  const participantsIsMock = vi.fn();
  const participantsEqMock = vi.fn();
  const participantsSelectMock = vi.fn();
  const messagesOrderMock = vi.fn();
  const messagesInMock = vi.fn();
  const messagesSelectMock = vi.fn();
  const profilesEqMock = vi.fn();
  const profilesSecondEqMock = vi.fn();
  const profilesSelectMock = vi.fn();
  const rolesInMock = vi.fn();
  const rolesSelectMock = vi.fn();

  participantsEqMock.mockReturnValue({ is: participantsIsMock });
  participantsSelectMock.mockReturnValue({ eq: participantsEqMock });
  messagesInMock.mockReturnValue({ order: messagesOrderMock });
  messagesSelectMock.mockReturnValue({ in: messagesInMock });
  profilesEqMock.mockReturnValue({ eq: profilesSecondEqMock });
  profilesSelectMock.mockReturnValue({ eq: profilesEqMock });
  rolesSelectMock.mockReturnValue({ in: rolesInMock });

  const fromMock = vi.fn((table: string) => {
    if (table === 'message_thread_participants') {
      return { select: participantsSelectMock };
    }
    if (table === 'messages') {
      return { select: messagesSelectMock };
    }
    if (table === 'profiles') {
      return { select: profilesSelectMock };
    }
    if (table === 'user_roles') {
      return { select: rolesSelectMock };
    }
    throw new Error(`Unexpected table ${table}`);
  });

  return {
    fromMock,
    participantsSelectMock,
    participantsEqMock,
    participantsIsMock,
    messagesSelectMock,
    messagesInMock,
    messagesOrderMock,
    profilesSelectMock,
    profilesEqMock,
    profilesSecondEqMock,
    rolesSelectMock,
    rolesInMock,
  };
});

vi.mock('../../supabase', () => ({
  supabase: { from: fromMock },
}));

describe('staff messaging fetchers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    participantsIsMock.mockResolvedValue({
      data: [
        {
          thread_id: 'thread-1',
          last_read_at: null,
          thread: {
            id: 'thread-1',
            subject: 'Ops sync',
            thread_type: 'direct',
            updated_at: '2026-05-20T12:00:00.000Z',
          },
        },
      ],
      error: null,
    });
    messagesOrderMock.mockResolvedValue({
      data: [
        {
          id: 'msg-1',
          thread_id: 'thread-1',
          body: 'Synthetic update',
          created_at: '2026-05-20T12:01:00.000Z',
          sender_id: 'user-a',
        },
      ],
      error: null,
    });
    profilesSecondEqMock.mockResolvedValue({
      data: [
        {
          id: 'user-a',
          full_name: 'Staff A',
          email: 'staff-a@example.com',
          organization_id: 'org-1',
          is_active: true,
        },
      ],
      error: null,
    });
    rolesInMock.mockResolvedValue({
      data: [
        {
          user_id: 'user-a',
          is_active: true,
          expires_at: null,
          roles: { name: 'therapist' },
        },
      ],
      error: null,
    });
  });

  it('maps inbox participant rows into thread list items', async () => {
    const items = await listInboxThreads('user-a');

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      threadId: 'thread-1',
      subject: 'Ops sync',
      threadType: 'direct',
      latestMessageBody: 'Synthetic update',
    });
    expect(participantsEqMock).toHaveBeenCalledWith('user_id', 'user-a');
    expect(participantsIsMock).toHaveBeenCalledWith('archived_at', null);
  });

  it('filters eligible staff by active junction roles in org', async () => {
    const staff = await listEligibleStaff('org-1');

    expect(staff).toEqual([
      {
        id: 'user-a',
        fullName: 'Staff A',
        email: 'staff-a@example.com',
      },
    ]);
    expect(profilesEqMock).toHaveBeenCalled();
  });
});
