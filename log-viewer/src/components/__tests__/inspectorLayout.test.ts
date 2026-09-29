/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import { html } from 'lit';

import type { PaneSection } from '../PaneView.js';
import {
  hiddenIds,
  keepUnbuilt,
  layoutKey,
  mergeOrder,
  orderSections,
  scopedKey,
  scopedRecord,
  withoutScope,
} from '../inspectorLayout.js';

function sectionsOf(...ids: string[]): PaneSection[] {
  return ids.map((id) => ({ id, title: id, content: html`<div>${id}</div>` }));
}

function idsOf(sections: PaneSection[]): string[] {
  return sections.map((section) => section.id);
}

describe('layoutKey', () => {
  it('names the tab and the scope, so one id is two lists', () => {
    expect(layoutKey('timeline', 'summary')).toBe('timeline:summary');
    expect(layoutKey('timeline', 'detail')).not.toBe(layoutKey('timeline', 'summary'));
    expect(layoutKey('analysis', 'detail')).not.toBe(layoutKey('calltree', 'detail'));
  });
});

describe('scopedKey', () => {
  it('names one section inside its list', () => {
    expect(scopedKey(layoutKey('timeline', 'detail'), 'callstack')).toBe(
      'timeline:detail:callstack',
    );
  });
});

describe('scopedRecord', () => {
  const store = {
    'timeline:detail:callstack': true,
    'timeline:summary:calltree': true,
    'analysis:detail:callstack': true,
  };

  it('takes one list’s entries, by plain section id', () => {
    expect(scopedRecord(store, 'timeline:detail')).toEqual({ callstack: true });
    expect(scopedRecord(store, 'timeline:summary')).toEqual({ calltree: true });
  });

  it('is empty for a list with nothing remembered', () => {
    expect(scopedRecord(store, 'database:summary')).toEqual({});
  });

  it('is empty without a key, so a list still building matches nothing', () => {
    expect(scopedRecord(store, '')).toEqual({});
  });
});

describe('withoutScope', () => {
  it('drops one list’s entries and leaves every other list alone', () => {
    const store = {
      'timeline:detail:callstack': true,
      'timeline:summary:calltree': true,
      'analysis:detail:callstack': true,
    };

    expect(withoutScope(store, 'timeline:detail')).toEqual({
      'timeline:summary:calltree': true,
      'analysis:detail:callstack': true,
    });
  });
});

describe('orderSections', () => {
  const built = sectionsOf('vitals', 'variables', 'callstack', 'calltree');

  it('returns the builder order when the user has arranged nothing', () => {
    expect(orderSections(built)).toBe(built);
    expect(idsOf(orderSections(built, []))).toEqual(idsOf(built));
  });

  it('applies the order the user arranged', () => {
    const order = ['calltree', 'vitals', 'callstack', 'variables'];
    expect(idsOf(orderSections(built, order))).toEqual(order);
  });

  it('leaves the built sections alone', () => {
    orderSections(built, ['calltree', 'vitals']);
    expect(idsOf(built)).toEqual(['vitals', 'variables', 'callstack', 'calltree']);
  });

  it('keeps a section the order never named behind the one it follows', () => {
    // `variables` arrived after this list was last arranged, and follows
    // `vitals` in the builder's list.
    const order = ['calltree', 'vitals', 'callstack'];
    expect(idsOf(orderSections(built, order))).toEqual([
      'calltree',
      'vitals',
      'variables',
      'callstack',
    ]);
  });

  it('leads with an unnamed section the order names nothing before', () => {
    expect(idsOf(orderSections(built, ['calltree']))).toEqual([
      'vitals',
      'variables',
      'callstack',
      'calltree',
    ]);
  });

  it('places a section the arranged list did not have where the builder puts it', () => {
    // Reordered while a DML row was selected, so the order never named
    // `issues` — which the builder puts after `callstack` for a SOQL one.
    const soql = sectionsOf('vitals', 'variables', 'callstack', 'issues', 'calltree');
    const order = ['calltree', 'vitals', 'variables', 'callstack'];

    expect(idsOf(orderSections(soql, order))).toEqual([
      'calltree',
      'vitals',
      'variables',
      'callstack',
      'issues',
    ]);
  });

  it('ignores an id this list no longer has', () => {
    const order = ['issues', 'calltree', 'vitals', 'variables', 'callstack'];
    expect(idsOf(orderSections(built, order))).toEqual([
      'calltree',
      'vitals',
      'variables',
      'callstack',
    ]);
  });
});

