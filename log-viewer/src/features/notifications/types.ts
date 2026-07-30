/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { TemplateResult } from 'lit';

/** Severity of a single issue. Ordered most→least severe by `SEVERITY_ORDER`. */
export type IssueSeverity = 'error' | 'warning' | 'info';

/**
 * One entry in either header surface: a problem found in the log (governor limit
 * exception, skipped lines) or a notification about the parse itself.
 *
 * `readonly` throughout so a consumer can't sort or edit the producer's array in
 * place — renderers copy before sorting.
 */
export interface LogIssue {
  readonly summary: string;
  readonly message: string | TemplateResult<1>;
  readonly severity: IssueSeverity;
  /** Call-tree event to navigate to, or `null` when the issue isn't tied to one. */
  readonly eventIndex: number | null;
  readonly timestamp: number | null;
}

/** Sort/comparison rank — lower is more severe. */
export const SEVERITY_ORDER: Readonly<Record<IssueSeverity, number>> = {
  error: 0,
  warning: 1,
  info: 2,
};

interface SeverityMeta {
  /** Codicon name. */
  readonly icon: string;
  /** Theme colour for panel rows only — header chrome is monochrome. */
  readonly color: string;
  /** Singular noun used to build the breakdown sentence. */
  readonly label: string;
}

export const SEVERITY_META: Readonly<Record<IssueSeverity, SeverityMeta>> = {
  error: {
    icon: 'error',
    color: 'var(--vscode-editorError-foreground)',
    label: 'error',
  },
  warning: {
    icon: 'warning',
    color: 'var(--vscode-editorWarning-foreground)',
    label: 'warning',
  },
  info: {
    icon: 'info',
    color: 'var(--vscode-editorInfo-foreground)',
    label: 'info',
  },
};

/** The most severe severity present, or `null` for an empty list. */
export function worstSeverity(issues: readonly LogIssue[]): IssueSeverity | null {
  return issues.reduce<IssueSeverity | null>(
    (worst, issue) =>
      worst === null || SEVERITY_ORDER[issue.severity] < SEVERITY_ORDER[worst]
        ? issue.severity
        : worst,
    null,
  );
}

/** How many issues of each severity, most severe first. Severities with none are omitted. */
export function countsBySeverity(
  issues: readonly LogIssue[],
): ReadonlyArray<{ severity: IssueSeverity; count: number }> {
  return (Object.keys(SEVERITY_ORDER) as IssueSeverity[])
    .map((severity) => ({
      severity,
      count: issues.filter((issue) => issue.severity === severity).length,
    }))
    .filter(({ count }) => count > 0);
}

/**
 * Human breakdown for a tooltip / `aria-label`, e.g.
 * `"3 problems — 1 error, 2 warnings"`, or `emptyLabel` when there are none.
 */
export function describeIssues(
  issues: readonly LogIssue[],
  noun: string,
  emptyLabel: string,
): string {
  if (!issues.length) {
    return emptyLabel;
  }

  const total = `${issues.length} ${plural(noun, issues.length)}`;
  const counts = countsBySeverity(issues);
  // A single-severity list would read "1 error — 1 error"; the total says it all.
  if (counts.length < 2) {
    return total;
  }

  const breakdown = counts
    .map(({ severity, count }) => `${count} ${plural(SEVERITY_META[severity].label, count)}`)
    .join(', ');
  return `${total} — ${breakdown}`;
}

/** Sort a copy most severe first, preserving producer order within a severity. */
export function sortBySeverity(issues: readonly LogIssue[]): LogIssue[] {
  return [...issues].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

function plural(noun: string, count: number): string {
  return count === 1 ? noun : `${noun}s`;
}
