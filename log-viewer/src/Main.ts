/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { html, render } from 'lit';

// styles
import codiconStyles from '@vscode/codicons/dist/codicon.css';

// web components
import './features/app/LogViewer';

/**
 * vscode-icon requires a page-level stylesheet link with this id, which it
 * clones into its shadow root for the codicon font. Serve the bundled css
 * (font inlined as a data URI) via a blob URL so no external asset is needed.
 */
function injectCodiconStylesheet(): void {
  const link = document.createElement('link');
  link.id = 'vscode-codicon-stylesheet';
  link.rel = 'stylesheet';
  link.href = URL.createObjectURL(new Blob([String(codiconStyles)], { type: 'text/css' }));
  document.head.appendChild(link);
}

function onInit(): void {
  injectCodiconStylesheet();
  render(html`<log-viewer></log-viewer>`, document.body);
}

window.addEventListener('DOMContentLoaded', onInit, { once: true });
