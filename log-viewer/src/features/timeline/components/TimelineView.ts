/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import type { ApexLog } from 'apex-log-parser';
import { VSCodeExtensionMessenger } from '../../../core/messaging/VSCodeExtensionMessenger.js';
import { getSettings } from '../../settings/Settings.js';
import { type TimelineGroup, keyMap, setColors } from '../services/Timeline.js';

import { DEFAULT_THEME_NAME, type TimelineColors } from '../themes/Themes.js';
import { addCustomThemes, getTheme } from '../themes/ThemeSelector.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';

// web components
import './TimelineFlameChart.js';
import './TimelineKey.js';
import './TimelineLegacy.js';
import './TimelineSkeleton.js';

/* eslint-disable @typescript-eslint/naming-convention */
interface ThemeSettings {
  [key: string]: {
    apex: string;
    codeUnit: string;
    system: string;
    automation: string;
    dml: string;
    soql: string;
    callout: string;
    validation: string;
  };
}
/* eslint-enable @typescript-eslint/naming-convention */

@customElement('timeline-view')
export class TimelineView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;

  @property({ type: Number })
  navigateToTimestamp: number | undefined = undefined;

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
        height: 90%;
      }
    `,
  ];

  async connectedCallback() {
    super.connectedCallback();

    VSCodeExtensionMessenger.listen<{ activeTheme: string }>((event) => {
      const { cmd, payload } = event.data;
      if (cmd === 'switchTimelineTheme' && this.activeTheme !== payload.activeTheme) {
        this.setTheme(payload.activeTheme ?? DEFAULT_THEME_NAME);
      }
    });

    getSettings().then((settings) => {
      const { timeline } = settings;
      this.useLegacyTimeline = timeline.legacy;

      if (!this.useLegacyTimeline) {
        addCustomThemes(this.toTheme(timeline.customThemes));
        this.setTheme(timeline.activeTheme ?? DEFAULT_THEME_NAME);
      } else {
        setColors(timeline.colors);
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
          .navigateToTimestamp=${this.navigateToTimestamp}
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
    this.activeTheme = themeName ?? DEFAULT_THEME_NAME;
    this.timelineKeys = this.toTimelineKeys(getTheme(themeName));
  }

  private toTheme(themeSettings: ThemeSettings): { [key: string]: TimelineColors } {
    const themes: { [key: string]: TimelineColors } = {};
    for (const [name, colors] of Object.entries(themeSettings)) {
      themes[name] = {
        apex: colors.apex,
        codeUnit: colors.codeUnit,
        system: colors.system,
        automation: colors.automation,
        dml: colors.dml,
        soql: colors.soql,
        callout: colors.callout,
        validation: colors.validation,
      };
    }
    return themes;
  }

  private toTimelineKeys(colors: TimelineColors): TimelineGroup[] {
    return [
      {
        label: 'Apex',
        fillColor: colors.apex,
      },
      {
        label: 'Code Unit',
        fillColor: colors.codeUnit,
      },
      {
        label: 'System',
        fillColor: colors.system,
      },
      {
        label: 'Automation',
        fillColor: colors.automation,
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
        label: 'Callout',
        fillColor: colors.callout,
      },
      //NOTE: add back once the parser is updated to include validation events
      // {
      //   label: 'Validation',
      //   fillColor: colors.validation,
      // },
    ];
  }
}
