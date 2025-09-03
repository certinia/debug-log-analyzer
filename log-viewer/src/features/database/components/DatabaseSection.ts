/*
 * Copyright (c) 2021 Certinia Inc. All rights reserved.
 */
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import type { LogEvent } from '../../../core/log-parser/LogEvents.js';
import '../../../ui/components/BadgeBase.js';
import { globalStyles } from '../../../ui/styles/global.styles.js';

@customElement('database-section')
export class DatabaseSection extends LitElement {
  @property({ type: String })
  title = '';
  @property({ type: Object, attribute: false })
  dbLines: LogEvent[] = [];

  static styles = [
    globalStyles,
    css`
      .dbSection {
        padding: 10px 5px 5px 0px;
      }
      .dbTitle {
        font-weight: bold;
        font-size: 1.2em;
      }
      .dbBlock {
        margin-left: 10px;
        font-weight: normal;
      }
    `,
  ];

  render() {
    const totalCount = this.dbLines.length;
    let totalRows = 0;
    this.dbLines.forEach((value) => {
      totalRows += value.dmlRowCount.self || value.soqlRowCount.self || 0;
    });

    return html`
      <div class="dbSection">
        <span class="dbTitle">${this.title}</span>
        <badge-base>Count: ${totalCount}</badge-base>
        <badge-base>Rows: ${totalRows}</badge-base>
      </div>
    `;
  }
}
