/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { ApexLog } from '../../../core/log-parser/LogEvents.js';
import { getSettings } from '../../settings/Settings.js';
import { type TimelineGroup } from '../services/Timeline.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';

// web components
import './TimelineFlameChart.js';
import './TimelineKey.js';
import './TimelineLegacy.js';
import './TimelineSkeleton.js';

@customElement('timeline-view')
export class TimelineView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;
  @property()
  timelineKeys: TimelineGroup[] = [];

  @state()
  private isNewTimelineEnabled: boolean | null = null;

  constructor() {
    super();
  }

  static styles = [
    globalStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        flex: 1;
        position: relative;
        width: 100%;
        height: 80%;
      }
    `,
  ];

  async connectedCallback() {
    super.connectedCallback();
    const settings = await getSettings();
    this.isNewTimelineEnabled = settings.timeline.experimental.timeline;
  }

  render() {
    let timelineBody;
    if (!this.timelineRoot || this.isNewTimelineEnabled === null) {
      timelineBody = html`<timeline-skeleton></timeline-skeleton>`;
    } else if (this.isNewTimelineEnabled) {
      timelineBody = html`<timeline-flame-chart
        .apexLog=${this.timelineRoot}
      ></timeline-flame-chart>`;
    } else {
      timelineBody = html`<timeline-legacy .apexLog=${this.timelineRoot}></timeline-legacy>`;
    }

    return html`
      ${timelineBody}
      <timeline-key .timelineKeys="${this.timelineKeys}"></timeline-key>
    `;
  }
}
