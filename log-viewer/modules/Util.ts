/*
 * Copyright (c) 2020 FinancialForce.com, inc. All rights reserved.
 */
export default function formatDuration(duration: number) {
  const text = `${~~(duration / 1000)}`; // convert from nano-seconds to micro-seconds
  const textPadded = text.length < 4 ? '0000'.substring(text.length) + text : text; // length min = 4
  const millis = textPadded.slice(0, -3); // everything before last 3 chars
  const micros = textPadded.slice(-3); // last 3 chars
  return `${millis}.${micros}ms`;
}

export function showTab(tabId: string) {
  const tabHolder = document.querySelector('.tabHolder'),
    tab = document.getElementById(tabId),
    tabber = document.querySelector('.tabber'),
    show = tab?.dataset.show,
    tabItem = show ? document.getElementById(show) : null;

  tabHolder?.querySelectorAll('.tab').forEach((t) => t.classList.remove('selected'));
  tab?.classList.add('selected');
  tabber?.querySelectorAll('.tabItem').forEach((t) => t.classList.remove('selected'));
  if (tabItem) {
    tabItem.classList.add('selected');
  }
}
