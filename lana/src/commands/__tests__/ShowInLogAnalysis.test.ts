/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { Uri, window } from 'vscode';

import {
  asContext,
  createMockContext,
  lastRegisteredCommand,
} from '../../__tests__/helpers/test-builders.js';
import { LogView } from '../LogView.js';
import { ShowInLogAnalysis } from '../ShowInLogAnalysis.js';

jest.mock('../LogView.js', () => ({
  LogView: {
    createView: jest.fn(),
    getCurrentView: jest.fn(),
    getLogUri: jest.fn(),
    setPendingNavigation: jest.fn(),
  },
}));

const mockCreateView = LogView.createView as jest.Mock;
const mockGetCurrentView = LogView.getCurrentView as jest.Mock;
const mockGetLogUri = LogView.getLogUri as jest.Mock;

const openPanel = () => ({ reveal: jest.fn(), webview: { postMessage: jest.fn() } });

describe('ShowInLogAnalysis', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetCurrentView.mockReturnValue(undefined);
    mockGetLogUri.mockReturnValue(undefined);
    mockCreateView.mockResolvedValue(undefined);
  });

  afterEach(() => {
    window.activeTextEditor = undefined;
  });

  const command = lastRegisteredCommand;

  it('opens the log at the event', async () => {
    const context = createMockContext();
    ShowInLogAnalysis.apply(asContext(context));

    await command()({ eventId: 42, filePath: 'memfs:/logs/a.log' });

    expect(LogView.setPendingNavigation).toHaveBeenCalledWith(42);
    expect(mockCreateView).toHaveBeenCalled();
    expect(context.display.showErrorMessage).not.toHaveBeenCalled();
  });

  it('sends the event to the open panel when it already shows the linked log', async () => {
    const panel = openPanel();
    mockGetCurrentView.mockReturnValue(panel);
    mockGetLogUri.mockReturnValue(Uri.parse('memfs:/logs/a.log'));
    ShowInLogAnalysis.apply(asContext(createMockContext()));

    await command()({ eventId: 42, filePath: 'memfs:/logs/a.log' });

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      cmd: 'navigateToTimeline',
      payload: { eventId: 42 },
    });
    expect(mockCreateView).not.toHaveBeenCalled();
  });

  // An id names an event in one parse only: sent to another log's panel it picks an unrelated event.
  it('opens the linked log when the open panel shows another one', async () => {
    const panel = openPanel();
    mockGetCurrentView.mockReturnValue(panel);
    mockGetLogUri.mockReturnValue(Uri.parse('memfs:/logs/b.log'));
    ShowInLogAnalysis.apply(asContext(createMockContext()));

    await command()({ eventId: 42, filePath: 'memfs:/logs/a.log' });

    expect(panel.webview.postMessage).not.toHaveBeenCalled();
    expect(LogView.setPendingNavigation).toHaveBeenCalledWith(42);
    expect(String(mockCreateView.mock.calls[0]?.[2])).toBe('memfs:/logs/a.log');
  });

  // With no file in the link, the editor's log decides whether the open panel is the right one.
  it('uses the active editor log when the link names no file', async () => {
    const panel = openPanel();
    mockGetCurrentView.mockReturnValue(panel);
    mockGetLogUri.mockReturnValue(Uri.parse('memfs:/logs/a.log'));
    window.activeTextEditor = {
      document: { uri: Uri.parse('memfs:/logs/a.log') },
    } as typeof window.activeTextEditor;
    ShowInLogAnalysis.apply(asContext(createMockContext()));

    await command()({ eventId: 42 });

    expect(panel.webview.postMessage).toHaveBeenCalledWith({
      cmd: 'navigateToTimeline',
      payload: { eventId: 42 },
    });
  });

  // The hover is on one log while another editor has focus; the id belongs to the hovered log.
  it("opens the link's log, not the active editor's", async () => {
    window.activeTextEditor = {
      document: { uri: Uri.parse('memfs:/logs/b.log') },
    } as typeof window.activeTextEditor;
    ShowInLogAnalysis.apply(asContext(createMockContext()));

    await command()({ eventId: 42, filePath: 'memfs:/logs/a.log' });

    expect(String(mockCreateView.mock.calls[0]?.[2])).toBe('memfs:/logs/a.log');
  });

  it('says what to do when neither the link nor an editor names a log', async () => {
    const context = createMockContext();
    ShowInLogAnalysis.apply(asContext(context));

    await command()({ eventId: 42 });

    expect(context.display.showInformationMessage).toHaveBeenCalledWith(
      'Open an Apex log, hover an event line, then choose Show in Log Analysis.',
    );
    expect(mockCreateView).not.toHaveBeenCalled();
  });

  it('reports a failure to open the log rather than failing silently', async () => {
    mockCreateView.mockRejectedValue(new Error('viewer is missing'));
    const context = createMockContext();
    ShowInLogAnalysis.apply(asContext(context));

    await expect(
      command()({ eventId: 42, filePath: 'memfs:/logs/a.log' }),
    ).resolves.toBeUndefined();

    expect(context.display.showErrorMessage).toHaveBeenCalledWith(
      'Error showing the log analysis: viewer is missing',
    );
  });
});
