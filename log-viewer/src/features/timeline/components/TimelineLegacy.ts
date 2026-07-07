/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property, query } from 'lit/decorators.js';

import type { ApexLog } from 'apex-log-parser';
import { init as timelineInit } from '../services/Timeline.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';
import { skeletonStyles } from '../../../styles/skeleton.styles.js';

// web components
import './TimelineFlameChart.js';
import './TimelineKey.js';

@customElement('timeline-legacy')
export class TimelineLegacy extends LitElement {
  @property()
  apexLog: ApexLog | null = null;

  @query('#timeline-container')
  private _container!: HTMLDivElement;

  constructor() {
    super();
  }

  static styles = [
    globalStyles,
    skeletonStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        flex: 1;
        position: relative;
        width: 100%;
        height: 80%;
      }

      #timeline-tooltip {
        display: none;
        position: absolute;
        max-width: 75%;
        min-width: 150px;
      }

      .timeline-tooltip {
        position: relative;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.5);
        backdrop-filter: blur(6px);
        z-index: 1000;
        padding: 5px;
        border-radius: 4px;
        border-left: 4px solid;
        background-color: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        font-family: monospace;
        font-size: 0.92rem;
        pointer-events: none;
        transition: opacity 0.15s ease;
      }

      .tooltip-header {
        font-weight: 500;
        margin-bottom: 10px;
        overflow: hidden;
        text-overflow: ellipsis;
        line-height: 1em;
      }

      .tooltip-row {
        display: flex;
        justify-content: space-between;
        align-items: baseline;
        padding: 2px 0;
      }

      .tooltip-label {
        flex: 1 1 auto;
        overflow: hidden;
        white-space: nowrap;
        text-overflow: ellipsis;
        padding-right: 12px;
      }

      .tooltip-value {
        flex-shrink: 0;
        font-variant-numeric: tabular-nums;
        font-weight: 500;
        font-family: monospace;
        opacity: 0.9;
        text-align: right;
        white-space: nowrap;
      }

      .timeline-event--hover {
        cursor: auto;
      }

      #timeline-container {
        position: relative;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        height: 100%;
        min-height: 0%;
        min-width: 0%;
        flex: 1;
      }

      #timeline {
        background-color: var(--vscode-editor-background);
        z-index: 0;
        width: 100%;
        height: 100%;
      }

      .timeline-hover:hover {
        cursor: pointer;
      }

      .timeline-dragging {
        cursor: -webkit-grabbing;
        cursor: grabbing;
      }
    `,
  ];

  updated(changedProps: PropertyValues) {
    if (changedProps.has('apexLog') && this.apexLog) {
      timelineInit(this._container, this.apexLog);
    }
  }

  render() {
    return html`<div id="timeline-container">
      <canvas id="timeline" class="timeline-hover"></canvas>
    </div>`;
  }
}
