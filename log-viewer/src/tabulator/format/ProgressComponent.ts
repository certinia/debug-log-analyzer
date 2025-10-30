/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

type ProgressOptions = {
  showPercentageText?: boolean;
  precision?: number;
};

export function progressComponent(value: number, totalValue: number, options: ProgressOptions) {
  const { showPercentageText = true, precision = 2 } = options;

  const roundedValue = (value || 0).toFixed(precision);

  if (totalValue !== undefined && totalValue !== null) {
    const showPercent = showPercentageText ?? true;
    const percentComplete =
      totalValue !== 0 ? (Math.round((value / totalValue) * 100) / 100) * 100 : 0;

    const percentageText = showPercent ? `(${percentComplete.toFixed(2)}%)` : '';

    const progressBarElem = `${percentComplete ? `<div class="progress-bar" style="width: ${percentComplete}%;"></div>` : ''}`;
    const progressBarTextElem = `<div class="progress-bar__text">
      <span>${roundedValue}</span>
      ${showPercent ? `<span class="progress-bar__text__percent">${percentageText}</span>` : ''}
    </div>`;

    return `<div class="progress-wrapper">
        ${progressBarElem}
        ${progressBarTextElem}
      </div>`;
  }

  return roundedValue;
}
