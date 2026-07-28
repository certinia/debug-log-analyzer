/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

type ProgressOptions = {
  showPercentageText?: boolean;
  precision?: number;
};

// The fill is only useful once it's wide enough to see — below this, round up
// to a hairline sliver rather than disappearing entirely (a real value like
// 12/50,000 rows rounds to 0% but is still non-zero usage worth showing).
const MIN_VISIBLE_PERCENT = 1;

export function progressComponent(
  value: number,
  totalValue: number,
  options: ProgressOptions,
): string | HTMLElement {
  const { showPercentageText = true, precision = 2 } = options;

  const roundedValue = (value || 0).toFixed(precision);

  if (totalValue !== null && totalValue !== undefined) {
    const exactPercent = totalValue !== 0 ? (value / totalValue) * 100 : 0;
    const percentComplete = Math.round(exactPercent);

    const wrapper = document.createElement('div');
    wrapper.className = 'progress-wrapper';

    if (value > 0 && totalValue > 0) {
      const bar = document.createElement('div');
      bar.className = 'progress-bar';
      bar.style.width = `${Math.max(exactPercent, MIN_VISIBLE_PERCENT)}%`;
      wrapper.appendChild(bar);
    }

    const textEl = document.createElement('div');
    textEl.className = 'progress-bar__text';

    const valueSpan = document.createElement('span');
    valueSpan.textContent = roundedValue;
    textEl.appendChild(valueSpan);

    if (showPercentageText) {
      const pctSpan = document.createElement('span');
      pctSpan.className = 'progress-bar__text__percent';
      pctSpan.textContent = `(${percentComplete.toFixed(2)}%)`;
      textEl.appendChild(pctSpan);
    }

    wrapper.appendChild(textEl);
    return wrapper;
  }

  return roundedValue;
}
