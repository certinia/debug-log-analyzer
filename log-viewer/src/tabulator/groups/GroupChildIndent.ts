import { Module } from 'tabulator-tables';

const GROUPED_CLASS = 'lana-grouped';

/**
 * Toggles {@link GROUPED_CLASS} on the table as grouping changes and publishes
 * `dataTreeChildIndent` as `--lana-indent-unit`, so group member indenting is
 * pure CSS — regrouping restyles rendered rows without a row rebuild.
 */
export class GroupChildIndent extends Module {
  static moduleName = 'groupChildIndent';

  initialize() {
    const indentUnit = this.table.options.dataTreeChildIndent ?? 9;
    this.table.element.style.setProperty('--lana-indent-unit', `${indentUnit}px`);

    // `dataGrouped` only fires while grouped; `group-changed` covers setGroupBy, incl. clearing.
    this.table.on('dataGrouped', this._updateClass.bind(this));
    this.subscribe('group-changed', this._updateClass.bind(this));
  }

  _updateClass() {
    const groupBy = this.table.options.groupBy;
    const grouped = Array.isArray(groupBy) ? groupBy.filter(Boolean).length > 0 : Boolean(groupBy);
    this.table.element.classList.toggle(GROUPED_CLASS, grouped);
  }
}
