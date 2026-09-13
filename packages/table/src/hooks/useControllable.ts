import { useCallback, useState } from 'react';

/**
 * Standard controlled/uncontrolled state helper for array-valued props.
 *
 * When a controlled value is provided we only notify the caller. Without one,
 * the hook owns local state and mirrors the same callback contract.
 */
export function useControllableKeys<Key>(
  value: Key[] | undefined,
  defaultValue: Key[] | undefined,
  onChange: ((keys: Key[]) => void) | undefined,
) {
  const [internal, setInternal] = useState<Key[]>(defaultValue ?? []);
  const keys = value === undefined ? internal : value;
  const setKeys = useCallback((next: Key[]) => {
    if (value === undefined) setInternal(next);
    onChange?.(next);
  }, [onChange, value]);
  return [keys, setKeys] as const;
}

/**
 * Controlled/uncontrolled helper for nullable single-value state.
 */
export function useControllableValue<Value>(
  value: Value | null | undefined,
  defaultValue: Value | null | undefined,
  onChange: ((value: Value | null) => void) | undefined,
) {
  const [internal, setInternal] = useState<Value | null>(defaultValue ?? null);
  const selected = value === undefined ? internal : value;
  const setSelected = useCallback((next: Value | null) => {
    if (value === undefined) setInternal(next);
    onChange?.(next);
  }, [onChange, value]);
  return [selected, setSelected] as const;
}
