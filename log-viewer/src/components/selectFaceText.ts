/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

export interface FaceText {
  prefixText: string;
  valueText: string;
  active: boolean;
}

/**
 * Trigger text for a select face. Inactive (no value, or the empty value) shows the
 * placeholder muted; active shows `Prefix: Value` with the value emphasized.
 */
export function selectFaceText(opts: {
  prefix: string;
  placeholder: string;
  value: string;
  emptyValue: string;
}): FaceText {
  const { prefix, placeholder, value, emptyValue } = opts;
  const active = !!value && value !== emptyValue;
  return active
    ? { prefixText: prefix ? `${prefix}:` : '', valueText: value, active: true }
    : { prefixText: '', valueText: placeholder, active: false };
}
