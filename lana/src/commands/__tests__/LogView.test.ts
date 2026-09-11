/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

import { createMockContext } from '../../__tests__/helpers/test-builders.js';
import { Uri, workspace } from '../../__tests__/mocks/vscode.js';
import { WebView } from '../../display/WebView.js';
import { LogView } from '../LogView.js';

jest.mock('../../display/WebView.js', () => ({
  WebView: { apply: jest.fn() },
}));
jest.mock('../../workspace/AppConfig.js', () => ({
  PRIVATE_SECTIONS: [],
  getColumnOverrides: jest.fn(() => ({})),
  getColumnViews: jest.fn(() => ({})),
  getConfig: jest.fn(() => ({
    timeline: {},
    callTree: { columnOverrides: {} },
    database: {
      soql: { columnView: 'General', columnOverrides: {} },
      dml: { columnView: 'General', columnOverrides: {} },
      sosl: { columnView: 'General', columnOverrides: {} },
    },
    inspector: {},
  })),
  getInspectorState: jest.fn(() => ({})),
  sameConfig: jest.fn(() => true),
  updateConfig: jest.fn(),
  updatePrivateSection: jest.fn(),
}));

const mockApplyWebView = WebView.apply as jest.Mock;
const mockReadFile = workspace.fs.readFile as unknown as jest.Mock;

describe('LogView', () => {
  beforeEach(() => {
    mockReadFile.mockResolvedValue(
      new TextEncoder().encode(
        '<link id="vscode-codicon-stylesheet" href="codicon.css" /><script type="module" src="bundle.js"></script>',
      ),
    );
  });

  it('uses a display path in the payload and the captured URI for open actions', async () => {
    let receiveMessage: ((message: unknown) => Promise<void>) | undefined;
    const postMessage = jest.fn().mockResolvedValue(true);
    const panel = {
      iconPath: undefined,
      onDidDispose: jest.fn(() => ({ dispose: jest.fn() })),
      reveal: jest.fn(),
      webview: {
        asWebviewUri: jest.fn((uri: { path: string }) => Uri.parse(`webview:${uri.path}`)),
        html: '',
        onDidReceiveMessage: jest.fn((listener: (message: unknown) => Promise<void>) => {
          receiveMessage = listener;
          return { dispose: jest.fn() };
        }),
        postMessage,
      },
    };
    mockApplyWebView.mockReturnValue(panel as unknown as import('vscode').WebviewPanel);
    workspace.asRelativePath.mockReturnValue('workspace/logs/virtual.log');
    const context = createMockContext();
    const logUri = Uri.parse('memfs:/repository/logs/virtual.log');

    await LogView.createView(
      context as unknown as import('../../Context.js').Context,
      Promise.resolve(),
      logUri,
      'log body',
    );
    expect(panel.webview.html).toContain('webview:/test/extension/out/bundle.js');
    expect(panel.webview.html).toContain('webview:/test/extension/out/codicon.css');

    await receiveMessage?.({ cmd: 'fetchLog', requestId: 'request-1' });

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

    await receiveMessage?.({ cmd: 'openPath', payload: 'file:///untrusted.log' });

    expect(context.display.showFile).toHaveBeenCalledWith(logUri);
  });

  it('points the packaged template at webview URIs', async () => {
    const panel = {
      iconPath: undefined,
      onDidDispose: jest.fn(() => ({ dispose: jest.fn() })),
      webview: {
        asWebviewUri: jest.fn((uri: { path: string }) => Uri.parse(`webview:${uri.path}`)),
        html: '',
        onDidReceiveMessage: jest.fn(() => ({ dispose: jest.fn() })),
        postMessage: jest.fn(),
      },
    };
    mockApplyWebView.mockReturnValue(panel as unknown as import('vscode').WebviewPanel);

    await LogView.createView(createMockContext() as unknown as import('../../Context.js').Context);

    expect(mockReadFile).toHaveBeenCalledWith(Uri.parse('file:///test/extension/out/index.html'));
    expect(panel.webview.html).toContain('webview:/test/extension/out/bundle.js');
    expect(panel.webview.html).not.toContain('src="bundle.js"');
  });

  it('fetches the template where workspace.fs has no provider for it', async () => {
    const panel = {
      iconPath: undefined,
      onDidDispose: jest.fn(() => ({ dispose: jest.fn() })),
      webview: {
        asWebviewUri: jest.fn((uri: { path: string }) => Uri.parse(`webview:${uri.path}`)),
        html: '',
        onDidReceiveMessage: jest.fn(() => ({ dispose: jest.fn() })),
        postMessage: jest.fn(),
      },
    };
    mockApplyWebView.mockReturnValue(panel as unknown as import('vscode').WebviewPanel);
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      text: () => Promise.resolve('<script type="module" src="bundle.js"></script>'),
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const context = createMockContext();
    context.context.extensionUri = Uri.parse('http://localhost:3001/static/devextensions');

    await LogView.createView(context as unknown as import('../../Context.js').Context);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3001/static/devextensions/out/index.html',
    );
    expect(mockReadFile).not.toHaveBeenCalled();
    expect(panel.webview.html).toContain('webview:/static/devextensions/out/bundle.js');
  });

  it('reports the status when the template cannot be fetched', async () => {
    mockApplyWebView.mockReturnValue({
      iconPath: undefined,
      onDidDispose: jest.fn(() => ({ dispose: jest.fn() })),
      webview: {
        asWebviewUri: jest.fn((uri: { path: string }) => Uri.parse(`webview:${uri.path}`)),
        html: '',
        onDidReceiveMessage: jest.fn(() => ({ dispose: jest.fn() })),
        postMessage: jest.fn(),
      },
    } as unknown as import('vscode').WebviewPanel);
    globalThis.fetch = jest
      .fn()
      .mockResolvedValue({ ok: false, status: 404 }) as unknown as typeof fetch;
    const context = createMockContext();
    context.context.extensionUri = Uri.parse('http://localhost:3001/static/devextensions');

    await expect(
      LogView.createView(context as unknown as import('../../Context.js').Context),
    ).rejects.toThrow('Could not read the log viewer at');
  });
});
