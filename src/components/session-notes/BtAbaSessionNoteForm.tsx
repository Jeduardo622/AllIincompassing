import { useEffect, useRef, useState } from 'react';

import {
  BT_ABA_BEHAVIOR_STRATEGY_OPTIONS,
  BT_ABA_FIELD_LABELS,
  BT_ABA_PURPOSE_OPTIONS,
  BT_ABA_SKILL_STRATEGY_OPTIONS,
  BT_ABA_SUPERVISOR_SUPPORT_OPTIONS,
  validateBtAbaSessionNoteResponses,
  type BtAbaSessionNoteResponses,
} from '../../lib/bt-aba-session-note';
import { SignatureInput } from './SignatureInput';

export type BtAbaSessionNoteContext = {
  sessionId: string;
  clientName: string;
  behaviorTechnicianName: string;
  serviceDate: string;
  sessionTime: string;
  placeOfService: string;
  billingCode: string;
  modifiers: string[];
  programs: Array<{ name: string; goals: string[] }>;
  collectedDataPointCount: number;
  linkedDataPoints: Array<{ label: string; value: string | number }>;
  allDataPoints: Array<{ label: string; value: string | number }>;
  collectedBy: string;
};

export type BtAbaSessionNoteFormProps = {
  initialResponses: BtAbaSessionNoteResponses;
  context: BtAbaSessionNoteContext;
  onSaveDraft: (responses: BtAbaSessionNoteResponses) => void | Promise<void>;
  onFinalize: (responses: BtAbaSessionNoteResponses) => void | Promise<void>;
  busy: boolean;
};

type ResponseKey = keyof BtAbaSessionNoteResponses;
type Errors = Partial<Record<ResponseKey, string>>;

const inputClass = 'w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100';
const sectionClass = 'space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700';

type CheckboxGroupProps = {
  field: 'purpose_of_session' | 'skill_strategies' | 'behavior_strategies' | 'supervisor_support';
  label: string;
  options: readonly string[];
  values: string[];
  disabled: boolean;
  error?: string;
  onToggle: (option: string, checked: boolean) => void;
};

function CheckboxGroup({ field, label, options, values, disabled, error, onToggle }: CheckboxGroupProps) {
  return (
    <fieldset className="space-y-2" aria-invalid={error ? 'true' : undefined} aria-describedby={error ? `${field}-error` : undefined}>
      <legend className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option, index) => (
          <label key={option} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input
              ref={index === 0 ? (element) => { if (element) element.dataset.field = field; } : undefined}
              type="checkbox"
              checked={values.includes(option)}
              disabled={disabled}
              onChange={(event) => onToggle(option, event.target.checked)}
              className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span>{option}</span>
          </label>
        ))}
      </div>
      {error && <p id={`${field}-error`} role="alert" className="text-sm text-red-600">{error}</p>}
    </fieldset>
  );
}

