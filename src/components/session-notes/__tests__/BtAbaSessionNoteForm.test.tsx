import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { BtAbaSessionNoteResponses } from '../../../lib/bt-aba-session-note';
import { BtAbaSessionNoteForm, type BtAbaSessionNoteContext } from '../BtAbaSessionNoteForm';

const emptyResponses: BtAbaSessionNoteResponses = {
  purpose_of_session: [],
  client_status: '',
  skill_strategies: [],
  behavior_strategies: [],
  supervisor_support: [],
  progress_toward_goals: '',
  client_response_to_treatment: '',
  data_point_scope: 'linked',
  link_unlinked_data: false,
  bt_signature: { method: 'typed', value: '' },
};

const context: BtAbaSessionNoteContext = {
  sessionId: 'session-1',
  clientName: 'Synthetic Client',
  behaviorTechnicianName: 'Jordan BT',
  serviceDate: 'July 16, 2026',
  sessionTime: '9:00 AM–11:00 AM',
  placeOfService: 'Home',
  billingCode: '97153',
  modifiers: ['HN', 'HO'],
  programs: [{ name: 'Functional Communication', goals: ['Request a break'] }],
  collectedDataPointCount: 12,
  linkedDataPoints: [{ label: 'Request a break', value: '8 correct / 10 trials' }],
  allDataPoints: [
    { label: 'Request a break', value: '8 correct / 10 trials' },
    { label: 'Unlinked observation', value: '2 events' },
  ],
  collectedBy: 'Jordan BT',
};

const makeProps = () => ({
  initialResponses: emptyResponses,
  context,
  onSaveDraft: vi.fn(),
  onFinalize: vi.fn(),
  busy: false,
});

