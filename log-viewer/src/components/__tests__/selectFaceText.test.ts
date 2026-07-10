/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { selectFaceText } from '../selectFaceText.js';

describe('selectFaceText', () => {
  it('shows the placeholder muted when there is no value', () => {
    expect(
      selectFaceText({ prefix: 'Group', placeholder: 'Group by', value: '', emptyValue: 'None' }),
    ).toEqual({ prefixText: '', valueText: 'Group by', active: false });
  });

  it('treats the empty value as inactive', () => {
    expect(
      selectFaceText({
        prefix: 'Group',
        placeholder: 'Group by',
        value: 'None',
        emptyValue: 'None',
      }),
    ).toEqual({ prefixText: '', valueText: 'Group by', active: false });
  });

  it('shows `Prefix: Value` when a real value is selected', () => {
    expect(
      selectFaceText({
        prefix: 'Group',
        placeholder: 'Group by',
        value: 'Namespace',
        emptyValue: 'None',
      }),
    ).toEqual({ prefixText: 'Group:', valueText: 'Namespace', active: true });
  });

  it('omits the colon when no prefix is given', () => {
    expect(
      selectFaceText({ prefix: '', placeholder: 'Type', value: 'Apex Code', emptyValue: 'None' }),
    ).toEqual({ prefixText: '', valueText: 'Apex Code', active: true });
  });
});
