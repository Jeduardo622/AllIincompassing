import React, { useMemo, useState } from 'react';
import toast from 'react-hot-toast';

import { edgeInvoke } from '../lib/edgeInvoke';
import { logger } from '../lib/logger/logger';

type TemplateKey = 'ER' | 'FBA' | 'PR';

type FieldRow = { key: string; value: string };

type FillDocsResponse = {
  success: true;
  template: TemplateKey;
  filename: string;
  contentType: string;
  base64: string;
};

const TEMPLATE_LABELS: Record<TemplateKey, string> = {
  ER: 'ER (Updated ER - IEHP)',
  FBA: 'FBA (Updated FBA - IEHP)',
  PR: 'PR (Updated PR - IEHP)',
};

const SUGGESTED_FIELDS: ReadonlyArray<{ key: string; label: string; placeholder: string }> = [
  { key: 'CLIENT_NAME', label: 'Client name', placeholder: 'Jane Doe' },
  { key: 'CLIENT_DOB', label: 'Client DOB', placeholder: 'YYYY-MM-DD' },
  { key: 'THERAPIST_NAME', label: 'Therapist name', placeholder: 'Therapist Full Name' },
  { key: 'SERVICE_DATE', label: 'Service date', placeholder: 'YYYY-MM-DD' },
  { key: 'START_TIME', label: 'Start time', placeholder: '09:00 AM' },
  { key: 'END_TIME', label: 'End time', placeholder: '11:00 AM' },
  { key: 'LOCATION', label: 'Location', placeholder: 'Clinic / Home / Telehealth' },
  { key: 'SUMMARY', label: 'Summary', placeholder: 'Brief summary...' },
];

function downloadBase64File(params: { base64: string; filename: string; contentType: string }) {
  const binary = atob(params.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: params.contentType });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = params.filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
}

export default function FillDocs() {
  const [template, setTemplate] = useState<TemplateKey>('ER');
  const [rows, setRows] = useState<FieldRow[]>(() => SUGGESTED_FIELDS.map((item) => ({ key: item.key, value: '' })));
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fieldsObject = useMemo(() => {
    const out: Record<string, string> = {};
    for (const row of rows) {
      const k = row.key.trim();
      if (!k) continue;
      out[k] = row.value ?? '';
    }
    return out;
  }, [rows]);

  const addRow = () => setRows((prev) => [...prev, { key: '', value: '' }]);

  const removeRow = (index: number) => setRows((prev) => prev.filter((_, i) => i !== index));

  const updateRow = (index: number, patch: Partial<FieldRow>) => setRows((prev) => prev.map((row, i) => (i === index ? { ...row, ...patch } : row)));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setIsSubmitting(true);

    try {
      const { data, error, status } = await edgeInvoke<FillDocsResponse>('fill-docs', {
        body: { template, fields: fieldsObject },
      });

      if (error || !data?.success) {
        const message = error?.message || `Failed to fill document (status ${status})`;
        toast.error(message);
        logger.error('FillDocs invoke failed', {
          error,
          context: { component: 'FillDocs', operation: 'edgeInvoke' },
          metadata: { status, template },
        });
        return;
      }

      downloadBase64File({
        base64: data.base64,
        filename: data.filename,
        contentType: data.contentType,
      });
      toast.success('Document generated');
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      toast.error(error.message);
      logger.error('FillDocs submit crashed', {
        error,
        context: { component: 'FillDocs', operation: 'handleSubmit' },
        metadata: { template },
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Fill Docs</h1>
        <p className="text-sm text-gray-600 dark:text-gray-300 mt-1">
          Uses the attached Word templates and replaces placeholders like <code>{'{{CLIENT_NAME}}'}</code>.
        </p>
      </div>

      <div className="bg-white dark:bg-dark-lighter rounded-lg shadow p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="template" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
              Template
            </label>
            <select
              id="template"
              value={template}
              onChange={(e) => setTemplate(e.target.value as TemplateKey)}
              className="mt-1 block w-full rounded-md border-gray-300 dark:border-gray-700 dark:bg-dark dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
            >
              {(['ER', 'FBA', 'PR'] as const).map((key) => (
                <option key={key} value={key}>
                  {TEMPLATE_LABELS[key]}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between">
              <div className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                Fields
              </div>
              <button
                type="button"
                onClick={addRow}
                className="text-sm text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300"
              >
                Add field
              </button>
            </div>
            <div className="mt-3 space-y-3">
              {rows.map((row, index) => (
                <div key={`${row.key}-${index}`} className="grid grid-cols-1 md:grid-cols-12 gap-3">
                  <div className="md:col-span-4">
                    <input
                      type="text"
                      value={row.key}
                      onChange={(e) => updateRow(index, { key: e.target.value })}
                      placeholder="PLACEHOLDER_KEY (e.g., CLIENT_NAME)"
                      className="block w-full rounded-md border-gray-300 dark:border-gray-700 dark:bg-dark dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>
                  <div className="md:col-span-7">
                    <input
                      type="text"
                      value={row.value}
                      onChange={(e) => updateRow(index, { value: e.target.value })}
                      placeholder={SUGGESTED_FIELDS.find((f) => f.key === row.key)?.placeholder ?? 'Value'}
                      className="block w-full rounded-md border-gray-300 dark:border-gray-700 dark:bg-dark dark:text-white shadow-sm focus:border-blue-500 focus:ring-blue-500"
                    />
                  </div>
                  <div className="md:col-span-1 flex items-center">
                    <button
                      type="button"
                      onClick={() => removeRow(index)}
                      className="text-sm text-red-600 dark:text-red-400 hover:text-red-800 dark:hover:text-red-300"
                      aria-label="Remove field"
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-4 text-xs text-gray-500 dark:text-gray-400">
              Tip: placeholders in the Word docs must be literal text like <code>{'{{CLIENT_NAME}}'}</code>.
            </div>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={isSubmitting}
              className={`px-4 py-2 rounded-md text-white ${
                isSubmitting ? 'bg-gray-400 cursor-not-allowed' : 'bg-blue-600 hover:bg-blue-700'
              }`}
            >
              {isSubmitting ? 'Generating…' : 'Generate .docx'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

