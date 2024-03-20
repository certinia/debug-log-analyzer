/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import { globalStyles } from '../styles/global.styles.js';
import { keyMap, type TimelineGroup } from './Timeline.js';

@customElement('timeline-key')
export class Timelinekey extends LitElement {
  @state()
  timlineKeys: TimelineGroup[] = Array.from(keyMap.values());

  constructor() {
    super();

    // NOTE: If we passed in the key as a propoerty we would not need to listen for this.
    // This is a work around and may be revisted.
    window.addEventListener('message', (e: MessageEvent) => {
      this.handleMessage(e);
    });
  }

  static styles = [
    globalStyles,
    css`
      :host {
        margin-top: 5px;
      }
      .timeline-key__entry {
        display: inline-block;
        font-size: 0.9rem;
        padding: 4px;
        margin-right: 5px;
        color: #ffffff;
        font-family: monospace;
      }
    `,
  ];

  render() {
    const keyParts = [];
    for (const keyMeta of this.timlineKeys) {
      keyParts.push(
        html`<div class="timeline-key__entry" style="background-color:${keyMeta.fillColor}">
          <span>${keyMeta.label}</span>
        </div>`,
      );
    }

    return keyParts;
  }

  private handleMessage(evt: MessageEvent) {
    const { cmd } = evt.data;
    switch (cmd) {
      case 'getConfig':
        this.timlineKeys = Array.from(keyMap.values());
        break;
    }
  }
}
