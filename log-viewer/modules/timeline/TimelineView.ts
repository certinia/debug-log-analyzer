/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, PropertyValues, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { globalStyles } from '../global.styles';
import { RootNode, init as timelineInit } from './Timeline';
import './TimelineKey';

@customElement('timeline-view')
export class TimelineView extends LitElement {
  @property()
  timelineRoot: RootNode | null = null;

  constructor() {
    super();
  }

  updated(changedProperties: PropertyValues): void {
    const timlineRoot = changedProperties.has('timelineRoot');
    if (this.timelineRoot && timlineRoot) {
      const timelineContainer = this.shadowRoot?.getElementById(
        'timeline-container'
      ) as HTMLDivElement;

      if (timelineContainer) {
        timelineInit(timelineContainer, this.timelineRoot);
      }
    }
  }

  static styles = [
    globalStyles,
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
    `,
  ];

  render() {
    return html`
      <div id="timeline-container">
        <canvas id="timeline"></canvas>
      </div>
      <timeline-key></timeline-key>
    `;
  }
}
