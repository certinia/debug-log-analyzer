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
    const data = cell.getData() as { originalData: LogEvent; treeLevel: number };
    const { originalData: node, treeLevel } = data;
    // @ts-expect-error this.table is added by tabulator when the formatter is called, but isn't in the types for some reason
    childIndent ??= this.table.options.dataTreeChildIndent ?? 9;
    const levelIndent = treeLevel * childIndent;

    const cellElem = cell.getElement();
    cellElem.style.paddingLeft = `${levelIndent + 4}px`;
    cellElem.style.textIndent = `-${levelIndent}px`;

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
