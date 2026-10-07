// Stands in for the VS Code extension host (lana/src/commands/LogView.ts) so the log viewer runs on the docs site.
(() => {
  const LOG_NAME = 'sample-log.log';
  // The captured themes name Windows fonts only.
  const FONTS = {
    '--vscode-font-family':
      '-apple-system, BlinkMacSystemFont, "Segoe WPC", "Segoe UI", Ubuntu, "Droid Sans", sans-serif',
    '--vscode-editor-font-family':
      'Menlo, Monaco, Consolas, "Droid Sans Mono", "Courier New", monospace',
  };

  function applyTheme(name) {
    const theme = globalThis.VSCODE_THEMES[name === 'light' ? 'light' : 'dark'];
    const root = document.documentElement;
    root.setAttribute('style', theme.style);
    for (const [property, value] of Object.entries(FONTS)) {
      root.style.setProperty(property, value);
    }
    const body = document.body;
    body.classList.remove('vscode-dark', 'vscode-light');
    body.classList.add(theme.kind);
    body.dataset.vscodeThemeKind = theme.kind;
    body.dataset.vscodeThemeName = theme.name;
    body.dataset.vscodeThemeId = theme.name;
  }

  function reply(requestId, cmd, payload, error) {
    window.postMessage({ requestId, cmd, payload, error }, location.origin);
  }

  let toastTimer;
  function toast(text) {
    let element = document.getElementById('demo-toast');
    if (!element) {
      element = document.createElement('div');
      element.id = 'demo-toast';
      element.setAttribute('role', 'status');
      element.style.cssText =
        'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:1000;' +
        'padding:8px 14px;border-radius:6px;font-size:13px;box-shadow:0 2px 8px var(--vscode-widget-shadow);' +
        'background:var(--vscode-notifications-background);color:var(--vscode-notifications-foreground);' +
        'border:1px solid var(--vscode-notifications-border, transparent)';
      document.body.append(element);
    }
    element.textContent = text;
    element.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      element.hidden = true;
    }, 4000);
  }

  function download({ fileContent, options }) {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(new Blob([fileContent], { type: 'text/plain' }));
    link.download = options.defaultFileName;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  const VSCODE_ONLY = {
    openType: 'Go to Code opens the Apex source in VS Code.',
    openPath: 'Opens the log file in VS Code.',
    goToLogLine: 'Shows this line of the raw log in VS Code.',
  };

  globalThis.acquireVsCodeApi = () => ({
    postMessage({ cmd, requestId, payload }) {
      switch (cmd) {
        case 'fetchLog':
          reply(requestId, cmd, {
            logName: LOG_NAME,
            logUri: new URL(LOG_NAME, location.href).href,
          });
          return;
        case 'openHelp':
          window.open(new URL('..', location.href).href, '_blank', 'noopener');
          return;
        case 'openUrl':
          if (typeof payload === 'string' && payload.startsWith('https://')) {
            window.open(payload, '_blank', 'noopener');
          }
          return;
        case 'saveFile':
          download(payload);
          return;
        case 'getConfig':
          fetch('settings.json')
            .then((response) => response.json())
            .then(
              (settings) => reply(requestId, cmd, settings),
              (error) => reply(requestId, cmd, undefined, String(error)),
            );
          return;
        case 'updateConfig':
          return;
      }
      if (cmd in VSCODE_ONLY) {
        toast(`${VSCODE_ONLY[cmd]} Install the extension to use it.`);
        return;
      }
      if (requestId) {
        reply(requestId, cmd, undefined, `"${cmd}" is not available in the demo`);
      }
    },
    getState() {
      return undefined;
    },
    setState() {},
  });

  window.addEventListener('message', (event) => {
    if (event.origin === location.origin && event.data?.type === 'lana-demo-theme') {
      applyTheme(event.data.theme);
    }
  });

  // VS Code adds these defaults to every webview; the viewer relies on them.
  // overscroll-behavior keeps a scroll that reaches an edge from moving the docs page instead.
  const defaults = document.createElement('style');
  defaults.textContent =
    'html,body{overscroll-behavior:none}' +
    'html{background-color:var(--vscode-editor-background)}' +
    'body{margin:0;font-family:var(--vscode-font-family);font-weight:var(--vscode-font-weight)}';
  document.head.append(defaults);

  const requested = new URLSearchParams(location.search).get('theme');
  const prefersLight = matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(requested ?? (prefersLight ? 'light' : 'dark'));
})();
