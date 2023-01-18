/*
 * Copyright (c) 2021 FinancialForce.com, inc. All rights reserved.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { DatabaseAccess } from '../Database';

import './CallStack.ts';

@customElement('database-row')
export class DatabaseRow extends LitElement {
  @property({ type: String }) key = '';

  static get styles() {
    return css`
      .dbDetail {
        flex-grow: 1;
      }
      .dbEntry {
        display: flex;
        margin-bottom: 10px;
      }
      .dbCount {
        width: 75px;
        min-width: 75px;
        text-align: right;
      }
      .dbRows {
        width: 90px;
        min-width: 90px;
        text-align: right;
      }
      .stackEntry {
        display: flex;
        margin-left: 180px;
      }
    `;
  }

  render() {
    const soqlMap = DatabaseAccess.instance()?.soqlMap;
    const dmlMap = DatabaseAccess.instance()?.dmlMap;

    if (soqlMap && dmlMap) {
      const entry = soqlMap.get(this.key) || dmlMap.get(this.key);
      if (entry) {
        const detail = this.key.substring(this.key.indexOf(' ') + 1);
        const stacks = entry.stacks.map((stack) => html`<call-stack stack=${stack}></call-stack>`);
        return html`
          <div class="dbEntry">
            <span class="dbDetail">${detail}${stacks}</span>
            <span class="dbCount">Count: ${entry.count}</span>
            <span class="dbRows">Rows: ${entry.rowCount}</span>
          </div>
        `;
      } else {
        return html`<p>No entry found for key ${this.key}</p>`;
      }
    }
  }
}
