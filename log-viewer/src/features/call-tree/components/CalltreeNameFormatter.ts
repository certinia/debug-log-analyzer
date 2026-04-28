/*
 * Copyright (c) 2022 Certinia Inc. All rights reserved.
 */
import type { LogEvent, LogEventType } from 'apex-log-parser';
import type { CellComponent, EmptyCallback } from 'tabulator-tables';

export function createCalltreeNameFormatter(excludedTypes: Set<LogEventType>) {
  let childIndent: number;

  return function calltreeNameFormatter(
    cell: CellComponent,
    _formatterParams: object,
    _onRendered: EmptyCallback,
  ): string | HTMLElement {
    // @ts-expect-error this.table is added by tabulator when the formatter is called, but isn't in the types for some reason
    childIndent ??= this.table.options.dataTreeChildIndent ?? 9;
    const row = cell.getRow();
    // @ts-expect-error _row is private to tabulator but is the only way to get the tree level in a formatter
    const treeLevel: number = row._row.modules.dataTree?.index ?? 0;
    const levelIndent = treeLevel * childIndent;

    const cellElem = cell.getElement();
    cellElem.style.paddingLeft = `${levelIndent + 4}px`;
    cellElem.style.textIndent = `-${levelIndent}px`;

    const { originalData: node } = cell.getData() as { originalData: LogEvent };
    if (node.hasValidSymbols) {
      const link = document.createElement('a');
      link.setAttribute('href', '#!');
      link.textContent = node.text;
      return link;
    }

    let text = node.text;
    if (node.type && node.type !== text && !excludedTypes.has(node.type)) {
      text = node.type + ': ' + text;
    }

    return document.createTextNode(text) as unknown as HTMLElement;
  };
}
