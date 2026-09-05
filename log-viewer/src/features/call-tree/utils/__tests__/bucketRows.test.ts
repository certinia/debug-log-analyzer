/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { LogEvent } from 'apex-log-parser';
import type { RowComponent } from 'tabulator-tables';

import { findBucketRow } from '../bucketRows.js';

function ev(text: string, parent: LogEvent | null): LogEvent {
  return { type: 'METHOD_ENTRY', namespace: '', text, parent } as unknown as LogEvent;
}

const key = (text: string) => `METHOD_ENTRY||${text}`;

interface FakeRow {
  key: string;
  children: FakeRow[];
  expanded: boolean;
  /** Set once the row is asked to expand, so a test can prove it was. */
  expandedByWalk?: boolean;
  /** Reads of the children that come back empty before the rest do, as they do
   *  while the renderer is still building them. */
  emptyReads?: number;
}

function row(text: string, ...children: FakeRow[]): FakeRow {
  return { key: key(text), children, expanded: false };
}

/** Wraps the fakes as tabulator hands rows over: children exist only once open. */
function asRows(rows: FakeRow[]): RowComponent[] {
  return rows.map(
    (data) =>
      ({
        getData: () => ({ key: data.key, _children: data.children }),
        getTreeChildren: () => {
          if (data.emptyReads) {
            data.emptyReads -= 1;
            return [];
          }
          return data.expanded ? asRows(data.children) : [];
        },
        isTreeExpanded: () => data.expanded,
        treeExpand: () => {
          data.expanded = true;
          data.expandedByWalk = true;
        },
      }) as unknown as RowComponent,
  );
}

const settled = () => Promise.resolve();

describe('findBucketRow', () => {
  describe('a bottom-up view', () => {
    it('heads the frame with a top-level row, so its own key finds it', async () => {
      const rows = [row('other'), row('target')];

      const found = await findBucketRow(asRows(rows), ev('target', null), 'callers', settled);

      expect(found && (found.getData() as { key: string }).key).toBe(key('target'));
    });

    it('finds nothing where no row heads the frame', async () => {
      const found = await findBucketRow(
        asRows([row('other')]),
        ev('gone', null),
        'callers',
        settled,
      );

      expect(found).toBeNull();
    });
  });

  describe('a top-down view', () => {
    // exec -> a -> target, and a second exec branch holding the same method.
    const root = ev('LOG_ROOT', null);
    const exec = ev('exec', root);
    const outer = ev('a', exec);
    const target = ev('target', outer);

    it('descends the call path and expands what it walks through', async () => {
      const deep = row('target');
      const mid = row('a', deep);
      const rows = [row('other', row('target')), row('exec', mid)];

      const found = await findBucketRow(asRows(rows), target, 'callees', settled);

      expect(found && (found.getData() as { key: string }).key).toBe(key('target'));
      // The row under `other` shares the key, so only the path can tell them apart.
      expect(mid.expandedByWalk).toBe(true);
      expect(rows[0]!.expandedByWalk).toBeUndefined();
    });

    it('lands on the deepest row it resolved when a level is filtered out', async () => {
      // `a` is missing, so the walk stops at `exec` rather than giving up.
      const rows = [row('exec')];

      const found = await findBucketRow(asRows(rows), target, 'callees', settled);

      expect(found && (found.getData() as { key: string }).key).toBe(key('exec'));
    });

    it('waits again where an open row has not built its children yet', async () => {
      // Open already, so nothing expands it: without a second read the descent
      // would land on this row and the pick would need a second click.
      const mid = row('a', row('target'));
      mid.expanded = true;
      mid.emptyReads = 1;

      const found = await findBucketRow(asRows([row('exec', mid)]), target, 'callees', settled);

      expect(found && (found.getData() as { key: string }).key).toBe(key('target'));
    });

    it('finds nothing where the outermost frame has no row', async () => {
      const found = await findBucketRow(asRows([row('elsewhere')]), target, 'callees', settled);

      expect(found).toBeNull();
    });
  });
});
