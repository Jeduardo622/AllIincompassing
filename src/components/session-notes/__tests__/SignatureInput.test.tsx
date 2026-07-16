import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { SignatureInput } from '../SignatureInput';

const pointerEvent = (type: string, clientX: number, clientY: number) =>
  new MouseEvent(type, { bubbles: true, clientX, clientY });

describe('SignatureInput', () => {
  it('supports a typed keyboard fallback and clear/retry', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const Harness = () => {
      const [value, setValue] = useState({ method: 'typed' as const, value: '' });
      return <SignatureInput value={value} onChange={(next) => { onChange(next); setValue(next as typeof value); }} />;
    };
    render(<Harness />);

    await user.type(screen.getByLabelText('Type Behavior Technician signature'), 'Jordan BT');
    expect(onChange).toHaveBeenLastCalledWith({ method: 'typed', value: 'Jordan BT' });

    await user.click(screen.getByRole('button', { name: 'Clear signature' }));
    expect(onChange).toHaveBeenLastCalledWith({ method: 'typed', value: '' });
  });

  it('captures a bounded pointer signature and can clear it for retry', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(<SignatureInput value={{ method: 'drawn', value: '' }} onChange={onChange} />);
    const pad = screen.getByRole('application', { name: 'Draw Behavior Technician signature' });
    Object.defineProperty(pad, 'getBoundingClientRect', {
      value: () => ({ left: 10, top: 20, width: 300, height: 120, right: 310, bottom: 140, x: 10, y: 20, toJSON: () => ({}) }),
    });

    fireEvent(pad, pointerEvent('pointerdown', -100, -100));
    fireEvent(pad, pointerEvent('pointermove', 500, 500));
    fireEvent(pad, pointerEvent('pointerup', 500, 500));

    const signature = onChange.mock.calls.at(-1)?.[0];
    expect(signature.method).toBe('drawn');
    expect(signature.value).toMatch(/^points:/);
    const points = JSON.parse(signature.value.slice('points:'.length)) as Array<[number, number] | null>;
    expect(points.filter(Boolean).every(([x, y]) => x >= 0 && x <= 1 && y >= 0 && y <= 1)).toBe(true);

    rerender(<SignatureInput value={signature} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Clear signature' }));
    expect(onChange).toHaveBeenLastCalledWith({ method: 'drawn', value: '' });
  });

  it('renders separate SVG strokes for separate pointer gestures', () => {
    const Harness = () => {
      const [value, setValue] = useState({ method: 'drawn' as const, value: '' });
      return <SignatureInput value={value} onChange={(next) => setValue(next as typeof value)} />;
    };
    render(<Harness />);
    const pad = screen.getByRole('application', { name: 'Draw Behavior Technician signature' });
    Object.defineProperty(pad, 'getBoundingClientRect', {
      value: () => ({ left: 0, top: 0, width: 300, height: 120, right: 300, bottom: 120, x: 0, y: 0, toJSON: () => ({}) }),
    });

    fireEvent(pad, pointerEvent('pointerdown', 10, 10));
    fireEvent(pad, pointerEvent('pointermove', 20, 20));
    fireEvent(pad, pointerEvent('pointerup', 20, 20));
    fireEvent(pad, pointerEvent('pointerdown', 100, 50));
    fireEvent(pad, pointerEvent('pointermove', 120, 60));
    fireEvent(pad, pointerEvent('pointerup', 120, 60));

    expect(screen.getAllByTestId('signature-stroke')).toHaveLength(2);
  });

  it('disables every signature control while busy', () => {
    render(<SignatureInput value={{ method: 'typed', value: '' }} onChange={vi.fn()} disabled />);

    expect(screen.getByLabelText('Type Behavior Technician signature')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Clear signature' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Draw signature' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Type signature' })).toBeDisabled();
  });
});
