'use client';

import { REGEXP_ONLY_DIGITS } from 'input-otp';
import { InputOTP, InputOTPGroup, InputOTPSlot } from '@/components/ui/input-otp';

/** Six-digit code entry. Pasting a whole code works, and a complete code calls onComplete. */
export function CodeInput({
  id,
  value,
  onChange,
  onComplete,
  disabled,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onComplete: (code: string) => void;
  disabled?: boolean;
  describedBy?: string;
}) {
  return (
    <InputOTP
      id={id}
      maxLength={6}
      pattern={REGEXP_ONLY_DIGITS}
      inputMode="numeric"
      autoComplete="one-time-code"
      value={value}
      onChange={onChange}
      onComplete={onComplete}
      disabled={disabled}
      aria-describedby={describedBy}
    >
      <InputOTPGroup>
        {Array.from({ length: 6 }, (_, index) => (
          <InputOTPSlot key={index} index={index} className="size-11 text-lg" />
        ))}
      </InputOTPGroup>
    </InputOTP>
  );
}
