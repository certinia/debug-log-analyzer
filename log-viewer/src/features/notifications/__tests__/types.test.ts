/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import {
  countsBySeverity,
  describeIssues,
  sortBySeverity,
  worstSeverity,
  type IssueSeverity,
  type LogIssue,
} from '../types.js';

function issue(severity: IssueSeverity, summary: string = severity): LogIssue {
  return {
    summary,
    message: '',
    severity,
    label: null,
    action: null,
    category: null,
    timestamp: null,
  };
}

describe('worstSeverity', () => {
  it('returns null for an empty list', () => {
    expect(worstSeverity([])).toBeNull();
  });

  it('picks the most severe present regardless of order', () => {
    expect(worstSeverity([issue('info'), issue('error'), issue('warning')])).toBe('error');
    expect(worstSeverity([issue('info'), issue('warning')])).toBe('warning');
    expect(worstSeverity([issue('info')])).toBe('info');
  });
});

describe('countsBySeverity', () => {
  it('counts most severe first and omits absent severities', () => {
    expect(countsBySeverity([issue('info'), issue('error'), issue('info')])).toEqual([
      { severity: 'error', count: 1 },
      { severity: 'info', count: 2 },
    ]);
  });
});

describe('describeIssues', () => {
  it('uses the empty label when there is nothing to report', () => {
    expect(describeIssues([], 'problem', 'No problems')).toBe('No problems');
  });

  it('gives just the total for a single severity', () => {
    expect(describeIssues([issue('error')], 'problem', 'No problems')).toBe('1 problem');
    expect(describeIssues([issue('error'), issue('error')], 'problem', 'No problems')).toBe(
      '2 problems',
    );
  });

  it('appends a breakdown once severities are mixed', () => {
    const issues = [issue('error'), issue('warning'), issue('warning')];
    expect(describeIssues(issues, 'problem', 'No problems')).toBe(
      '3 problems — 1 error, 2 warnings',
    );
  });
});

describe('sortBySeverity', () => {
  it('orders most severe first, keeping producer order within a severity', () => {
    const issues = [
      issue('info', 'first info'),
      issue('warning', 'first warning'),
      issue('error', 'the error'),
      issue('info', 'second info'),
    ];

    expect(sortBySeverity(issues).map((i) => i.summary)).toEqual([
      'the error',
      'first warning',
      'first info',
      'second info',
    ]);
  });

  it('does not mutate the input', () => {
    const issues = [issue('info'), issue('error')];
    sortBySeverity(issues);
    expect(issues.map((i) => i.severity)).toEqual(['info', 'error']);
  });
});
