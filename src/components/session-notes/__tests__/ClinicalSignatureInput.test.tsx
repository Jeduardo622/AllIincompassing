import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ClinicalSignatureInput } from '../ClinicalSignatureInput';

const pointerEvent = (type: string, clientX: number, clientY: number) =>
  new MouseEvent(type, { bubbles: true, clientX, clientY });

describe('ClinicalSignatureInput', () => {
  it('captures a typed BCBA signature with configurable labels', () => {
    const onChange = vi.fn();

    render(
      <ClinicalSignatureInput
        heading="BCBA Signature"
        typedLabel="Type BCBA signature"
        drawLabel="Draw BCBA signature"
        fieldKey="bcba_supervisor_signature"
        value={{ method: 'typed', value: '' }}
        onChange={onChange}
      />,
    );

    fireEvent.change(screen.getByLabelText('Type BCBA signature'), { target: { value: 'Test BCBA' } });

    expect(onChange).toHaveBeenCalledWith({ method: 'typed', value: 'Test BCBA' });
  });

  it('serializes normalized drawn points and clears them', () => {
    const onChange = vi.fn();

    render(
      <ClinicalSignatureInput
        heading="BCBA Signature"
        typedLabel="Type BCBA signature"
        drawLabel="Draw BCBA signature"
        fieldKey="bcba_supervisor_signature"
        value={{ method: 'drawn', value: '' }}
        onChange={onChange}
      />,
    );

    const pad = screen.getByRole('application', { name: 'Draw BCBA signature' });
    Object.defineProperty(pad, 'getBoundingClientRect', {
      value: () => ({ left: 10, top: 20, width: 300, height: 120, right: 310, bottom: 140, x: 10, y: 20, toJSON: () => ({}) }),
    });

    fireEvent(pad, pointerEvent('pointerdown', -100, -100));
    fireEvent(pad, pointerEvent('pointerup', 500, 500));

    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ method: 'drawn' }));

    fireEvent.click(screen.getByRole('button', { name: 'Clear signature' }));

    expect(onChange).toHaveBeenLastCalledWith({ method: 'drawn', value: '' });
  });
});
