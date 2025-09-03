/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html, type PropertyValues } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { ApexLog } from '../../../core/log-parser/LogEvents.js';
import { globalStyles } from '../../../ui/styles/global.styles.js';
import { skeletonStyles } from '../../../ui/styles/skeleton.styles.js';
import { init as timelineInit, type TimelineGroup } from '../services/Timeline.js';
import './TimelineKey.js';

@customElement('timeline-view')
export class TimelineView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;
  @property()
  timelineKeys: TimelineGroup[] = [];

  get _timelineContainer(): HTMLDivElement | null {
    return this.renderRoot?.querySelector('#timeline-container') ?? null;
  }

  constructor() {
    super();
  }

  updated(changedProperties: PropertyValues): void {
    const timlineRoot = changedProperties.has('timelineRoot');
    if (this.timelineRoot && timlineRoot) {
      const timelineContainer = this._timelineContainer;

      if (timelineContainer) {
        timelineInit(timelineContainer, this.timelineRoot);
      }
    }
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

      .skeleton-text {
        width: 100%;
        height: 1.5rem;
        margin-bottom: 0.5rem;
        border-radius: 0.25rem;
      }

      .skeleton-wrapper {
        display: flex;
        bottom: 0px;
        position: absolute;
        width: 100%;
        flex-direction: column;
        justify-content: center;
      }

      .skeleton-inline {
        position: absolute;
        display: flex;
        gap: 10px;
      }
    `,
  ];

  render() {
    const skeleton = !this.timelineRoot
      ? this._getSkeletonTimeline()
      : html`<canvas id="timeline" class="timeline-hover"></canvas>`;

    return html`
      <div id="timeline-container">${skeleton}</div>
      <timeline-key .timelineKeys="${this.timelineKeys}"></timeline-key>
    `;
  }

  _getSkeletonTimeline() {
    return html`<div class="skeleton-wrapper">
      <div class="skeleton-inline" style="width: 8%; bottom: 8rem; left: 15%;">
        <div class="skeleton skeleton-text" style="width: 80%;"></div>
        <div class="skeleton skeleton-text" style="width: 20%;"></div>
      </div>

      <div class="skeleton-inline" style="width: 20%; bottom: 6rem; left: 13%;">
        <div class="skeleton skeleton-text" style="width: 60%;"></div>
        <div class="skeleton skeleton-text" style="width: 40%;"></div>
      </div>

      <div class="skeleton-inline" style="width: 45%; bottom: 4rem; left: 10%;">
        <div class="skeleton skeleton-text" style="width: 60%;"></div>
        <div class="skeleton skeleton-text" style="width: 40%;"></div>
      </div>

      <div class="skeleton-inline" style="width: 30%; bottom: 4rem; left: 65%;">
        <div class="skeleton skeleton-text" style="width: 10%;"></div>
        <div class="skeleton skeleton-text" style="width: 30%;"></div>
        <div class="skeleton skeleton-text" style="width: 40%;"></div>
      </div>

      <div class="skeleton-inline" style="width: 90%; bottom: 2rem; left: 5%">
        <div class="skeleton skeleton-text" style="width: 60%;"></div>
        <div class="skeleton skeleton-text" style="width: 40%;"></div>
      </div>
      <div class="skeleton skeleton-text skeleton-inline" style="width: 100%; bottom:0;"></div>
    </div>`;
  }
}
