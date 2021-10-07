/*
 * Copyright (c) 2021 FinancialForce.com, inc. All rights reserved.
 */
import { LitElement, html, css } from "lit";
import { customElement, property } from "lit/decorators.js";
import { DatabaseAccess, DatabaseEntryMap } from "../Database";

@customElement("database-section")
class DatabaseSection extends LitElement {
  @property({ type: String }) type = "";

  static get styles() {
    return css`
      .dbSection {
        padding: 10px;
      }
      .dbTitle {
        font-weight: bold;
        font-size: 10pt;
      }
      .dbBlock {
        margin-left: 10px;
        font-weight: normal;
      }
    `;
  }

  render() {
    const instancce = DatabaseAccess.instance();
    let map: DatabaseEntryMap | null = null;
    let title = "";
    if (this.type === "soql" && instancce) {
      map = instancce.soqlMap;
      title = "SOQL Statements";
    }
    if (this.type === "dml" && instancce) {
      map = instancce.dmlMap;
      title = "DML Statements";
    }
    if (map) {
      const keyList = this.getKeyList(map);
      let totalCount = 0;
      let totalRows = 0;
      map.forEach((value) => {
        totalCount += value.count;
        totalRows += value.rowCount;
      });
      const rows = keyList.map((key) => {return html`<database-row key=${key} />`;});

      return html`
        <div class="dbSection">
          <div class="dbTitle">
            ${title} (Count: ${totalCount}, Rows: ${totalRows})
            <div class="dbBlock">
                ${rows}
            </div>
          </div>
        </div>
      `;
    } else {
      return html`<p>No map found for type ${this.type}</p>`;
    }
  }

  /**
   * entryMap: key => count
   * sort by descending count or rowCount then ascending key
   */
  private getKeyList(entryMap: DatabaseEntryMap): string[] {
    const keyList = Array.from(entryMap.keys());
    keyList.sort((k1, k2) => {
      let e1 = entryMap.get(k1);
      let e2 = entryMap.get(k2);

      if (e1 && e2) {
        const countDiff = e2.count - e1.count;
        if (countDiff !== 0) {
          return countDiff;
        }
        const rowDiff = e2.rowCount - e1.rowCount;
        if (rowDiff !== 0) {
          return rowDiff;
        }
      }
      return k1.localeCompare(k2);
    });
    return keyList;
  }
}
