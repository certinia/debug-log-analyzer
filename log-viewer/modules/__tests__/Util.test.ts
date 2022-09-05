/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
import formatDuration, { showTab } from '../Util';

jest.mock('../Browser', () => ({
  decodeEntities: (text: string) => {
    return text.replace(/&amp;/gim, '&');
  },
}));

describe('Format duration tests', () => {
  it('Value converted from nanoseconds to milliseconds', () => {
    expect(formatDuration(1000)).toBe('0.001ms');
  });
  it('Value always has 3dp', () => {
    expect(formatDuration(1000000)).toBe('1.000ms');
  });
  it('Value truncated at 3dp', () => {
    expect(formatDuration(1234567)).toBe('1.234ms');
  });
});

describe('Show Tab tests', () => {
  it('Moves the selected class to the secified tab and its view', () => {
    document.body.innerHTML =
      '<div class="tabHolder">' +
      '<div class="tab" id="tab1" data-show="view1">V1</div>' +
      '<div class="tab selected" id="tab2" data-show="view2">V2</div>' +
      '</div>' +
      '<div class="tabber">' +
      '<div id="view1" class="tabItem">' +
      '<div id="view2" class="tabItem selected">' +
      '</div>';
    showTab('tab1');
    expect(document.getElementById('tab1')?.classList.contains('selected')).toBe(true);
    expect(document.getElementById('tab2')?.classList.contains('selected')).toBe(false);
    expect(document.getElementById('view1')?.classList.contains('selected')).toBe(true);
    expect(document.getElementById('view2')?.classList.contains('selected')).toBe(false);
  });
});
