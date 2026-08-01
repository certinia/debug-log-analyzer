/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { html, render } from 'lit';

// styles — document-level so the --lana-* tokens inherit into every shadow root
import './styles/tokens.css';

// web components
import './features/app/LogViewer';

function onInit(): void {
  render(html`<log-viewer></log-viewer>`, document.body);
}

window.addEventListener('DOMContentLoaded', onInit, { once: true });
