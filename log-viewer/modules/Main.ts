/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { html, render } from 'lit';

import './components/LogViewer';
import { setColors } from './timeline/Timeline.js';

import { vscodeMessenger } from './services/VSCodeExtensionMessenger.js';

function onInit(): void {
  vscodeMessenger.request('getConfig').then((msg: any) => {
    setColors(msg.timeline.colors);
  });
  render(html`<log-viewer></log-viewer>`, document.body);
}

window.addEventListener('DOMContentLoaded', onInit);
