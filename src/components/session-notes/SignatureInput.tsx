import { useMemo, useRef, type PointerEvent } from 'react';

import type { BtAbaSessionNoteResponses } from '../../lib/bt-aba-session-note';

type SignatureValue = BtAbaSessionNoteResponses['bt_signature'];
type SignaturePoint = [number, number] | null;

export type SignatureInputProps = {
  value: SignatureValue;
  onChange: (value: SignatureValue) => void;
  disabled?: boolean;
  error?: string;
};

const MAX_POINTS = 256;
const PREFIX = 'points:';

const parsePoints = (value: string): SignaturePoint[] => {
  if (!value.startsWith(PREFIX)) return [];
  try {
    const parsed = JSON.parse(value.slice(PREFIX.length));
    if (!Array.isArray(parsed)) return [];
    return parsed.slice(0, MAX_POINTS).filter((point): point is SignaturePoint => (
      point === null
      || (Array.isArray(point)
        && point.length === 2
        && point.every((coordinate) => typeof coordinate === 'number' && coordinate >= 0 && coordinate <= 1))
    ));
  } catch {
    return [];
  }
};

const serializePoints = (points: SignaturePoint[]) => `${PREFIX}${JSON.stringify(points.slice(-MAX_POINTS))}`;
const clamp = (value: number) => Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;

export function SignatureInput({ value, onChange, disabled = false, error }: SignatureInputProps) {
  const drawing = useRef(false);
  const activePoints = useRef<SignaturePoint[]>(parsePoints(value.method === 'drawn' ? value.value : ''));
  const points = useMemo(
    () => parsePoints(value.method === 'drawn' ? value.value : ''),
    [value],
  );
  const strokes = useMemo(() => points.reduce<Array<Array<[number, number]>>>((result, point) => {
    if (point === null) {
      if (result.at(-1)?.length) result.push([]);
      return result;
    }
    if (!result.length) result.push([]);
    result.at(-1)?.push(point);
    return result;
  }, []).filter((stroke) => stroke.length), [points]);

  const selectMethod = (method: SignatureValue['method']) => {
    if (disabled || method === value.method) return;
    activePoints.current = [];
    onChange({ method, value: '' });
  };

  const pointFromEvent = (event: PointerEvent<HTMLDivElement>): [number, number] => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const width = Math.max(bounds.width, 1);
    const height = Math.max(bounds.height, 1);
    return [clamp((event.clientX - bounds.left) / width), clamp((event.clientY - bounds.top) / height)];
  };

  const startDrawing = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || value.method !== 'drawn') return;
    drawing.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    activePoints.current = [...points, ...(points.length ? [null] : []), pointFromEvent(event)].slice(-MAX_POINTS);
    onChange({ method: 'drawn', value: serializePoints(activePoints.current) });
  };

  const continueDrawing = (event: PointerEvent<HTMLDivElement>) => {
    if (!drawing.current || disabled || value.method !== 'drawn') return;
    activePoints.current = [...activePoints.current, pointFromEvent(event)].slice(-MAX_POINTS);
    onChange({ method: 'drawn', value: serializePoints(activePoints.current) });
  };

  const stopDrawing = () => {
    if (!drawing.current) return;
    drawing.current = false;
    activePoints.current = [...activePoints.current, null].slice(-MAX_POINTS);
    onChange({ method: 'drawn', value: serializePoints(activePoints.current) });
  };

  return (
    <section aria-labelledby="bt-signature-heading" className="space-y-3">
      <h3 id="bt-signature-heading" className="text-base font-semibold text-gray-900 dark:text-gray-100">
        Behavior Technician Signature
      </h3>
      <fieldset className="flex flex-wrap gap-4" aria-invalid={error ? 'true' : undefined}>
        <legend className="sr-only">Signature input method</legend>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            type="radio"
            name="bt-signature-method"
            checked={value.method === 'drawn'}
            disabled={disabled}
            onChange={() => selectMethod('drawn')}
          />
          Draw signature
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-200">
          <input
            type="radio"
            name="bt-signature-method"
            checked={value.method === 'typed'}
            disabled={disabled}
            onChange={() => selectMethod('typed')}
          />
          Type signature
        </label>
      </fieldset>

      {value.method === 'drawn' ? (
        <div
          role="application"
          aria-label="Draw Behavior Technician signature"
          aria-disabled={disabled ? 'true' : undefined}
          aria-invalid={error ? 'true' : undefined}
          aria-describedby={error ? 'bt-signature-error' : undefined}
          data-field="bt_signature"
          className="h-32 w-full touch-none rounded-md border border-gray-300 bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600"
          tabIndex={disabled ? -1 : 0}
          onPointerDown={startDrawing}
          onPointerMove={continueDrawing}
          onPointerUp={stopDrawing}
          onPointerCancel={stopDrawing}
        >
          <svg viewBox="0 0 300 120" className="h-full w-full" aria-hidden="true">
            {strokes.map((stroke, index) => (
              <polyline
                key={index}
                data-testid="signature-stroke"
                points={stroke.map(([x, y]) => `${x * 300},${y * 120}`).join(' ')}
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              />
            ))}
          </svg>
        </div>
      ) : (
        <div>
          <label htmlFor="bt-typed-signature" className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">
            Type Behavior Technician signature
          </label>
          <input
            id="bt-typed-signature"
            data-field="bt_signature"
            value={value.value}
            disabled={disabled}
            aria-invalid={error ? 'true' : undefined}
            aria-describedby={error ? 'bt-signature-error' : undefined}
            onChange={(event) => onChange({ method: 'typed', value: event.target.value.slice(0, 200) })}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-gray-900 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-100"
          />
        </div>
      )}

      {error && <p id="bt-signature-error" role="alert" className="text-sm text-red-600">{error}</p>}
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          activePoints.current = [];
          onChange({ method: value.method, value: '' });
        }}
        className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800"
      >
        Clear signature
      </button>
    </section>
  );
}
