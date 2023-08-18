/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 * @jest-environment jsdom
 */
import formatDuration, { showTab } from '../Util';

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
      '<div class="tab-holder">' +
      '<div class="tab" id="tab1" data-show="view1">V1</div>' +
      '<div class="tab tab--selected" id="tab2" data-show="view2">V2</div>' +
      '</div>' +
      '<div class="tabber">' +
      '<div id="view1" class="tab__item">' +
      '<div id="view2" class="tab__item tab__item--selected">' +
      '</div>';
    showTab('tab1');
    expect(document.getElementById('tab1')?.classList.contains('tab--selected')).toBe(true);
    expect(document.getElementById('tab2')?.classList.contains('tab--selected')).toBe(false);
    expect(document.getElementById('view1')?.classList.contains('tab__item--selected')).toBe(true);
    expect(document.getElementById('view2')?.classList.contains('tab__item--selected')).toBe(false);
  });
});
