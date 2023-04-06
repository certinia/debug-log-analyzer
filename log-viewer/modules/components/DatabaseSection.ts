/*
 * Copyright (c) 2021 FinancialForce.com, inc. All rights reserved.
 */
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { Method } from '../parsers/TreeParser';

@customElement('database-section')
export class DatabaseSection extends LitElement {
  @property({ type: String })
  title = '';
  @property({ type: Object, attribute: false })
  dbLines: Method[] = [];

  static get styles() {
    return css`
      .dbSection {
        padding: 10px 5px 5px 5px;
      }
      .dbTitle {
        font-weight: bold;
        font-size: 1.2em;
      }
      .dbBlock {
        margin-left: 10px;
        font-weight: normal;
      }
    `;
  }

  render() {
    const totalCount = this.dbLines.length;
    let totalRows = 0;
    this.dbLines.forEach((value) => {
      totalRows += value.rowCount || 0;
    });

    return html`
      <div class="dbSection">
        <span class="dbTitle">${this.title} (Count: ${totalCount}, Rows: ${totalRows})</span>
      </div>
    `;
  }
}
