/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, describe, expect, it } from '@jest/globals';

import { createMockContext } from '../../__tests__/helpers/test-builders.js';
import { Uri, workspace } from '../../__tests__/mocks/vscode.js';
import { setEmbeddedLogViewerAssets } from '../../display/LogViewerAssets.js';
import { getConfig } from '../../workspace/AppConfig.js';
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
  function createPanel() {
    return {
      iconPath: undefined,
      onDidDispose: jest.fn(() => ({ dispose: jest.fn() })),
      webview: {
        asWebviewUri: jest.fn((uri: { path: string }) => Uri.parse(`webview:${uri.path}`)),
        html: '',
        onDidReceiveMessage: jest.fn(() => ({ dispose: jest.fn() })),
        postMessage: jest.fn(),
      },
    };
  }

  afterEach(() => {
    setEmbeddedLogViewerAssets(undefined);
  });

  async function createViewWithListener() {
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
      script: '',
      codiconCss: '',
      codiconFont: '',
    });

    await LogView.createView(
      createMockContext() as unknown as import('../../Context.js').Context,
      Promise.resolve(),
      Uri.parse('memfs:/repository/logs/virtual.log'),
      'log body',
    );

    return { postMessage, receive: (message: unknown) => receiveMessage!(message) };
  }

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
    const codiconHref = /<link[^>]*\bid="vscode-codicon-stylesheet"[^>]*\bhref="([^"]+)"/.exec(
      panel.webview.html,
    )?.[1];
    expect(codiconHref).toMatch(/^data:text\/css;charset=utf-8,/);
    const codiconCss = decodeURIComponent(codiconHref!.slice(codiconHref!.indexOf(',') + 1));
    expect(codiconCss).toContain('/* $& */');
    expect(codiconCss).toContain('data:font/ttf;base64,Zm9udA==');
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
    const panel = createPanel();
    mockApplyWebView.mockReturnValue(panel as unknown as import('vscode').WebviewPanel);
    mockReadFile.mockResolvedValue(
      new TextEncoder().encode('<script src="bundle.js"></script><link href="codicon.css">'),
    );

    await LogView.createView(createMockContext() as unknown as import('../../Context.js').Context);

    expect(mockReadFile).toHaveBeenCalledWith(Uri.parse('file:///test/extension/out/index.html'));
    expect(panel.webview.html).toContain('webview:/test/extension/out/bundle.js');
    expect(panel.webview.html).not.toContain('src="bundle.js"');
  });

  it('names the file it could not read when the packaged template is missing', async () => {
    const panel = createPanel();
    mockApplyWebView.mockReturnValue(panel as unknown as import('vscode').WebviewPanel);
    mockReadFile.mockRejectedValue(new Error('ENOENT'));

    await expect(
      LogView.createView(createMockContext() as unknown as import('../../Context.js').Context),
    ).rejects.toThrow('Could not read the log viewer at /test/extension/out/index.html: ENOENT');
  });

  it('answers a request whose case throws, so the webview stops waiting', async () => {
    const { receive, postMessage } = await createViewWithListener();

    (getConfig as jest.Mock).mockImplementationOnce(() => {
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
