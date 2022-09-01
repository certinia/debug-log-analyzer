/*
 * Copyright (c) 2021 FinancialForce.com, inc. All rights reserved.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { DatabaseAccess } from '../Database';

@customElement('database-row')
class DatabaseRow extends LitElement {
  @property({ type: String }) key = '';

  static get styles() {
    return css`
      .dbEntry {
        display: flex;
      }
      .dbCount {
        display: inline-block;
        width: 75px;
        min-width: 75px;
      }
      .dbRows {
        display: inline-block;
        width: 90px;
        min-width: 90px;
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
        const stacks = entry.stacks.map((stack) => html`<call-stack stack=${stack} />`);
        return html`
          <div class="dbEntry">
            <span class="dbCount">Count: ${entry.count}</span>
            <span class="dbRows">Rows: ${entry.rowCount}</span>
            <span>${detail}${stacks}</span>
          </div>
        `;
      } else {
        return html`<p>No entry found for key ${this.key}</p>`;
      }
    }
  }
}
