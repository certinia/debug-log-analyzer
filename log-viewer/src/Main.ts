/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { html, render } from 'lit';

import './app/LogViewer';

function onInit(): void {
  render(html`<log-viewer></log-viewer>`, document.body);
}

window.addEventListener('DOMContentLoaded', onInit, { once: true });
