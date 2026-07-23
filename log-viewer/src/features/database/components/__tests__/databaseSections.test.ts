/*
 * Copyright (c) 2025 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

// Avoid the heavy component import chains (CalltreeView scss, vscode-elements);
// this suite only exercises the section-assembly logic.
jest.mock('../../../../components/CallStackDetail.js', () => ({}));
jest.mock('../DbVitals.js', () => ({}));
jest.mock('../../../soql/components/SOQLLinterIssues.js', () => ({
  computeSoqlIssues: async () => [
    { severity: 'Warning', summary: 'w', message: 'm' },
    { severity: 'Info', summary: 'i', message: 'm' },
  ],
}));

import { buildDatabaseSections } from '../databaseSections.js';

describe('buildDatabaseSections', () => {
  it('builds vitals + call stack + issues for a SOQL selection, badged by count', async () => {
    const sections = await buildDatabaseSections({ eventIndex: 3, type: 'soql' });
    expect(sections.map((s) => s.id)).toEqual(['vitals', 'callstack', 'issues']);
    expect(sections.find((s) => s.id === 'issues')?.badge).toBe('2');
  });

  it('omits the SOQL issues section for a DML selection', async () => {
    const sections = await buildDatabaseSections({ eventIndex: 5, type: 'dml' });
    expect(sections.map((s) => s.id)).toEqual(['vitals', 'callstack']);
  });
});
