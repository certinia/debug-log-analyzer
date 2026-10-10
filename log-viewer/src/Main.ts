/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { html, render } from 'lit';

// Components adopt the --lana-* tokens themselves (styles/tokens.styles.ts); this
// import guarantees the document-level copy, which a component that reads a token
// without adopting them inherits.
import './styles/tokens.css';

// web components
import './features/app/LogViewer';

function onInit(): void {
  render(html`<log-viewer></log-viewer>`, document.body);
}

window.addEventListener('DOMContentLoaded', onInit, { once: true });
