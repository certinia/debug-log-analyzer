/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { html, render } from 'lit';

// Components adopt the --lana-* tokens themselves (styles/tokens.styles.ts); this
// import guarantees the document-level copy, which styles the popups tabulator
// appends to document.body.
import './styles/tokens.css';

// web components
import './features/app/LogViewer';

function onInit(): void {
  render(html`<log-viewer></log-viewer>`, document.body);
}

window.addEventListener('DOMContentLoaded', onInit, { once: true });
