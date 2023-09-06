/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
let requestId: number;

export default function formatDuration(duration: number) {
  const text = `${~~(duration / 1000)}`; // convert from nano-seconds to micro-seconds
  const textPadded = text.length < 4 ? '0000'.substring(text.length) + text : text; // length min = 4
  const millis = textPadded.slice(0, -3); // everything before last 3 chars
  const micros = textPadded.slice(-3); // last 3 chars
  return `${millis}.${micros}ms`;
}

export function debounce(callBack: void) {
  if (requestId) {
    window.cancelAnimationFrame(requestId);
  }

  requestId = window.requestAnimationFrame(() => {
    callBack;
  });
}
