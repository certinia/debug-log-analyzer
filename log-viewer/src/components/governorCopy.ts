/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/**
 * Why a governor surface shows no figures, or figures with no bar. Kept in a leaf module — as
 * `detailEmptyText` is — so the gauges, the trends, the Row budget and the call tree's utilisation
 * columns reach the same wording without importing each other's components.
 */

/** Before a log reaches the store: the inspector renders while the log parses. */
export const NO_LOG_TEXT = 'No log is loaded.';

/** The log holds no governor usage at all, so there is nothing to read. */
export const NO_GOVERNOR_USAGE_TEXT = 'This log records no governor usage.';

/** Nothing on this surface can be measured: the log named no limit for any metric. */
export const NO_REPORTED_LIMITS_TEXT = 'The log reports no governor limits.';

/** One metric cannot be measured. Per metric, so it never contradicts a metered figure beside it. */
export const NO_LIMIT_FOR_METRIC_TEXT = 'The log reports no limit for this governor.';
