import type {
  ClinicalSignatureValue,
  SupervisionTemplateField,
  SupervisionTemplateSection,
} from '../../lib/supervision-session-notes';
import { ClinicalSignatureInput } from './ClinicalSignatureInput';

export type BtCorrectionSnapshotResponses = Record<string, unknown>;

type Props = {
  sections: SupervisionTemplateSection[];
  responses: BtCorrectionSnapshotResponses;
  errors: Record<string, string | undefined>;
  disabled?: boolean;
  onChange: (responses: BtCorrectionSnapshotResponses) => void;
};

const SUPPORTED_FIELD_TYPES = new Set(['multi_select', 'radio', 'text', 'textarea', 'boolean', 'signature']);

const parseRequiredWhen = (field: SupervisionTemplateField) => {
  const match = field.required_when?.trim().match(/^(.+?)\s+includes\s+(.+)$/i);
  return match ? { dependencyKey: match[1].trim(), expectedValue: match[2].trim() } : null;
};

const conditionMatches = (field: SupervisionTemplateField, responses: BtCorrectionSnapshotResponses) => {
  const condition = parseRequiredWhen(field);
  if (!condition) return true;
  const dependency = responses[condition.dependencyKey];
  return Array.isArray(dependency)
    ? dependency.map(String).includes(condition.expectedValue)
    : String(dependency ?? '').trim() === condition.expectedValue;
};

const hasResponse = (field: SupervisionTemplateField, value: unknown) => {
  if (Array.isArray(value)) return value.length > 0;
  if (field.type === 'boolean' || (field.type === 'checkbox' && !field.options?.length)) return typeof value === 'boolean';
  if (field.type === 'signature') {
    return Boolean(value && typeof value === 'object' && !Array.isArray(value)
      && typeof (value as { value?: unknown }).value === 'string'
      && (value as { value: string }).value.trim());
  }
  return typeof value === 'string' ? value.trim().length > 0 : value != null;
};

const isValidDrawnSignature = (value: string) => {
  if (!value.startsWith('points:') || value.length > 20_000) return false;
  try {
    const points: unknown = JSON.parse(value.slice('points:'.length));
    return Array.isArray(points)
      && points.length > 0
      && points.length <= 256
      && points.some((point) => point !== null)
      && points.every((point) => point === null || (
        Array.isArray(point)
        && point.length === 2
        && point.every((coordinate) => typeof coordinate === 'number'
          && Number.isFinite(coordinate)
          && coordinate >= 0
          && coordinate <= 1)
      ));
  } catch {
    return false;
  }
};

const isValidSignature = (value: unknown): value is ClinicalSignatureValue => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const signature = value as { method?: unknown; value?: unknown };
  if (typeof signature.value !== 'string' || !signature.value.trim()) return false;
  if (signature.method === 'typed') return signature.value.trim().length <= 200;
  return signature.method === 'drawn' && isValidDrawnSignature(signature.value.trim());
};

const isValidStoredFieldValue = (
  field: SupervisionTemplateField,
  value: unknown,
  responses: BtCorrectionSnapshotResponses,
) => {
  if (!SUPPORTED_FIELD_TYPES.has(field.type)) return false;
  if ((field.required || field.required_when) && conditionMatches(field, responses) && !hasResponse(field, value)) {
    return false;
  }
  if (field.type === 'multi_select') {
    if (!Array.isArray(value)) return false;
    const allowedOptions = field.options ?? [];
    if (value.some((option) => typeof option !== 'string' || !allowedOptions.includes(option))) return false;
    const exclusiveOptions = field.exclusive_options ?? [];
    return value.length <= 1 || !value.some((option) => exclusiveOptions.includes(String(option)));
  }
  if (field.type === 'radio') {
    return typeof value === 'string' && (!value || (field.options ?? []).includes(value));
  }
  if (field.type === 'text' || field.type === 'textarea') return typeof value === 'string';
  if (field.type === 'boolean') return typeof value === 'boolean';
  return field.type === 'signature' && isValidSignature(value);
};

export const prepareBtCorrectionSnapshotResponses = (
  sections: SupervisionTemplateSection[],
  source: Record<string, unknown>,
): BtCorrectionSnapshotResponses | null => {
  const prepared: BtCorrectionSnapshotResponses = {};
  const fields = sections.flatMap((section) => section.fields ?? []);
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(source, field.key)
      || !isValidStoredFieldValue(field, source[field.key], source)) {
      return null;
    }
    prepared[field.key] = field.key === 'bt_signature'
      ? { method: 'typed', value: '' } satisfies ClinicalSignatureValue
      : source[field.key];
  }
  return prepared;
};

export const validateBtCorrectionSnapshotResponses = (
  sections: SupervisionTemplateSection[],
  responses: BtCorrectionSnapshotResponses,
) => {
  const errors: Record<string, string> = {};
  const fields = sections.flatMap((section) => section.fields ?? []);
  const sanitizedResponses = Object.fromEntries(
    fields.map((field) => [field.key, responses[field.key]]),
  );

  for (const field of fields) {
    if (!conditionMatches(field, responses)) continue;
    const value = responses[field.key];
    const required = field.required || Boolean(field.required_when);
    const label = field.label ?? field.key;

    if (required && !hasResponse(field, value)) {
      errors[field.key] = `${label} is required`;
      continue;
    }
    if (field.type === 'signature' && !isValidSignature(value)) {
      errors[field.key] = 'Behavior Technician signature is required';
      continue;
    }
    if (field.type === 'multi_select' && Array.isArray(value)) {
      const allowedOptions = field.options ?? [];
      if (value.some((option) => typeof option !== 'string' || !allowedOptions.includes(option))) {
        errors[field.key] = `${label} contains an invalid option`;
        continue;
      }
      const exclusiveOptions = field.exclusive_options ?? [];
      if (value.length > 1 && value.some((option) => exclusiveOptions.includes(String(option)))) {
        errors[field.key] = 'N/A must be selected exclusively';
      }
    }
    if (field.type === 'radio'
      && typeof value === 'string'
      && value
      && !(field.options ?? []).includes(value)) {
      errors[field.key] = `${label} contains an invalid option`;
    }
  }

  return { success: Object.keys(errors).length === 0, errors, responses: sanitizedResponses };
};

