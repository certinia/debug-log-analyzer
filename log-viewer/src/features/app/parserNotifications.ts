/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { vscodeMessenger } from '../../core/messaging/VSCodeExtensionMessenger.js';
import type { IssueAction, LogIssue } from '../notifications/types.js';

const UNSUPPORTED_TYPE_PREFIX = 'Unsupported log event name:';

/**
 * The parser's own diagnostics as notification-centre issues.
 *
 * Takes the messages rather than the log so the mapping stays independent of the parser's
 * shape — the only producer of tool-level notifications today.
 */
export function parserIssuesToNotifications(parsingErrors: readonly string[]): LogIssue[] {
  return parsingErrors.map((message): LogIssue => {
    const eventName = unsupportedEventName(message);

    return {
      summary: eventName ? message : message.slice(0, message.indexOf(':')),
      // Trimmed: the card preserves whitespace for stack traces, so the separator's
      // space would render as an indent.
      message: eventName ? '' : message.slice(message.indexOf(':') + 1).trim(),
      // A parse gap means some of the log wasn't understood, which can silently skew
      // every view built from it — a warning, not the untinted 'None' it used to be.
      severity: 'warning',
      label: null,
      // Only an unsupported event name is safe to report: `Invalid log line: …` echoes log
      // text that can carry customer data, so that card stays static.
      action: eventName ? reportUnsupportedTypeAction(eventName) : null,
      // The timeline draws no band for a parse gap, so there is no marker colour to match.
      category: null,
      timestamp: null,
    };
  });
}

/** The event name from an `Unsupported log event name:` message, else `null`. */
function unsupportedEventName(message: string): string | null {
  return message.startsWith(UNSUPPORTED_TYPE_PREFIX)
    ? message.slice(UNSUPPORTED_TYPE_PREFIX.length).trim()
    : null;
}

/**
 * Opens a prefilled bug report for an event the parser doesn't know. Title and labels match
 * `.github/ISSUE_TEMPLATE/bug_report.md`, so triage sees the same shape as a hand-filed bug.
 */
function reportUnsupportedTypeAction(eventName: string): IssueAction {
  const url =
    'https://github.com/certinia/debug-log-analyzer/issues/new?template=bug_report.md&labels=bug,needs-triage&title=' +
    encodeURIComponent(`🐛 bug: ${UNSUPPORTED_TYPE_PREFIX} ${eventName}`);

  return {
    label: 'Report unsupported log event',
    icon: 'link-external',
    // A webview can't navigate itself, so the extension opens external URLs.
    run: () => {
      vscodeMessenger.send('openUrl', url);
    },
  };
}
