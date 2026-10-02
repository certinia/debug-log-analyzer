/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it, type Mock, vi } from 'vitest';

import { asContext, createMockContext } from '../../__tests__/helpers/test-builders.js';
import { Uri, workspace } from '../../__tests__/mocks/vscode.js';
import { getConfig } from '../../workspace/AppConfig.js';
import { WebView } from '../../display/WebView.js';
import { LogView } from '../LogView.js';

vi.mock('../../display/WebView.js', () => ({
  WebView: { apply: vi.fn() },
}));
vi.mock('../../workspace/AppConfig.js', () => ({
  PRIVATE_SECTIONS: [],
  getColumnOverrides: vi.fn(() => ({})),
  getColumnViews: vi.fn(() => ({})),
  getConfig: vi.fn(() => ({
    timeline: {},
    callTree: { columnOverrides: {} },
    database: {
      soql: { columnView: 'General', columnOverrides: {} },
      dml: { columnView: 'General', columnOverrides: {} },
      sosl: { columnView: 'General', columnOverrides: {} },
    },
    inspector: {},
  })),
  getInspectorState: vi.fn(() => ({})),
  sameConfig: vi.fn(() => true),
  updateConfig: vi.fn(),
  updatePrivateSection: vi.fn(),
}));

const mockApplyWebView = WebView.apply as Mock;
// The file-I/O layer is deliberately not mocked out: createView reads its own
// bundled index.html, and mocking that module away is what hid it reading
// through a service that throws unless another extension has initialised it.
const mockReadFile = workspace.fs.readFile as unknown as Mock;
const TEMPLATE = '<script src="bundle.js"></script><link href="codicon.css">';

describe('LogView', () => {
  /** The panel createView will get, and a way to message it as the webview would. */
  function stubPanel() {
    let receiveMessage: ((message: unknown) => Promise<void>) | undefined;
    const panel = {
      iconPath: undefined,
      onDidDispose: vi.fn(() => ({ dispose: vi.fn() })),
      reveal: vi.fn(),
      webview: {
        asWebviewUri: vi.fn((uri: { path: string }) => Uri.parse(`webview:${uri.path}`)),
        html: '',
        onDidReceiveMessage: vi.fn((listener: (message: unknown) => Promise<void>) => {
          receiveMessage = listener;
          return { dispose: vi.fn() };
        }),
        postMessage: vi.fn().mockResolvedValue(true),
      },
    };
    mockApplyWebView.mockReturnValue(panel as unknown as import('vscode').WebviewPanel);
    return { panel, receive: (message: unknown) => receiveMessage!(message) };
  }

  async function createViewWithListener() {
    const { panel, receive } = stubPanel();
    mockReadFile.mockResolvedValue(new TextEncoder().encode(TEMPLATE));
    const context = createMockContext();
    const logUri = Uri.parse('memfs:/repository/logs/virtual.log');

    await LogView.createView(asContext(context), Promise.resolve(), logUri, 'log body');

    return { context, logUri, receive, postMessage: panel.webview.postMessage };
  }

  it('uses a display path in the payload and the captured URI for open actions', async () => {
    workspace.asRelativePath.mockReturnValueOnce('workspace/logs/virtual.log');
    const { context, logUri, receive, postMessage } = await createViewWithListener();

    await receive({ cmd: 'fetchLog', requestId: 'request-1' });

    expect(postMessage).toHaveBeenCalledWith({
      requestId: 'request-1',
      cmd: 'fetchLog',
      payload: {
        logName: 'virtual.log',
        logUri: 'webview:/repository/logs/virtual.log',
        logPath: 'workspace/logs/virtual.log',
        logData: 'log body',
        navigateToTimestamp: undefined,
      },
    });

    await receive({ cmd: 'openPath', payload: 'file:///untrusted.log' });

    expect(context.display.showFile).toHaveBeenCalledWith(logUri);
  });

  it('points the packaged template at webview URIs', async () => {
    const { panel } = stubPanel();
    mockReadFile.mockResolvedValue(new TextEncoder().encode(TEMPLATE));

    await LogView.createView(asContext(createMockContext()));

    expect(mockReadFile).toHaveBeenCalledWith(Uri.parse('file:///test/extension/out/index.html'));
    expect(panel.webview.html).toContain('webview:/test/extension/out/bundle.js');
    expect(panel.webview.html).not.toContain('src="bundle.js"');
  });

  it('owns the rejection of a body the webview never asks for', async () => {
    stubPanel();
    mockReadFile.mockResolvedValue(new TextEncoder().encode('<html></html>'));
    const unhandled: unknown[] = [];
    const record = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', record);
    try {
      const context = createMockContext();
      const failed = Promise.reject(new Error('org unreachable'));
      await LogView.createView(asContext(context), failed);
      // No fetchLog is posted, so nothing here awaits the body.
      await new Promise((resolve) => setImmediate(resolve));
      expect(unhandled).toEqual([]);
      expect(context.display.output).toHaveBeenCalledWith(
        'Could not retrieve the log: org unreachable',
      );
      // Still a rejection for the fetchLog handler to report if it does ask.
      await expect(failed).rejects.toThrow('org unreachable');
    } finally {
      process.off('unhandledRejection', record);
    }
  });

  it('names the file it could not read when the packaged template is missing', async () => {
    stubPanel();
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    await expect(LogView.createView(asContext(createMockContext()))).rejects.toThrow(
      'Could not read the log viewer at /test/extension/out/index.html: ENOENT',
    );
  });

  it('answers a request whose case throws, so the webview stops waiting', async () => {
    const { receive, postMessage } = await createViewWithListener();

    (getConfig as Mock).mockImplementationOnce(() => {
      throw new Error('settings unavailable');
    });
    await receive({ cmd: 'getConfig', requestId: 'request-2' });

    expect(postMessage).toHaveBeenCalledWith({
      requestId: 'request-2',
      error: 'settings unavailable',
    });
  });

  it('answers a request it does not recognise, rather than leaving it pending', async () => {
    const { receive, postMessage } = await createViewWithListener();

    await receive({ cmd: 'notACommand', requestId: 'request-3' });

    expect(postMessage).toHaveBeenCalledWith({
      requestId: 'request-3',
      error: 'Unknown request: notACommand',
    });
  });
});
