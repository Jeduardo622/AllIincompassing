import { describe, expect, it } from 'vitest'
import { __TESTING__ } from '../../supabase/functions/get-dashboard-data/index.ts'

describe('get-dashboard-data todaysSessions aggregation', () => {
  it('counts multiple sessions on the same day without collapsing results', () => {
    const sessions = [
      {
        id: 'session-1',
        status: 'completed',
        start_time: '2024-01-01T10:00:00',
        end_time: '2024-01-01T10:30:00',
      },
      {
        id: 'session-2',
        status: 'scheduled',
        start_time: '2024-01-01T14:00:00',
        end_time: '2024-01-01T14:45:00',
      },
    ]

    const result = __TESTING__.aggregateTodaysSessions(sessions, sessions.length)

    expect(result.total).toBe(2)
    expect(result.completed).toBe(1)
    expect(result.pending).toBe(1)
    expect(result.cancelled).toBe(0)
  })
})
