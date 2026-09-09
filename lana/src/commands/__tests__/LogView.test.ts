/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, describe, expect, it } from '@jest/globals';

import { createMockContext } from '../../__tests__/helpers/test-builders.js';
import { Uri, workspace } from '../../__tests__/mocks/vscode.js';
import { setEmbeddedLogViewerAssets } from '../../display/LogViewerAssets.js';
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
  afterEach(() => {
    setEmbeddedLogViewerAssets(undefined);
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
    setEmbeddedLogViewerAssets({
      html: '<link id="vscode-codicon-stylesheet" href="codicon.css" /><script type="module" src="bundle.js"></script>',
      script: 'const replacementToken = "$&"; globalThis.viewerLoaded = true;',
      codiconCss: '@font-face { src: url("./codicon.ttf?hash") format("truetype"); } /* $& */',
      codiconFont: 'Zm9udA==',
    });
    workspace.asRelativePath.mockReturnValue('workspace/logs/virtual.log');
    const context = createMockContext();
    const logUri = Uri.parse('memfs:/repository/logs/virtual.log');

    await LogView.createView(
      context as unknown as import('../../Context.js').Context,
      Promise.resolve(),
      logUri,
      'log body',
    );
    expect(panel.webview.html).toContain(
      '<script type="module">const replacementToken = "$&"; globalThis.viewerLoaded = true;',
    );
    expect(panel.webview.html).toContain('/* $& */');
    expect(panel.webview.html).toContain('data:font/ttf;base64,Zm9udA==');
    expect(mockReadFile).not.toHaveBeenCalled();

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

  it('loads the packaged template when embedded browser assets are not configured', async () => {
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
    mockReadFile.mockResolvedValue(
      new TextEncoder().encode('<script src="bundle.js"></script><link href="codicon.css">'),
    );

    await LogView.createView(createMockContext() as unknown as import('../../Context.js').Context);

    expect(mockReadFile).toHaveBeenCalledWith(Uri.parse('file:///test/extension/out/index.html'));
    expect(panel.webview.html).toContain('webview:/test/extension/out/bundle.js');
    expect(panel.webview.html).not.toContain('src="bundle.js"');
  });
});
