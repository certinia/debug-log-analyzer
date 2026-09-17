/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';

// jsdom can't run the real elements (they read document.baseURI).
jest.mock('#vscode-elements/vscode-icon.js', () => ({}));
jest.mock('#vscode-elements/vscode-tabs.js', () => ({}));
jest.mock('#vscode-elements/vscode-tab-header.js', () => ({}));
jest.mock('#vscode-elements/vscode-tab-panel.js', () => ({}));
// The header and the inspector pull in every grid, and Tabulator needs a real DOM.
jest.mock('../AppHeader.js', () => ({}));
jest.mock('../../../components/LogInspector.js', () => ({}));
jest.mock('../../../core/messaging/VSCodeExtensionMessenger.js', () => ({
  vscodeMessenger: { request: jest.fn(() => new Promise(() => {})), send: jest.fn() },
  VSCodeExtensionMessenger: { listen: jest.fn(() => () => {}) },
}));

import type { LogViewer } from '../LogViewer.js';
import '../LogViewer.js';

/** `_logStatus` is private, so an intersection with it reduces to `never`. */
function statusOf(el: LogViewer): string {
  return (el as unknown as { _logStatus: string })._logStatus;
}

const MINIMAL_LOG = [
  '61.0 APEX_CODE,FINEST',
  '12:00:00.0 (0)|EXECUTION_STARTED',
  '12:00:00.1 (100)|EXECUTION_FINISHED',
].join('\n');

async function mount(): Promise<LogViewer> {
  const el = document.createElement('log-viewer') as LogViewer;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('a log that could not be read', () => {
  it('reports a failed load rather than an empty log', async () => {
    const el = await mount();

    // `fetch` is unavailable in jsdom, so the read fails the way a missing file does.
    await el._handleLogFetch({ logUri: 'memfs:/gone.log' });

    expect(statusOf(el)).toBe('failed');
    expect(el.logProblems?.map((problem) => problem.summary)).toEqual(['Could not read log']);
  });

  it('does not treat a parsed log as failed', async () => {
    const el = await mount();

    await el._handleLogFetch({ logData: MINIMAL_LOG });

    expect(statusOf(el)).toBe('ready');
  });

  it('paints the region empty, so its first text is a change a reader is told about', async () => {
    const el = document.createElement('log-viewer') as LogViewer;
    document.body.appendChild(el);
    // `performUpdate` is protected; rendering synchronously is what shows the first paint.
    (el as unknown as { performUpdate: () => void }).performUpdate();

    expect(el.shadowRoot?.querySelector('[role="status"]')?.textContent?.trim()).toBe('');
  });

  it('announces the load, since every placeholder is hidden from a reader', async () => {
    const el = await mount();

    const region = el.shadowRoot?.querySelector('[role="status"]');
    expect(region?.getAttribute('aria-live')).toBe('polite');
    expect(region?.textContent?.trim()).toBe('Loading log');

    await el._handleLogFetch({ logData: MINIMAL_LOG });
    await el.updateComplete;
    expect(el.shadowRoot?.querySelector('[role="status"]')?.textContent?.trim()).toBe('Log loaded');
  });

  it('announces a load that failed, which is otherwise silent', async () => {
    const el = await mount();

    await el._handleLogFetch({ logUri: 'memfs:/gone.log' });
    await el.updateComplete;

    expect(el.shadowRoot?.querySelector('[role="status"]')?.textContent?.trim()).toBe(
      'The log could not be loaded',
    );
  });
});
