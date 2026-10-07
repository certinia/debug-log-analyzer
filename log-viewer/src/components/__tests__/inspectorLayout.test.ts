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

describe('layoutKey and scopedKey', () => {
  it('name the tab and the scope, so one id is two lists, and one section inside it', () => {
    expect(layoutKey('timeline', 'summary')).toBe('timeline:summary');
    expect(layoutKey('timeline', 'detail')).not.toBe(layoutKey('timeline', 'summary'));
    expect(layoutKey('analysis', 'detail')).not.toBe(layoutKey('calltree', 'detail'));
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
  const BUILT = ['vitals', 'variables', 'callstack', 'calltree'];
  const built = sectionsOf(...BUILT);

  it('returns the builder order when the user has arranged nothing', () => {
    expect(orderSections(built)).toBe(built);
    expect(idsOf(orderSections(built, []))).toEqual(idsOf(built));
  });

  it('leaves the built sections alone', () => {
    orderSections(built, ['calltree', 'vitals']);
    expect(idsOf(built)).toEqual(BUILT);
  });

  it.each([
    [
      'applies the order the user arranged',
      BUILT,
      ['calltree', 'vitals', 'callstack', 'variables'],
      ['calltree', 'vitals', 'callstack', 'variables'],
    ],
    // `variables` arrived after this list was last arranged, and follows
    // `vitals` in the builder's list.
    [
      'keeps a section the order never named behind the one it follows',
      BUILT,
      ['calltree', 'vitals', 'callstack'],
      ['calltree', 'vitals', 'variables', 'callstack'],
    ],
    [
      'leads with an unnamed section the order names nothing before',
      BUILT,
      ['calltree'],
      ['vitals', 'variables', 'callstack', 'calltree'],
    ],
    // Reordered while a DML row was selected, so the order never named
    // `issues` — which the builder puts after `callstack` for a SOQL one.
    [
      'places a section the arranged list did not have where the builder puts it',
      ['vitals', 'variables', 'callstack', 'issues', 'calltree'],
      ['calltree', 'vitals', 'variables', 'callstack'],
      ['calltree', 'vitals', 'variables', 'callstack', 'issues'],
    ],
    [
      'ignores an id this list no longer has',
      BUILT,
      ['issues', 'calltree', 'vitals', 'variables', 'callstack'],
      ['calltree', 'vitals', 'variables', 'callstack'],
    ],
  ])('%s', (_name, builtIds, order, expected) => {
    expect(idsOf(orderSections(sectionsOf(...builtIds), order))).toEqual(expected);
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
  it.each([
    [
      'is the dragged order when the list hides nothing',
      ['vitals', 'callstack'],
      [],
      ['callstack', 'vitals'],
      ['callstack', 'vitals'],
    ],
    // `variables` sits behind `vitals`, hidden; moving `calltree` up must not
    // strand it at the end of the list.
    [
      'keeps a hidden section behind the one it follows',
      ['vitals', 'variables', 'callstack', 'calltree'],
      ['variables'],
      ['calltree', 'vitals', 'callstack'],
      ['calltree', 'vitals', 'variables', 'callstack'],
    ],
    [
      'leads with a hidden section that has nothing above it',
      ['overview', 'findings', 'calltree'],
      ['overview'],
      ['calltree', 'findings'],
      ['overview', 'calltree', 'findings'],
    ],
    [
      'keeps several hidden sections behind the same one, in order',
      ['vitals', 'variables', 'issues', 'calltree'],
      ['variables', 'issues'],
      ['calltree', 'vitals'],
      ['calltree', 'vitals', 'variables', 'issues'],
    ],
  ])('%s', (_name, ids, hidden, dragged, expected) => {
    expect(mergeOrder(ids, new Set(hidden), dragged)).toEqual(expected);
  });
});

describe('keepUnbuilt', () => {
  it.each([
    [
      'is the arranged order when the store knew nothing more',
      ['vitals', 'callstack'],
      ['callstack', 'vitals'],
      ['callstack', 'vitals'],
    ],
    // Arranged under a SOQL statement, reordered under a DML one, which builds
    // no `issues` section at all.
    [
      'keeps an id this build never produced behind the one it followed',
      ['vitals', 'variables', 'callstack', 'issues', 'calltree'],
      ['calltree', 'vitals', 'variables', 'callstack'],
      ['calltree', 'vitals', 'variables', 'callstack', 'issues'],
    ],
    // They dragged SOQL issues to the top; a reorder under a DML row must not
    // cost them that.
    [
      'leads with an unbuilt id the store put above everything',
      ['issues', 'vitals', 'callstack'],
      ['callstack', 'vitals'],
      ['issues', 'callstack', 'vitals'],
    ],
    [
      'takes a section the store never named',
      ['vitals', 'callstack'],
      ['callstack', 'variables', 'vitals'],
      ['callstack', 'variables', 'vitals'],
    ],
    [
      'is the arranged order when nothing is stored yet',
      [],
      ['callstack', 'vitals'],
      ['callstack', 'vitals'],
    ],
  ])('%s', (_name, stored, arranged, expected) => {
    expect(keepUnbuilt(stored, arranged)).toEqual(expected);
  });
});
