/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

export function progressComponent(
  value: number,
  totalValue: number,
  options: { showPercentageText?: boolean; precision?: number } = {
    showPercentageText: true,
    precision: 3,
  },
) {
  const roundedValue = `${(value || 0).toFixed(options.precision ?? 3)}`;

  if (totalValue !== undefined && totalValue !== null) {
    const showPercent = options.showPercentageText ?? true;
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
