/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** A seek shows this share of the log. Exported so a control that steps through
 *  the log can move by one window at a time and leave no gap. */
export const SEEK_LOG_SHARE = 0.02;
/** 100ms in nanoseconds: the smallest window a seek zooms to. */
const SEEK_MIN_WINDOW = 100_000_000;

/**
 * The time window the viewport zooms to for a seek: an instant at the centre of
 * a share of the log. The width comes from the log, never from the frame the
 * instant happens to land in.
 */
export function seekWindow(at: number, logTotal: number): { start: number; width: number } {
  const width = Math.max(logTotal * SEEK_LOG_SHARE, SEEK_MIN_WINDOW);
  return { start: Math.max(at - width / 2, 0), width };
}
