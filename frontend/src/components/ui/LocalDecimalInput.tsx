import { useEffect, useState, type InputHTMLAttributes } from 'react';
import { formatLocalDecimal, parseLocalDecimal, type LocalDecimalKind } from '@/lib/format';

interface Props extends Omit<InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'type' | 'value'> {
  value: string;
  kind: LocalDecimalKind;
  onChange: (value: string) => void;
}

export function LocalDecimalInput({ value, kind, onChange, onBlur, onFocus, ...props }: Props) {
  const [focused, setFocused] = useState(false);
  const [displayValue, setDisplayValue] = useState(() => formatLocalDecimal(value, kind));

  useEffect(() => {
    if (!focused) setDisplayValue(formatLocalDecimal(value, kind));
  }, [focused, kind, value]);

  return (
    <input
      {...props}
      type="text"
      inputMode="decimal"
      value={displayValue}
      onFocus={(event) => {
        setFocused(true);
        onFocus?.(event);
      }}
      onChange={(event) => {
        const next = event.target.value;
        setDisplayValue(next);
        onChange(parseLocalDecimal(next));
      }}
      onBlur={(event) => {
        const normalized = parseLocalDecimal(displayValue);
        onChange(normalized);
        setDisplayValue(formatLocalDecimal(normalized, kind));
        setFocused(false);
        onBlur?.(event);
      }}
    />
  );
}
