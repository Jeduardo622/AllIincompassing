import { beforeEach, describe, expect, it, vi } from 'vitest';

const fromMock = vi.fn();
const rpcMock = vi.fn();

vi.mock('../../supabase', () => ({
  supabase: {
    from: (...args: unknown[]) => fromMock(...args),
    rpc: (...args: unknown[]) => rpcMock(...args),
  },
}));

import { fetchMessageThreads } from '../fetchers';

describe('fetchMessageThreads', () => {
  beforeEach(() => {
    fromMock.mockReset();
    rpcMock.mockReset();
  });

  it('marks threads unread when latest activity is newer than last_read_at and excludes muted threads from the count', async () => {
    const participantSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          is: vi.fn().mockResolvedValue({
            data: [
              {
                thread_id: 'thread-unread',
                last_read_at: '2026-05-22T11:59:00.000Z',
                archived_at: null,
                muted_at: null,
                joined_at: '2026-05-22T11:00:00.000Z',
                organization_id: 'org-1',
                user_id: 'user-1',
              },
              {
                thread_id: 'thread-muted',
                last_read_at: null,
                archived_at: null,
                muted_at: '2026-05-22T11:58:00.000Z',
                joined_at: '2026-05-22T11:00:00.000Z',
                organization_id: 'org-1',
                user_id: 'user-1',
              },
              {
                thread_id: 'thread-read',
                last_read_at: '2026-05-22T12:02:00.000Z',
                archived_at: null,
                muted_at: null,
                joined_at: '2026-05-22T11:00:00.000Z',
                organization_id: 'org-1',
                user_id: 'user-1',
              },
              {
                thread_id: 'thread-empty',
                last_read_at: null,
                archived_at: null,
                muted_at: null,
                joined_at: '2026-05-22T11:00:00.000Z',
                organization_id: 'org-1',
                user_id: 'user-1',
              },
            ],
            error: null,
          }),
        }),
      }),
    });

    const threadSelect = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        in: vi.fn().mockReturnValue({
          order: vi.fn().mockResolvedValue({
            data: [
              {
                id: 'thread-unread',
                organization_id: 'org-1',
                created_by: 'user-2',
                subject: 'Unread',
                thread_type: 'direct',
                created_at: '2026-05-22T11:00:00.000Z',
                updated_at: '2026-05-22T12:01:00.000Z',
              },
              {
                id: 'thread-muted',
                organization_id: 'org-1',
                created_by: 'user-2',
                subject: 'Muted',
                thread_type: 'direct',
                created_at: '2026-05-22T11:00:00.000Z',
                updated_at: '2026-05-22T12:01:00.000Z',
              },
              {
                id: 'thread-read',
                organization_id: 'org-1',
                created_by: 'user-2',
                subject: 'Read',
                thread_type: 'direct',
                created_at: '2026-05-22T11:00:00.000Z',
                updated_at: '2026-05-22T12:01:00.000Z',
              },
              {
                id: 'thread-empty',
                organization_id: 'org-1',
                created_by: 'user-2',
                subject: 'Empty',
                thread_type: 'direct',
                created_at: '2026-05-22T11:00:00.000Z',
                updated_at: '2026-05-22T11:00:00.000Z',
              },
            ],
            error: null,
          }),
        }),
      }),
    });

    const messageSelect = vi.fn().mockReturnValue({
      in: vi.fn().mockReturnValue({
        order: vi.fn().mockResolvedValue({
          data: [
            {
              thread_id: 'thread-unread',
              body: 'Unread latest',
              created_at: '2026-05-22T12:01:00.000Z',
            },
            {
              thread_id: 'thread-muted',
              body: 'Muted latest',
              created_at: '2026-05-22T12:01:00.000Z',
            },
            {
              thread_id: 'thread-read',
              body: 'Read latest',
              created_at: '2026-05-22T12:01:00.000Z',
            },
          ],
          error: null,
        }),
      }),
    });

    fromMock.mockImplementation((table: string) => {
      if (table === 'message_thread_participants') {
        return { select: participantSelect };
      }
      if (table === 'message_threads') {
        return { select: threadSelect };
      }
      if (table === 'messages') {
        return { select: messageSelect };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    rpcMock.mockResolvedValue({ data: [], error: null });

    const result = await fetchMessageThreads('org-1', 'user-1');

    expect(result.schemaUnavailable).toBe(false);
    expect(result.unreadThreadCount).toBe(1);
    expect(result.threads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'thread-unread', isUnread: true }),
        expect.objectContaining({ id: 'thread-muted', isUnread: false }),
        expect.objectContaining({ id: 'thread-read', isUnread: false }),
        expect.objectContaining({ id: 'thread-empty', isUnread: false }),
      ]),
    );
  });
});
