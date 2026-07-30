/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

// Hoisted above the import, so the mock can't close over a `const` declared here.
jest.mock('../../../core/messaging/VSCodeExtensionMessenger.js', () => ({
  vscodeMessenger: { send: jest.fn() },
}));

import { vscodeMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { parserIssuesToNotifications } from '../parserNotifications.js';

const sendMock = vscodeMessenger.send as jest.Mock;

describe('parserIssuesToNotifications', () => {
  it('offers a prefilled bug report for an unsupported log event', () => {
    const [issue] = parserIssuesToNotifications(['Unsupported log event name: FLOW_START_NEW']);

    expect(issue?.summary).toBe('Unsupported log event name: FLOW_START_NEW');
    expect(issue?.severity).toBe('warning');
    expect(issue?.action?.label).toBe('Report unsupported log event');

    issue?.action?.run();
    const [cmd, url] = sendMock.mock.calls[0] as [string, string];
    expect(cmd).toBe('openUrl');
    expect(url).toContain('https://github.com/certinia/debug-log-analyzer/issues/new');
    expect(url).toContain('template=bug_report.md');
    expect(url).toContain('labels=bug,needs-triage');
    expect(url).toContain(encodeURIComponent('Unsupported log event name: FLOW_START_NEW'));
  });

  it('leaves an invalid log line unreportable, since it echoes log text', () => {
    const [issue] = parserIssuesToNotifications(['Invalid log line: 12:00:00.0 (1)|SOME_JUNK']);

    expect(issue?.summary).toBe('Invalid log line');
    // Trimmed: the card renders the message with whitespace preserved.
    expect(issue?.message).toBe('12:00:00.0 (1)|SOME_JUNK');
    expect(issue?.action).toBeNull();
    expect(issue?.category).toBeNull();
  });
});
