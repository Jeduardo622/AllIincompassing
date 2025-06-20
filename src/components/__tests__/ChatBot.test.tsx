import { describe, it, expect, vi } from 'vitest';
import { renderWithProviders, screen, userEvent } from '../../test/utils';
import ChatBot from '../ChatBot';

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

vi.mock('../../lib/ai', () => ({
  processMessage: vi.fn().mockResolvedValue({
    response: 'Sure thing',
    action: {
      type: 'schedule_session',
      data: {
        therapist_id: 't1',
        client_id: 'c1',
        start_time: '2025-03-18T10:00:00Z',
        end_time: '2025-03-18T11:00:00Z',
        location_type: 'in_clinic'
      }
    }
  })
}));

describe('ChatBot scheduling', () => {
  it('dispatches openScheduleModal when scheduling action returned', async () => {
    const handler = vi.fn();
    document.addEventListener('openScheduleModal', handler as EventListener);

    renderWithProviders(<ChatBot />);
    await userEvent.click(document.getElementById('chat-trigger')!);

    const input = screen.getByPlaceholderText(/Type your message/);
    await userEvent.type(input, 'schedule a session');
    const sendBtn = input.closest('form')!.querySelector('button[type="submit"]') as HTMLButtonElement;
    await userEvent.click(sendBtn);

    await screen.findByText('Sure thing');

    expect(handler).toHaveBeenCalled();
    const event = handler.mock.calls[0][0] as CustomEvent;
    expect(event.detail.therapist_id).toBe('t1');

    document.removeEventListener('openScheduleModal', handler as EventListener);
  });
});
