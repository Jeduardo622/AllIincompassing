import type { BtAbaSessionNoteResponses } from '../../lib/bt-aba-session-note';
import { ClinicalSignatureInput } from './ClinicalSignatureInput';

type SignatureValue = BtAbaSessionNoteResponses['bt_signature'];

export type SignatureInputProps = {
  value: SignatureValue;
  onChange: (value: SignatureValue) => void;
  disabled?: boolean;
  error?: string;
};

export function SignatureInput({ value, onChange, disabled = false, error }: SignatureInputProps) {
  return (
    <ClinicalSignatureInput
      heading="Behavior Technician Signature"
      typedLabel="Type Behavior Technician signature"
      drawLabel="Draw Behavior Technician signature"
      fieldKey="bt_signature"
      value={value}
      onChange={onChange}
      disabled={disabled}
      error={error}
    />
  );
}
