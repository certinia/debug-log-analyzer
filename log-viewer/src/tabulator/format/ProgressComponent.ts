/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

type ProgressOptions = {
  showPercentageText?: boolean;
  precision?: number;
};

export function progressComponent(
  value: number,
  totalValue: number,
  options: ProgressOptions,
): string | HTMLElement {
  const { showPercentageText = true, precision = 2 } = options;

  const roundedValue = (value || 0).toFixed(precision);

  if (totalValue !== null && totalValue !== undefined) {
    const percentComplete = totalValue !== 0 ? Math.round((value / totalValue) * 100) : 0;

    const wrapper = document.createElement('div');
    wrapper.className = 'progress-wrapper';

    if (percentComplete) {
      const bar = document.createElement('div');
      bar.className = 'progress-bar';
      bar.style.width = `${percentComplete}%`;
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
