/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */

import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

import { ApexLog } from '../../parsers/ApexLogParser.js';
import { globalStyles } from '../../styles/global.styles.js';
import '../CallStack.js';
import './DMLView.js';
import './DatabaseSOQLDetailPanel.js';
import './DatabaseSection.js';
import './SOQLView.js';

@customElement('database-view')
export class DatabaseView extends LitElement {
  @property()
  timelineRoot: ApexLog | null = null;

  constructor() {
    super();
  }

  static styles = [
    globalStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
      }
    `,
  ];

  render() {
    return html`
      <dml-view .timelineRoot="${this.timelineRoot}"></dml-view>
      <soql-view .timelineRoot="${this.timelineRoot}"></soql-view>
    `;
  }
}
