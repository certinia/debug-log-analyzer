/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 */

/**
 * Widths (px) for columns that appear in more than one table, so the same logical
 * column can't drift between them.
 *
 * Each is `max(narrowest width whose title wraps to <= 2 lines, widest value + 8)`:
 * a title has `width - 34` of text budget (4px column padding each side plus the
 * 25px sort-arrow reserve inside the border-box title), a cell has `width - 8`.
 */

/** `Namespace` / `Caller Namespace` — sized to the 15-character namespace prefix cap. */
export const NAMESPACE_WIDTH = 117;

/** Call-tree time columns — value plus the fixed `9ch` percentage span. */
export const TIME_WIDTH = 140;

/** Database `Row Count` — the title, not the value, is the constraint. */
export const DB_ROW_COUNT_WIDTH = 70;

/** Database `Time Taken (ms)` — value only, no percentage span. */
export const DB_TIME_WIDTH = 107;