export const getBtCorrectionSnapshotSignature = (
  responses: BtCorrectionSnapshotResponses,
): ClinicalSignatureValue => {
  const value = responses.bt_signature;
  return value && typeof value === 'object' && !Array.isArray(value)
    && ((value as { method?: unknown }).method === 'typed' || (value as { method?: unknown }).method === 'drawn')
    && typeof (value as { value?: unknown }).value === 'string'
    ? value as ClinicalSignatureValue
    : { method: 'typed', value: '' };
};

export function BtCorrectionSnapshotFields({
  sections,
  responses,
  errors,
  disabled = false,
  onChange,
}: Props) {
  const setField = (field: SupervisionTemplateField, value: unknown) => {
    const next = { ...responses, [field.key]: value };
    if (field.other_field_key && Array.isArray(value) && !value.includes('Other')) {
      next[field.other_field_key] = '';
    }
    onChange(next);
  };

  const renderField = (field: SupervisionTemplateField) => {
    if (!conditionMatches(field, responses)) return null;
    const label = field.label ?? field.key;
    const fieldId = `bt-correction-${field.key}`;
    const error = errors[field.key];
    const errorId = `${fieldId}-error`;
    const commonClassName = 'w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-700 dark:bg-dark dark:text-white';
    const errorMessage = error ? <p id={errorId} role="alert" className="mt-1 text-sm text-red-600">{error}</p> : null;

    if (field.type === 'signature') {
      return (
        <ClinicalSignatureInput
          key={field.key}
          heading={label}
          typedLabel="Type Behavior Technician signature"
          drawLabel="Draw Behavior Technician signature"
          fieldKey={field.key}
          value={getBtCorrectionSnapshotSignature(responses)}
          onChange={(signature) => setField(field, signature)}
          disabled={disabled}
          error={error}
        />
      );
    }

    if (field.type === 'multi_select') {
      const selected = Array.isArray(responses[field.key]) ? responses[field.key] as string[] : [];
      return (
        <fieldset key={field.key} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? errorId : undefined} className="space-y-2">
          <legend className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(field.options ?? []).map((option, index) => (
              <label key={option} className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
                <input
                  data-field={index === 0 ? field.key : undefined}
                  type="checkbox"
                  checked={selected.includes(option)}
                  disabled={disabled}
                  onChange={(event) => {
                    const exclusive = field.exclusive_options ?? [];
                    const next = event.target.checked
                      ? exclusive.includes(option)
                        ? [option]
                        : [...selected.filter((item) => !exclusive.includes(item) && item !== option), option]
                      : selected.filter((item) => item !== option);
                    setField(field, next);
                  }}
                />
                <span>{option}</span>
              </label>
            ))}
          </div>
          {errorMessage}
        </fieldset>
      );
    }

    if (field.type === 'radio') {
      return (
        <fieldset key={field.key} aria-invalid={error ? 'true' : undefined} aria-describedby={error ? errorId : undefined} className="space-y-2">
          <legend className="text-sm font-semibold text-gray-900 dark:text-gray-100">{label}</legend>
          {(field.options ?? []).map((option, index) => (
            <label key={option} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
              <input
                data-field={index === 0 ? field.key : undefined}
                type="radio"
                name={fieldId}
                checked={responses[field.key] === option}
                disabled={disabled}
                onChange={() => setField(field, option)}
              />
              <span>{option}</span>
            </label>
          ))}
          {errorMessage}
        </fieldset>
      );
    }

    if (field.type === 'boolean' || (field.type === 'checkbox' && !field.options?.length)) {
      return (
        <div key={field.key}>
          <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-200">
            <input
              id={fieldId}
              data-field={field.key}
              type="checkbox"
              checked={responses[field.key] === true}
              disabled={disabled || field.key === 'link_unlinked_data'}
              onChange={(event) => setField(field, event.target.checked)}
            />
            <span>{label}</span>
          </label>
          {errorMessage}
        </div>
      );
    }

    const value = typeof responses[field.key] === 'string' ? responses[field.key] as string : '';
    return (
      <label key={field.key} htmlFor={fieldId} className="block text-sm font-medium text-gray-700 dark:text-gray-200">
        {label}
        {field.type === 'textarea' ? (
          <textarea
            id={fieldId}
            data-field={field.key}
            rows={4}
            value={value}
            disabled={disabled}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => setField(field, event.target.value)}
            className={commonClassName}
          />
        ) : (
          <input
            id={fieldId}
            data-field={field.key}
            value={value}
            disabled={disabled}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => setField(field, event.target.value)}
            className={commonClassName}
          />
        )}
        {errorMessage}
      </label>
    );
  };

  return (
    <>
      {sections.map((section) => (
        <section key={section.key} className="space-y-4 rounded-lg border border-gray-200 p-4 dark:border-gray-700">
          <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">{section.label ?? section.key}</h3>
          <div className="grid gap-4">{(section.fields ?? []).map(renderField)}</div>
        </section>
      ))}
    </>
  );
}
