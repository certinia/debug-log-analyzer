/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import type { RowComponent } from 'tabulator-tables';

import {
  eventBus,
  type DetailSelection,
  type DetailSource,
} from '../../../core/events/EventBus.js';
import { SelectionEchoGuard } from '../../../core/events/SelectionEchoGuard.js';
import { emitGridSelection } from '../components/gridSelection.js';

interface StatementRow {
  eventIndex?: number;
  soql?: string;
}

/** Only `getData` is read, so the rest of the row component is not built. */
function row(data: StatementRow): RowComponent {
  return { getData: () => data } as unknown as RowComponent;
}

const soqlEventIndex = (data: StatementRow) => (data.soql ? data.eventIndex : undefined);

describe('emitGridSelection', () => {
  let seen: Array<{ source: DetailSource; selection: DetailSelection | null }>;
  let off: () => void;

  beforeEach(() => {
    seen = [];
    off = eventBus.on('detail:select', (d) => seen.push(d));
  });

  afterEach(() => off());

  it('reports the picked row', () => {
    emitGridSelection(
      new SelectionEchoGuard(),
      'soql',
      [row({ eventIndex: 7, soql: 'SELECT' })],
      soqlEventIndex,
    );

    expect(seen).toEqual([
      { source: 'database', selection: { kind: 'event', eventIndex: 7, type: 'soql' } },
    ]);
  });

  it('clears the inspector when the grid is cleared', () => {
    emitGridSelection(new SelectionEchoGuard(), 'soql', [], soqlEventIndex);

    expect(seen).toEqual([{ source: 'database', selection: null }]);
  });

  it('says nothing while a select on the inspector behalf is in flight', () => {
    const guard = new SelectionEchoGuard();

    guard.run(() => emitGridSelection(guard, 'soql', [], soqlEventIndex));

    expect(seen).toEqual([]);
  });

  it('leaves the inspector alone for a row that holds no statement', () => {
    emitGridSelection(new SelectionEchoGuard(), 'soql', [row({ eventIndex: 7 })], soqlEventIndex);

    expect(seen).toEqual([]);
  });
});
