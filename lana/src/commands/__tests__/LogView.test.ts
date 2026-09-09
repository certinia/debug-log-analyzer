/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

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
// The file-I/O layer is deliberately not mocked out: createView reads its own
// bundled index.html, and mocking that module away is what hid it reading
// through a service that throws unless another extension has initialised it.
const mockReadFile = workspace.fs.readFile as unknown as jest.Mock;

describe('LogView', () => {
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
    mockReadFile.mockResolvedValue(
      new TextEncoder().encode('<script src="bundle.js"></script><link href="codicon.css">'),
    );
    workspace.asRelativePath.mockReturnValue('workspace/logs/virtual.log');
    const context = createMockContext();
    const logUri = Uri.parse('memfs:/repository/logs/virtual.log');

    await LogView.createView(
      context as unknown as import('../../Context.js').Context,
      Promise.resolve(),
      logUri,
      'log body',
    );
    // createView must resolve and rewrite the bundled index.html. It read that
    // file through a service needing another extension's initialisation, so it
    // rejected before the webview had any content.
    expect(panel.webview.html).toContain('webview:/test/extension/out/bundle.js');
    expect(panel.webview.html).not.toContain('src="bundle.js"');

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
});