export function BtAbaSessionNoteForm({ initialResponses, context, onSaveDraft, onFinalize, busy }: BtAbaSessionNoteFormProps) {
  const [responses, setResponses] = useState<BtAbaSessionNoteResponses>(initialResponses);
  const [errors, setErrors] = useState<Errors>({});
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    setResponses(initialResponses);
  }, [initialResponses]);

  const setField = <Key extends ResponseKey>(field: Key, value: BtAbaSessionNoteResponses[Key]) => {
    setResponses((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };

  const toggleSelection = (
    field: CheckboxGroupProps['field'],
    option: string,
    checked: boolean,
  ) => {
    const current = responses[field];
    let next: string[];
    if (!checked) {
      next = current.filter((value) => value !== option);
    } else if (option === 'N/A') {
      next = ['N/A'];
    } else {
      next = [...current.filter((value) => value !== 'N/A' && value !== option), option];
    }
    setField(field, next);

    if (option === 'Other' && !checked) {
      const otherKey = {
        purpose_of_session: 'purpose_other',
        skill_strategies: 'skill_strategies_other',
        behavior_strategies: 'behavior_strategies_other',
        supervisor_support: 'supervisor_support_other',
      }[field] as keyof BtAbaSessionNoteResponses;
      setField(otherKey, undefined);
    }
  };

  const finalize = () => {
    const result = validateBtAbaSessionNoteResponses(responses);
    if (result.success) {
      setErrors({});
      void onFinalize(result.data);
      return;
    }

    const nextErrors: Errors = {};
    for (const issue of result.error.issues) {
      const field = issue.path[0] as ResponseKey | undefined;
      if (field && !nextErrors[field]) {
        const requiredMessage: Partial<Record<ResponseKey, string>> = {
          purpose_of_session: 'Purpose of Session is required',
          client_status: 'Client Status is required',
          skill_strategies: 'Skill Strategies is required',
          behavior_strategies: 'Behavior Strategies is required',
          supervisor_support: 'Supervisor Support and Discussion Included is required',
          progress_toward_goals: 'Summary of Progress Toward Treatment Goals is required',
          client_response_to_treatment: "Client's Response to Treatment is required",
          bt_signature: 'Behavior Technician signature is required',
        };
        nextErrors[field] = issue.code === 'too_small' ? requiredMessage[field] ?? issue.message : issue.message;
      }
    }
    setErrors(nextErrors);
    const firstField = result.error.issues[0]?.path[0];
    if (firstField) {
      formRef.current?.querySelector<HTMLElement>(`[data-field="${String(firstField)}"]`)?.focus();
    }
  };

  const renderOther = (
    group: CheckboxGroupProps['field'],
    otherField: 'purpose_other' | 'skill_strategies_other' | 'behavior_strategies_other' | 'supervisor_support_other',
    label: string,
  ) => responses[group].includes('Other') ? (
    <div>
      <label htmlFor={otherField} className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{label}</label>
      <input
        id={otherField}
        data-field={otherField}
        value={responses[otherField] ?? ''}
        disabled={busy}
        aria-invalid={errors[otherField] ? 'true' : undefined}
        aria-describedby={errors[otherField] ? `${otherField}-error` : undefined}
        onChange={(event) => setField(otherField, event.target.value)}
        className={inputClass}
      />
      {errors[otherField] && <p id={`${otherField}-error`} role="alert" className="text-sm text-red-600">{errors[otherField]}</p>}
    </div>
  ) : null;

  const contextRows = [
    ['Session ID', context.sessionId],
    ['Client', context.clientName],
    ['Behavior Technician', context.behaviorTechnicianName],
    ['Service Date', context.serviceDate],
    ['Session Time', context.sessionTime],
    ['Place of Service', context.placeOfService],
    ['Billing Code', context.billingCode],
    ...Array.from({ length: 4 }, (_, index) => [`Modifier ${index + 1}`, context.modifiers[index] ?? 'None']),
  ];
  const previewDataPoints = responses.data_point_scope === 'all'
    ? context.allDataPoints
    : context.linkedDataPoints;

  return (
    <form ref={formRef} onSubmit={(event) => event.preventDefault()} className="space-y-6" noValidate>
      <header>
        <h2 className="text-xl font-semibold text-gray-900 dark:text-gray-100">ABA Session Note</h2>
        <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">Review the session context, complete the note, and sign before finalizing.</p>
      </header>

      <section aria-labelledby="session-context-heading" className={sectionClass}>
        <h3 id="session-context-heading" className="text-base font-semibold text-gray-900 dark:text-gray-100">Session and Billing Context</h3>
        <dl className="grid gap-3 sm:grid-cols-2">
          {contextRows.map(([label, value]) => (
            <div key={label}>
              <dt className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{label}</dt>
              <dd className="text-sm text-gray-900 dark:text-gray-100">{value}</dd>
            </div>
          ))}
        </dl>
        <div>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-200">Programs and Goals</h4>
          <ul className="mt-1 space-y-1 text-sm text-gray-900 dark:text-gray-100">
            {context.programs.flatMap((program) => program.goals.map((goal) => (
              <li key={`${program.name}-${goal}`}>{program.name} — {goal}</li>
            )))}
          </ul>
        </div>
      </section>

      <section className={sectionClass}>
        <CheckboxGroup field="purpose_of_session" label={BT_ABA_FIELD_LABELS.purpose_of_session} options={BT_ABA_PURPOSE_OPTIONS} values={responses.purpose_of_session} disabled={busy} error={errors.purpose_of_session} onToggle={(option, checked) => toggleSelection('purpose_of_session', option, checked)} />
        {renderOther('purpose_of_session', 'purpose_other', 'Describe other purpose')}
      </section>

      <section aria-labelledby="interventions-heading" className={sectionClass}>
        <h3 id="interventions-heading" className="text-base font-semibold text-gray-900 dark:text-gray-100">Interventions and Strategies Used</h3>
        <div>
          <label htmlFor="client-status" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{BT_ABA_FIELD_LABELS.client_status}</label>
          <textarea id="client-status" data-field="client_status" rows={3} value={responses.client_status} disabled={busy} aria-invalid={errors.client_status ? 'true' : undefined} aria-describedby={errors.client_status ? 'client-status-error' : undefined} onChange={(event) => setField('client_status', event.target.value)} className={inputClass} />
          {errors.client_status && <p id="client-status-error" role="alert" className="text-sm text-red-600">{errors.client_status}</p>}
        </div>
        <CheckboxGroup field="skill_strategies" label={BT_ABA_FIELD_LABELS.skill_strategies} options={BT_ABA_SKILL_STRATEGY_OPTIONS} values={responses.skill_strategies} disabled={busy} error={errors.skill_strategies} onToggle={(option, checked) => toggleSelection('skill_strategies', option, checked)} />
        {renderOther('skill_strategies', 'skill_strategies_other', 'Describe other skill strategy')}
        <CheckboxGroup field="behavior_strategies" label={BT_ABA_FIELD_LABELS.behavior_strategies} options={BT_ABA_BEHAVIOR_STRATEGY_OPTIONS} values={responses.behavior_strategies} disabled={busy} error={errors.behavior_strategies} onToggle={(option, checked) => toggleSelection('behavior_strategies', option, checked)} />
        {renderOther('behavior_strategies', 'behavior_strategies_other', 'Describe other behavior strategy')}
      </section>

      <section aria-labelledby="clinical-summary-heading" className={sectionClass}>
        <h3 id="clinical-summary-heading" className="text-base font-semibold text-gray-900 dark:text-gray-100">Supervision and Clinical Summary</h3>
        <CheckboxGroup field="supervisor_support" label={BT_ABA_FIELD_LABELS.supervisor_support} options={BT_ABA_SUPERVISOR_SUPPORT_OPTIONS} values={responses.supervisor_support} disabled={busy} error={errors.supervisor_support} onToggle={(option, checked) => toggleSelection('supervisor_support', option, checked)} />
        {renderOther('supervisor_support', 'supervisor_support_other', 'Describe other supervisor support')}
        <div>
          <label htmlFor="progress-toward-goals" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{BT_ABA_FIELD_LABELS.progress_toward_goals}</label>
          <textarea id="progress-toward-goals" data-field="progress_toward_goals" rows={4} value={responses.progress_toward_goals} disabled={busy} aria-invalid={errors.progress_toward_goals ? 'true' : undefined} aria-describedby={errors.progress_toward_goals ? 'progress-error' : undefined} onChange={(event) => setField('progress_toward_goals', event.target.value)} className={inputClass} />
          {errors.progress_toward_goals && <p id="progress-error" role="alert" className="text-sm text-red-600">{errors.progress_toward_goals}</p>}
        </div>
        <div>
          <label htmlFor="client-response" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{BT_ABA_FIELD_LABELS.client_response_to_treatment}</label>
          <textarea id="client-response" data-field="client_response_to_treatment" rows={4} value={responses.client_response_to_treatment} disabled={busy} aria-invalid={errors.client_response_to_treatment ? 'true' : undefined} aria-describedby={errors.client_response_to_treatment ? 'response-error' : undefined} onChange={(event) => setField('client_response_to_treatment', event.target.value)} className={inputClass} />
          {errors.client_response_to_treatment && <p id="response-error" role="alert" className="text-sm text-red-600">{errors.client_response_to_treatment}</p>}
        </div>
      </section>

      <section aria-labelledby="daily-summary-heading" className={sectionClass}>
        <h3 id="daily-summary-heading" className="text-base font-semibold text-gray-900 dark:text-gray-100">Daily Summary Sheet</h3>
        <p className="text-sm text-gray-600 dark:text-gray-300">{context.collectedDataPointCount} collected data points</p>
        <p className="text-sm text-gray-600 dark:text-gray-300">Collected By: {context.collectedBy}</p>
        <div aria-label="Included data point preview" className="rounded-md bg-gray-50 p-3 dark:bg-gray-800">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-200">Included Data Preview</h4>
          {previewDataPoints.length ? (
            <ul className="mt-1 space-y-1 text-sm text-gray-700 dark:text-gray-200">
              {previewDataPoints.map((dataPoint, index) => (
                <li key={`${dataPoint.label}-${index}`}>{dataPoint.label}: {dataPoint.value}</li>
              ))}
            </ul>
          ) : <p className="mt-1 text-sm text-gray-500">No collected data points are available.</p>}
        </div>
        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold text-gray-900 dark:text-gray-100">{BT_ABA_FIELD_LABELS.data_point_scope}</legend>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="radio" name="data-point-scope" checked={responses.data_point_scope === 'linked'} disabled={busy} onChange={() => setField('data_point_scope', 'linked')} /> Include only linked data points</label>
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200"><input type="radio" name="data-point-scope" checked={responses.data_point_scope === 'all'} disabled={busy} onChange={() => setField('data_point_scope', 'all')} /> Include all data points</label>
        </fieldset>
        <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input type="checkbox" checked={responses.link_unlinked_data} disabled={busy} onChange={(event) => setField('link_unlinked_data', event.target.checked)} className="mt-0.5" />
          Link unlinked data for this service date
        </label>
      </section>

      <section className={sectionClass}>
        <SignatureInput value={responses.bt_signature} disabled={busy} error={errors.bt_signature} onChange={(signature) => setField('bt_signature', signature)} />
      </section>

      <div className="flex flex-col-reverse gap-3 border-t border-gray-200 pt-4 sm:flex-row sm:justify-end dark:border-gray-700">
        <button type="button" disabled={busy} onClick={() => void onSaveDraft(responses)} className="rounded-md border border-gray-300 px-4 py-2 font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800">Save Draft</button>
        <button type="button" disabled={busy} onClick={finalize} className="rounded-md bg-blue-600 px-4 py-2 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">Finalize Session</button>
      </div>
    </form>
  );
}
