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
  });

  it('leaves an issue with no event unactivatable', () => {
    const issue = toLogIssue({ summary: 'Max-Size-reached', description: '', type: 'unexpected' });

    expect(issue.action).toBeNull();
    expect(issue.category).toBe('unexpected');
    expect(issue.severity).toBe('warning');
  });
});
