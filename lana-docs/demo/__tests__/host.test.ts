import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

interface HostMessage {
  requestId?: string;
  cmd: string;
  payload?: unknown;
  error?: string;
}

interface VsCodeApi {
  postMessage(message: { cmd: string; requestId?: string; payload?: unknown }): void;
}

const HOST_SOURCE = readFileSync(join(__dirname, '..', 'host.js'), 'utf8');
const SETTINGS = { timeline: { legacy: false } };
// As in build-demo.mjs: the published demo pairs this host with the release's viewer.
const VIEWER_SRC = join(
  process.env.DEMO_VIEWER_ROOT ?? join(__dirname, '..', '..', '..'),
  'log-viewer',
  'src',
);
const MESSENGER_CALL = /\.(?:send|request)(?:<[^>]*>)?\(\s*'([A-Za-z]+)'/g;

function viewerCommands(): string[] {
  const sources = readdirSync(VIEWER_SRC, { recursive: true, encoding: 'utf8' })
    .filter((file) => file.endsWith('.ts') && !file.includes('__tests__'))
    .map((file) => readFileSync(join(VIEWER_SRC, file), 'utf8'));
  const names = sources.flatMap((source) =>
    [...source.matchAll(MESSENGER_CALL)].map((match) => match[1]),
  );
  return [...new Set(names)].sort();
}

const fetchSettings = jest.fn(async (_url: string) => ({ json: async () => SETTINGS }));

function loadHost(): VsCodeApi {
  Object.assign(globalThis, {
    VSCODE_THEMES: {
      dark: { style: '--vscode-editor-background: #000', kind: 'vscode-dark', name: 'Dark' },
      light: { style: '--vscode-editor-background: #fff', kind: 'vscode-light', name: 'Light' },
    },
    matchMedia: () => ({ matches: false }),
    fetch: fetchSettings,
  });
  new Function(HOST_SOURCE)();
  return (globalThis as unknown as { acquireVsCodeApi(): VsCodeApi }).acquireVsCodeApi();
}

function replyTo(requestId: string): Promise<HostMessage> {
  return new Promise((resolve) => {
    const onMessage = (event: MessageEvent<HostMessage>): void => {
      if (event.data?.requestId === requestId) {
        window.removeEventListener('message', onMessage);
        resolve(event.data);
      }
    };
    window.addEventListener('message', onMessage);
  });
}

function postTheme(theme: string, origin: string): void {
  window.dispatchEvent(
    new MessageEvent('message', { data: { type: 'lana-demo-theme', theme }, origin }),
  );
}

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  document.body.removeAttribute('class');
  window.history.replaceState(null, '', '/debug-log-analyzer/demo/viewer.html');
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('contract with the viewer', () => {
  const commands = viewerCommands();

  it('finds the commands the viewer sends', () => {
    expect(commands).toEqual(expect.arrayContaining(['fetchLog', 'getConfig']));
  });

  it.each(commands)('handles "%s"', (cmd) => {
    const api = loadHost();
    const post = jest.spyOn(window, 'postMessage');
    jest.spyOn(window, 'open').mockReturnValue(null);
    URL.createObjectURL = jest.fn(() => 'blob:demo');
    URL.revokeObjectURL = jest.fn();

    api.postMessage({
      cmd,
      requestId: cmd,
      payload: { fileContent: '', options: { defaultFileName: 'log.txt' } },
    });

    expect(post).not.toHaveBeenCalledWith(
      expect.objectContaining({ error: expect.stringContaining('not available') }),
      expect.anything(),
    );
  });
});

describe('theme', () => {
  it('starts in the theme the page asks for', () => {
    window.history.replaceState(null, '', '?theme=light');
    loadHost();

    expect(document.body.dataset.vscodeThemeKind).toBe('vscode-light');
    expect(document.body.classList.contains('vscode-light')).toBe(true);
  });

  it('follows a theme message from the docs page', () => {
    loadHost();
    expect(document.body.dataset.vscodeThemeKind).toBe('vscode-dark');

    postTheme('light', window.location.origin);

    expect(document.body.dataset.vscodeThemeKind).toBe('vscode-light');
    expect(document.body.classList.contains('vscode-dark')).toBe(false);
  });

  it('ignores a theme message from another origin', () => {
    loadHost();

    postTheme('light', 'https://example.com');

    expect(document.body.dataset.vscodeThemeKind).toBe('vscode-dark');
  });
});

it('stops a scroll at the edge of the demo from moving the docs page', () => {
  loadHost();

  const styles = [...document.head.querySelectorAll('style')].map((style) => style.textContent);
  expect(styles.join('')).toContain('html,body{overscroll-behavior:none}');
});

describe('requests', () => {
  it('answers fetchLog with the sample log', async () => {
    const api = loadHost();
    const reply = replyTo('1');

    api.postMessage({ cmd: 'fetchLog', requestId: '1' });

    await expect(reply).resolves.toEqual({
      requestId: '1',
      cmd: 'fetchLog',
      payload: {
        logName: 'sample-log.log',
        logUri: 'http://localhost/debug-log-analyzer/demo/sample-log.log',
      },
      error: undefined,
    });
  });

  it('answers getConfig with the built settings', async () => {
    const api = loadHost();
    const reply = replyTo('2');

    api.postMessage({ cmd: 'getConfig', requestId: '2' });

    await expect(reply).resolves.toMatchObject({ requestId: '2', payload: SETTINGS });
    expect(fetchSettings).toHaveBeenCalledWith('settings.json');
  });

  it('answers getConfig with an error when the settings fail to load', async () => {
    const api = loadHost();
    fetchSettings.mockRejectedValueOnce(new Error('offline'));
    const reply = replyTo('3');

    api.postMessage({ cmd: 'getConfig', requestId: '3' });

    await expect(reply).resolves.toMatchObject({ requestId: '3', error: 'Error: offline' });
  });

  it('answers an unknown request with an error, so the viewer does not wait forever', async () => {
    const api = loadHost();
    const reply = replyTo('4');

    api.postMessage({ cmd: 'notACommand', requestId: '4' });

    await expect(reply).resolves.toMatchObject({
      requestId: '4',
      error: '"notACommand" is not available in the demo',
    });
  });
});

describe('VS Code only commands', () => {
  it.each(['openType', 'openPath', 'goToLogLine'])('%s explains it needs the extension', (cmd) => {
    const api = loadHost();

    api.postMessage({ cmd, payload: 'MyClass' });

    expect(document.getElementById('demo-toast')?.textContent).toMatch(
      /Install the extension to use it\.$/,
    );
  });
});

describe('links', () => {
  it('opens https links in a new tab', () => {
    const api = loadHost();
    const open = jest.spyOn(window, 'open').mockReturnValue(null);

    api.postMessage({ cmd: 'openUrl', payload: 'https://example.com/' });

    expect(open).toHaveBeenCalledWith('https://example.com/', '_blank', 'noopener');
  });

  it('does not open other link schemes', () => {
    const api = loadHost();
    const open = jest.spyOn(window, 'open').mockReturnValue(null);

    api.postMessage({ cmd: 'openUrl', payload: 'javascript:alert(1)' });

    expect(open).not.toHaveBeenCalled();
  });
});
