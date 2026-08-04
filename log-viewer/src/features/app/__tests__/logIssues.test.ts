/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import { toLogIssue } from '../logIssues.js';

describe('toLogIssue', () => {
  it('maps severity, rail category and the call-tree action', () => {
    const issue = toLogIssue({
      summary: 'Skipped-Lines',
      description: 'lines skipped',
      type: 'skip',
      eventIndex: 7,
      startTime: 120,
    });

    expect(issue.severity).toBe('info');
    expect(issue.category).toBe('skip');
    expect(issue.timestamp).toBe(120);
    expect(issue.action?.label).toBe('Go to call tree');
    expect(issue.label).toBeNull();
  });

  it('labels fatal errors and thrown exceptions with their kind', () => {
    const fatal = toLogIssue({
      summary: 'System.LimitException: Apex CPU time limit exceeded',
      description: '',
      type: 'fatal',
      startTime: 100,
    });
    const thrown = toLogIssue({
      summary: 'System.LimitException: Apex CPU time limit exceeded',
      description: '',
      type: 'error',
      startTime: 50,
    });

    expect(fatal.severity).toBe('error');
    expect(fatal.category).toBe('exception');
    expect(fatal.label).toBe('Fatal error');
    expect(thrown.severity).toBe('error');
    expect(thrown.category).toBe('exception');
    expect(thrown.label).toBe('Exception');
  });

  it('leaves an issue with no event unactivatable', () => {
    const issue = toLogIssue({ summary: 'Max-Size-reached', description: '', type: 'unexpected' });

    expect(issue.action).toBeNull();
    expect(issue.category).toBe('unexpected');
    expect(issue.severity).toBe('warning');
    expect(issue.timestamp).toBeNull();
  });

  it('keeps a timestamp of 0 — the log can fail on its first line', () => {
    const issue = toLogIssue({ summary: 'boom', description: '', type: 'error', startTime: 0 });

    expect(issue.timestamp).toBe(0);
  });
});