describe('BtAbaSessionNoteForm', () => {
  it('shows exact approved labels and read-only session, billing, and daily-summary context', () => {
    render(<BtAbaSessionNoteForm {...makeProps()} />);

    expect(screen.getByRole('heading', { name: 'ABA Session Note' })).toBeVisible();
    expect(screen.getByText('Synthetic Client')).toBeVisible();
    expect(screen.getAllByText('Jordan BT').length).toBeGreaterThan(0);
    expect(screen.getByText('July 16, 2026')).toBeVisible();
    expect(screen.getByText('9:00 AM–11:00 AM')).toBeVisible();
    expect(screen.getByText('Home')).toBeVisible();
    expect(screen.getByText('97153')).toBeVisible();
    expect(screen.getByText('Modifier 1')).toBeVisible();
    expect(screen.getByText('Modifier 4')).toBeVisible();
    expect(screen.getByText('HN')).toBeVisible();
    expect(screen.getByText('HO')).toBeVisible();
    expect(screen.getByText('Functional Communication — Request a break')).toBeVisible();
    expect(screen.getByText('12 collected data points')).toBeVisible();
    expect(screen.getByText('Request a break: 8 correct / 10 trials')).toBeVisible();
    expect(screen.queryByLabelText(/client name/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/billing code/i)).not.toBeInTheDocument();

    expect(screen.getByRole('group', { name: 'Purpose of Session' })).toBeVisible();
    expect(screen.getByLabelText('RBT/BT worked on goals as stated in the treatment plan')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Skill Strategies' })).toBeVisible();
    expect(screen.getByLabelText('Natural environment teaching')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Behavior Strategies' })).toBeVisible();
    expect(screen.getByLabelText('Differential Reinforcement')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Supervisor Support and Discussion Included' })).toBeVisible();
    expect(screen.getByLabelText('Summary of Progress Toward Treatment Goals')).toBeVisible();
    expect(screen.getByLabelText("Client's Response to Treatment")).toBeVisible();
    expect(screen.getByRole('group', { name: 'Data Point Scope' })).toBeVisible();
    expect(screen.getByText('Collected By: Jordan BT')).toBeVisible();
    expect(screen.getByRole('heading', { name: 'Behavior Technician Signature' })).toBeVisible();
    expect(screen.queryByText(/parent.*signature/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/BCBA.*signature/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/midtier.*signature/i)).not.toBeInTheDocument();
  });

  it('saves an incomplete draft without final validation', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<BtAbaSessionNoteForm {...props} />);

    await user.type(screen.getByLabelText('Client Status'), 'Calm and ready');
    await user.click(screen.getByRole('button', { name: 'Save Draft' }));

    expect(props.onSaveDraft).toHaveBeenCalledWith(expect.objectContaining({ client_status: 'Calm and ready' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('previews the exact data-point scope without mutating the data', async () => {
    const user = userEvent.setup();
    render(<BtAbaSessionNoteForm {...makeProps()} />);

    expect(screen.getByText('Request a break: 8 correct / 10 trials')).toBeVisible();
    expect(screen.queryByText('Unlinked observation: 2 events')).not.toBeInTheDocument();

    await user.click(screen.getByLabelText('Include all data points'));
    expect(screen.getByText('Unlinked observation: 2 events')).toBeVisible();
    expect(context.linkedDataPoints).toHaveLength(1);
    expect(context.allDataPoints).toHaveLength(2);
  });

  it('shows required errors, marks fields invalid, focuses the first error, and blocks finalization', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<BtAbaSessionNoteForm {...props} />);

    await user.click(screen.getByRole('button', { name: 'Finalize Session' }));

    expect(screen.getByText('Purpose of Session is required')).toBeVisible();
    expect(screen.getByText('Behavior Technician signature is required')).toBeVisible();
    expect(screen.getByRole('group', { name: 'Purpose of Session' })).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('RBT/BT worked on goals as stated in the treatment plan')).toHaveFocus();
    expect(props.onFinalize).not.toHaveBeenCalled();
  });

  it('conditionally requires and removes Other narratives', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<BtAbaSessionNoteForm {...props} />);

    const purpose = screen.getByRole('group', { name: 'Purpose of Session' });
    await user.click(within(purpose).getByLabelText('Other'));
    expect(screen.getByLabelText('Describe Other')).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Finalize Session' }));
    expect(screen.getByText('Other narrative is required when Other is selected')).toBeVisible();

    await user.click(within(purpose).getByLabelText('Other'));
    expect(screen.queryByLabelText('Describe Other')).not.toBeInTheDocument();
  });

  it('focuses and describes an empty drawn signature when it is the only finalization error', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    const completeExceptSignature: BtAbaSessionNoteResponses = {
      purpose_of_session: ['RBT/BT worked on goals as stated in the treatment plan'],
      client_status: 'Engaged',
      skill_strategies: ['Natural environment teaching'],
      behavior_strategies: ['Differential Reinforcement'],
      supervisor_support: ['Supervisor did not attend this session'],
      progress_toward_goals: 'Made progress',
      client_response_to_treatment: 'Responded positively',
      data_point_scope: 'linked',
      link_unlinked_data: false,
      bt_signature: { method: 'drawn', value: '' },
    };
    render(<BtAbaSessionNoteForm {...props} initialResponses={completeExceptSignature} />);

    await user.click(screen.getByRole('button', { name: 'Finalize Session' }));

    const pad = screen.getByRole('application', { name: 'Draw Behavior Technician signature' });
    expect(pad).toHaveFocus();
    expect(pad).toHaveAttribute('data-field', 'bt_signature');
    expect(pad).toHaveAttribute('aria-invalid', 'true');
    expect(pad).toHaveAttribute('aria-describedby', 'bt-signature-error');
  });

  it('preserves local edits when props rerender for the same session', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    const { rerender } = render(<BtAbaSessionNoteForm {...props} />);
    await user.type(screen.getByLabelText('Client Status'), 'Locally edited');

    rerender(<BtAbaSessionNoteForm {...makeProps()} initialResponses={{ ...emptyResponses }} />);

    expect(screen.getByLabelText('Client Status')).toHaveValue('Locally edited');
  });

  it('rehydrates responses when the session changes', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    const { rerender } = render(<BtAbaSessionNoteForm {...props} />);
    await user.type(screen.getByLabelText('Client Status'), 'Old session edit');

    rerender(
      <BtAbaSessionNoteForm
        {...props}
        context={{ ...context, sessionId: 'session-2' }}
        initialResponses={{ ...emptyResponses, client_status: 'Recovered session draft' }}
      />,
    );

    expect(screen.getByLabelText('Client Status')).toHaveValue('Recovered session draft');
  });

  it('keeps N/A exclusive in skill and behavior strategy groups', async () => {
    const user = userEvent.setup();
    render(<BtAbaSessionNoteForm {...makeProps()} />);
    const skills = screen.getByRole('group', { name: 'Skill Strategies' });
    const behavior = screen.getByRole('group', { name: 'Behavior Strategies' });

    await user.click(within(skills).getByLabelText('Role playing or modeling'));
    await user.click(within(skills).getByLabelText('N/A'));
    expect(within(skills).getByLabelText('Role playing or modeling')).not.toBeChecked();
    expect(within(skills).getByLabelText('N/A')).toBeChecked();
    await user.click(within(skills).getByLabelText('Generalization training'));
    expect(within(skills).getByLabelText('N/A')).not.toBeChecked();

    await user.click(within(behavior).getByLabelText('N/A'));
    await user.click(within(behavior).getByLabelText('Modeling'));
    expect(within(behavior).getByLabelText('N/A')).not.toBeChecked();
    expect(within(behavior).getByLabelText('Modeling')).toBeChecked();
  });

  it('disables draft and finalization while busy', () => {
    render(<BtAbaSessionNoteForm {...makeProps()} busy />);
    expect(screen.getByRole('button', { name: 'Save Draft' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Finalize Session' })).toBeDisabled();
    expect(screen.getByLabelText('Client Status')).toBeDisabled();
  });

  it('keeps unlinked-data association visible but unavailable during closeout', () => {
    render(<BtAbaSessionNoteForm {...makeProps()} initialResponses={{ ...emptyResponses, link_unlinked_data: true }} />);
    expect(screen.getByLabelText('Link unlinked data for this service date')).toBeDisabled();
    expect(screen.getByLabelText('Link unlinked data for this service date')).not.toBeChecked();
    expect(screen.getByText('Linking data is not available during closeout; associate unlinked data before finalizing.')).toBeVisible();
  });

  it('submits the complete normalized final payload', async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<BtAbaSessionNoteForm {...props} />);

    await user.click(screen.getByLabelText('RBT/BT worked on goals as stated in the treatment plan'));
    await user.type(screen.getByLabelText('Client Status'), 'Engaged');
    await user.click(screen.getByLabelText('Natural environment teaching'));
    await user.click(screen.getByLabelText('Differential Reinforcement'));
    await user.click(screen.getByLabelText('Supervisor did not attend this session'));
    await user.type(screen.getByLabelText('Summary of Progress Toward Treatment Goals'), 'Made measurable progress');
    await user.type(screen.getByLabelText("Client's Response to Treatment"), 'Responded positively');
    await user.click(screen.getByLabelText('Include all data points'));
    await user.type(screen.getByLabelText('Type Behavior Technician signature'), 'Jordan BT');
    await user.click(screen.getByRole('button', { name: 'Finalize Session' }));

    expect(props.onFinalize).toHaveBeenCalledWith({
      purpose_of_session: ['RBT/BT worked on goals as stated in the treatment plan'],
      client_status: 'Engaged',
      skill_strategies: ['Natural environment teaching'],
      behavior_strategies: ['Differential Reinforcement'],
      supervisor_support: ['Supervisor did not attend this session'],
      progress_toward_goals: 'Made measurable progress',
      client_response_to_treatment: 'Responded positively',
      data_point_scope: 'all',
      link_unlinked_data: false,
      bt_signature: { method: 'typed', value: 'Jordan BT' },
    });
  });
});
