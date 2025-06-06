/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
let requestId: number = 0;

export default function formatDuration(durationNs: number, totalNs = 0) {
  const text = `${~~(durationNs / 1000)}`; // convert from nano-seconds to micro-seconds
  const textPadded = text.length < 4 ? '0000'.substring(text.length) + text : text; // length min = 4
  const millis = textPadded.slice(0, -3); // everything before last 3 chars
  const micros = textPadded.slice(-3); // last 3 chars
  const suffix = totalNs > 0 ? `/${(totalNs / 1_000_000).toFixed(3)}` : '';
  return `${millis}.${micros}${suffix} ms`;
}

export function debounce<T extends unknown[]>(callBack: (...args: T) => unknown) {
  if (requestId) {
    window.cancelAnimationFrame(requestId);
  }

  return (...args: T) => {
    requestId = window.requestAnimationFrame(() => {
      callBack(...args);
    });
  };
}

export async function isVisible(
  element: HTMLElement,
  options?: IntersectionObserverInit,
): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const observer = new IntersectionObserver((entries, observerInstance) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          resolve(true);
          observerInstance.disconnect();
          return;
        }
      }
    }, options);

    observer.observe(element);
  });
}
