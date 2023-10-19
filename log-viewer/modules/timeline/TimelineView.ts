/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, type PropertyValues, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { skeletonStyles } from '../components/skeleton/skeleton.styles.js';
import { globalStyles } from '../global.styles.js';
import { RootNode, init as timelineInit } from './Timeline.js';
import './TimelineKey.js';

@customElement('timeline-view')
export class TimelineView extends LitElement {
  @property()
  timelineRoot: RootNode | null = null;

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
        height: 75%;
      }

      #timeline-tooltip {
        display: none;
        position: absolute;
        max-width: 90%;
        z-index: 1000;
        padding: 5px;
        border-radius: 4px;
        background-color: var(--vscode-editor-background);
        color: var(--vscode-editor-foreground);
        font-family: monospace;
        font-size: 1rem;
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
      : html`<canvas id="timeline"></canvas>`;

    return html`
      <div id="timeline-container">${skeleton}</div>
      <timeline-key></timeline-key>
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
