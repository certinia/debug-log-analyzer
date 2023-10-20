/*
 * Copyright (c) 2020 Certinia Inc. All rights reserved.
 */
import { html, render } from 'lit';

import './components/LogViewer';
import { hostService } from './services/VSCodeService.js';
import { setColors } from './timeline/Timeline.js';

function handleMessage(evt: MessageEvent) {
  const message = evt.data;
  switch (message.command) {
    case 'getConfig':
      setColors(message.data.timeline.colors);
      break;
  }
}

function onInit(): void {
  render(html`<log-viewer></log-viewer>`, document.body);

  hostService().getConfig();
}

window.addEventListener('DOMContentLoaded', onInit);
window.addEventListener('message', handleMessage);