describe('hiddenIds', () => {
  it('takes the ids this list hides', () => {
    const store = { 'timeline:detail:calltree': true, 'analysis:detail:findings': true };

    expect(hiddenIds(store, 'timeline:detail')).toEqual(new Set(['calltree']));
    expect(hiddenIds(store, 'timeline:summary')).toEqual(new Set());
  });

  it('ignores an entry left behind by bringing a section back', () => {
    expect(hiddenIds({ 'timeline:detail:calltree': false }, 'timeline:detail')).toEqual(new Set());
  });
});

describe('mergeOrder', () => {
  it('is the dragged order when the list hides nothing', () => {
    expect(mergeOrder(['vitals', 'callstack'], new Set(), ['callstack', 'vitals'])).toEqual([
      'callstack',
      'vitals',
    ]);
  });

  it('keeps a hidden section behind the one it follows', () => {
    // `variables` sits behind `vitals`, hidden; moving `calltree` up must not
    // strand it at the end of the list.
    const ids = ['vitals', 'variables', 'callstack', 'calltree'];

    expect(mergeOrder(ids, new Set(['variables']), ['calltree', 'vitals', 'callstack'])).toEqual([
      'calltree',
      'vitals',
      'variables',
      'callstack',
    ]);
  });

  it('leads with a hidden section that has nothing above it', () => {
    const ids = ['overview', 'findings', 'calltree'];

    expect(mergeOrder(ids, new Set(['overview']), ['calltree', 'findings'])).toEqual([
      'overview',
      'calltree',
      'findings',
    ]);
  });

  it('keeps several hidden sections behind the same one, in order', () => {
    const ids = ['vitals', 'variables', 'issues', 'calltree'];

    expect(mergeOrder(ids, new Set(['variables', 'issues']), ['calltree', 'vitals'])).toEqual([
      'calltree',
      'vitals',
      'variables',
      'issues',
    ]);
  });
});

describe('keepUnbuilt', () => {
  it('is the arranged order when the store knew nothing more', () => {
    expect(keepUnbuilt(['vitals', 'callstack'], ['callstack', 'vitals'])).toEqual([
      'callstack',
      'vitals',
    ]);
  });

  it('keeps an id this build never produced behind the one it followed', () => {
    // Arranged under a SOQL statement, reordered under a DML one, which builds
    // no `issues` section at all.
    const stored = ['vitals', 'variables', 'callstack', 'issues', 'calltree'];

    expect(keepUnbuilt(stored, ['calltree', 'vitals', 'variables', 'callstack'])).toEqual([
      'calltree',
      'vitals',
      'variables',
      'callstack',
      'issues',
    ]);
  });

  it('leads with an unbuilt id the store put above everything', () => {
    // They dragged SOQL issues to the top; a reorder under a DML row must not
    // cost them that.
    const stored = ['issues', 'vitals', 'callstack'];

    expect(keepUnbuilt(stored, ['callstack', 'vitals'])).toEqual(['issues', 'callstack', 'vitals']);
  });

  it('takes a section the store never named', () => {
    expect(keepUnbuilt(['vitals', 'callstack'], ['callstack', 'variables', 'vitals'])).toEqual([
      'callstack',
      'variables',
      'vitals',
    ]);
  });

  it('is the arranged order when nothing is stored yet', () => {
    expect(keepUnbuilt([], ['callstack', 'vitals'])).toEqual(['callstack', 'vitals']);
  });
});
