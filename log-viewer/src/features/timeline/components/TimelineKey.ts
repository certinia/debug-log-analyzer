/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { globalStyles } from '../../../ui/styles/global.styles.js';
import { type TimelineGroup } from '../services/Timeline.js';
@customElement('timeline-key')
export class Timelinekey extends LitElement {
  @property()
  timelineKeys: TimelineGroup[] = [];

  constructor() {
    super();
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
    for (const keyMeta of this.timelineKeys) {
      keyParts.push(
        html`<div class="timeline-key__entry" style="background-color:${keyMeta.fillColor}">
          <span>${keyMeta.label}</span>
        </div>`,
      );
    }

    return keyParts;
  }
}
