/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { ApexLog } from '../../../core/log-parser/LogEvents.js';
import { VSCodeExtensionMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { getSettings } from '../../settings/Settings.js';
import { type TimelineGroup, keyMap, setColors } from '../services/Timeline.js';

import { DEFAULT_THEME, type TimelineColors } from '../themes/Themes.js';
import { getTheme } from '../themes/ThemeSelector.js';

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

  @state()
  activeTheme: string | null = null;

  @state()
  private timelineKeys: TimelineGroup[] = [];

  @state()
  private useLegacyTimeline: boolean | null = null;

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

    VSCodeExtensionMessenger.listen<{ activeTheme: string }>((event) => {
      const { cmd, payload } = event.data;
      if (cmd === 'switchTimelineTheme' && this.activeTheme !== payload.activeTheme) {
        this.setTheme(payload.activeTheme ?? DEFAULT_THEME);
      }
    });

    getSettings().then((settings) => {
      this.useLegacyTimeline = settings.timeline.legacy;

      if (!this.useLegacyTimeline) {
        this.setTheme(settings.timeline.activeTheme ?? DEFAULT_THEME);
      } else {
        setColors(settings.timeline.colors);
        this.timelineKeys = Array.from(keyMap.values());
      }
    });
  }

  render() {
    if (!this.timelineRoot || this.useLegacyTimeline === null) {
      return html`<timeline-skeleton></timeline-skeleton>
        <timeline-key .timelineKeys="${this.timelineKeys}"></timeline-key>`;
    }

    if (!this.useLegacyTimeline) {
      return html`<timeline-flame-chart
          .apexLog=${this.timelineRoot}
          .themeName=${this.activeTheme}
        ></timeline-flame-chart>
        <timeline-key .timelineKeys="${this.timelineKeys}"></timeline-key>`;
    }
    return html`<timeline-legacy
        .apexLog=${this.timelineRoot}
        .themeName=${this.activeTheme}
      ></timeline-legacy
      ><timeline-key .timelineKeys="${this.timelineKeys}"></timeline-key>`;
  }

  private setTheme(themeName: string) {
    this.activeTheme = themeName ?? DEFAULT_THEME;
    this.timelineKeys = this.toTimelineKeys(getTheme(themeName));
  }

  private toTimelineKeys(colors: TimelineColors): TimelineGroup[] {
    return [
      {
        label: 'Code Unit',
        fillColor: colors.codeUnit,
      },
      {
        label: 'Workflow',
        fillColor: colors.workflow,
      },
      {
        label: 'Method',
        fillColor: colors.method,
      },
      {
        label: 'Flow',
        fillColor: colors.flow,
      },
      {
        label: 'DML',
        fillColor: colors.dml,
      },
      {
        label: 'SOQL',
        fillColor: colors.soql,
      },
      {
        label: 'System Method',
        fillColor: colors.system,
      },
    ];
  }
}
