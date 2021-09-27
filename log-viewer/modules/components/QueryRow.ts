/*
 * Copyright (c) 2021 FinancialForce.com, inc. All rights reserved.
 */
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";

@customElement('query-row')
class QueryRow extends LitElement {
  @property({type: Number}) instances = 0;
  @property({type: Number}) rowCount = 0;
  @property({type: String}) query = '';

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
    return html`
      <div class="dbEntry">
        <span class="dbCount">Count: ${this.instances}</span>
        <span class="dbRows">Rows: ${this.rowCount}</span>
        <span class="dbName">${this.query}</span>
      </div>
    `;
  }
}