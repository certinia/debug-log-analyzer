/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import {
  NOT_RECORDED,
  type AddressState,
  type FrameVariables,
  type VariableRow,
} from '../../core/log/frameVariables.js';
import { parentOf, toTreeRows } from '../variableTree.js';

function row(name: string, value: string, over: Partial<VariableRow> = {}): VariableRow {
  return {
    name,
    value,
    declaredType: null,
    address: null,
    assigned: true,
    objectAddress: null,
    ...over,
  };
}

const frame: FrameVariables = {
  frameLabel: 'ns.Outer.run()',
  cut: 100,
  thisType: 'ns.Outer',
  thisRow: null,
  locals: [row('total', '42'), row('held', '{"a":1,"b":2}')],
  fields: [row('name', '"Acme"')],
  statics: [{ className: 'ns.Cache', rows: [row('hits', '3')] }],
  truncated: false,
};

/** Opens nothing, so every group reads at its default. */
const closed = (_id: string, byDefault: boolean): boolean => byDefault;
const openAll = (): boolean => true;

describe('toTreeRows', () => {
  it('opens Local and leaves the other groups closed', () => {
    const rows = toTreeRows(frame, closed);

    expect(rows.filter((r) => r.kind === 'group').map((r) => [r.id, r.open])).toEqual([
      ['local', true],
      ['this', false],
      ['static', false],
    ]);
    // Local is open, so its variables are rows; the others contribute none.
    expect(rows.filter((r) => r.kind === 'variable').map((r) => r.id)).toEqual([
      'local/total',
      'local/held',
    ]);
  });

  it('costs one row for a closed group', () => {
    const rows = toTreeRows({ ...frame, locals: [] }, () => false);

    expect(rows).toHaveLength(3);
  });

  it('nests statics under their class', () => {
    const rows = toTreeRows(frame, openAll);

    const ids = rows.map((r) => r.id);
    expect(ids).toContain('static/ns.Cache');
    expect(ids).toContain('static/ns.Cache/hits');
    expect(rows.find((r) => r.id === 'static/ns.Cache')?.depth).toBe(1);
    expect(rows.find((r) => r.id === 'static/ns.Cache/hits')?.depth).toBe(2);
  });

  it('gives an opened value one row per property', () => {
    const rows = toTreeRows(frame, openAll);

    expect(rows.filter((r) => r.kind === 'entry').map((r) => r.id)).toEqual([
      'local/held/0',
      'local/held/1',
    ]);
  });

  // A chevron that opened on nothing would teach a depth the log lacks.
  it('marks only a value that has something to open', () => {
    const rows = toTreeRows(frame, closed);

    expect(rows.find((r) => r.id === 'local/total')?.expandable).toBe(false);
    expect(rows.find((r) => r.id === 'local/held')?.expandable).toBe(true);
  });

  it('reads an address as the object it names', () => {
    const rows = toTreeRows(
      { ...frame, locals: [row('alias', '0xabc', { address: '0xabc' })] },
      closed,
      (address) => (address === '0xabc' ? { text: '{"n":1}', laterAt: null } : NOT_RECORDED),
    );

    const alias = rows.find((r) => r.id === 'local/alias');
    expect(alias?.kind === 'variable' && alias.raw).toBe('{"n":1}');
    // Resolved to a container, so it opens.
    expect(alias?.expandable).toBe(true);
  });

  it('says a frame assigned nothing rather than showing an empty group', () => {
    const rows = toTreeRows({ ...frame, locals: [] }, closed);

    expect(rows.find((r) => r.id === 'local/none')?.kind).toBe('note');
  });
});

describe('parentOf', () => {
  it('names the row that holds a row', () => {
    const rows = toTreeRows(frame, openAll);
    const at = rows.findIndex((r) => r.id === 'static/ns.Cache/hits');

    const owner = parentOf(rows, at);

    expect(rows[owner]?.id).toBe('static/ns.Cache');
    expect(rows[parentOf(rows, owner)]?.id).toBe('static');
  });

  it('reports none above a group', () => {
    const rows = toTreeRows(frame, closed);

    expect(parentOf(rows, 0)).toBe(-1);
  });
});

// `this` is the object the frame runs on, not one of its locals.
describe('the this group', () => {
  const self = row('this', '{}', { objectAddress: '0xf1e2d3', declaredType: 'ns.Writer' });

  it('heads its own group rather than sitting among the locals', () => {
    const rows = toTreeRows({ ...frame, thisRow: self }, openAll);

    const group = rows.find((r) => r.id === 'this');
    expect(group?.kind === 'group' && group.self?.raw).toBe('{}');
    expect(rows.some((r) => r.id === 'local/this')).toBe(false);
  });

  // A stateless class has nothing inside, so a chevron would promise a depth
  // the object does not have.
  it('does not open where the object has no fields', () => {
    const rows = toTreeRows({ ...frame, thisRow: self, fields: [] }, openAll);

    expect(rows.find((r) => r.id === 'this')?.expandable).toBe(false);
  });

  it('opens on the fields where the object has them', () => {
    const rows = toTreeRows({ ...frame, thisRow: self, fields: [row('count', '3')] }, openAll);

    expect(rows.find((r) => r.id === 'this')?.expandable).toBe(true);
    expect(rows.some((r) => r.id === 'this/count')).toBe(true);
  });

  it('shows the group without a value where the log wrote only fields', () => {
    const rows = toTreeRows({ ...frame, fields: [row('count', '3')] }, openAll);

    const group = rows.find((r) => r.id === 'this');
    expect(group?.kind === 'group' && group.self).toBeNull();
    expect(group?.expandable).toBe(true);
  });
});

describe('toTreeRows references', () => {
  const held = row('view', '{"m_tliFilter":"0x6c98700c","n":1}');
  const resolve = (address: string): AddressState =>
    address === '0x6c98700c' ? { text: '{"RowLimit":3000}', laterAt: null } : NOT_RECORDED;

  it('reads a field holding a reference as the object it names', () => {
    const rows = toTreeRows({ ...frame, locals: [held] }, openAll, resolve);

    const entry = rows.find((r) => r.id === 'local/view/0');
    expect(entry?.kind === 'entry' && entry.raw).toBe('{"RowLimit":3000}');
    expect(entry?.kind === 'entry' && entry.address).toBe('0x6c98700c');
    expect(entry?.kind === 'entry' && entry.resolved).toBe(true);
    // Resolved to an object, so the property opens on its own properties.
    expect(entry?.expandable).toBe(true);
    expect(rows.some((r) => r.id === 'local/view/0/0')).toBe(true);
  });

  it('leaves an address the log never wrote down as the address', () => {
    const rows = toTreeRows({ ...frame, locals: [held] }, openAll, () => NOT_RECORDED);

    const entry = rows.find((r) => r.id === 'local/view/0');
    expect(entry?.kind === 'entry' && entry.raw).toBe('"0x6c98700c"');
    expect(entry?.kind === 'entry' && entry.resolved).toBe(false);
    // Still names the address, so the row can say the log had no value for it.
    expect(entry?.kind === 'entry' && entry.address).toBe('0x6c98700c');
    expect(entry?.expandable).toBe(false);
  });

  // The address is only the identity the runtime printed. The contents are a
  // separate event, which may land after the frame the reader picked.
  it('tells an address the log never wrote down from one it wrote later', () => {
    const later = toTreeRows({ ...frame, locals: [held] }, openAll, () => ({
      text: null,
      laterAt: 91,
    }));

    const entry = later.find((r) => r.id === 'local/view/0');
    expect(entry?.kind === 'entry' && entry.resolved).toBe(false);
    // The eventIndex, so the row can name the frame that records it.
    expect(entry?.kind === 'entry' && entry.laterAt).toBe(91);
  });

  // A resolved object may name the address it was reached through.
  it('stops a reference that points back at itself', () => {
    const rows = toTreeRows(
      {
        ...frame,
        locals: [row('loop', '0xaaa', { address: '0xaaa' })],
      },
      openAll,
      (address) =>
        address === '0xaaa' ? { text: '{"self":"0xaaa"}', laterAt: null } : NOT_RECORDED,
    );

    const inner = rows.find((r) => r.id === 'local/loop/0');
    // Read as the object, so the row never claims the log recorded nothing.
    expect(inner?.kind === 'entry' && inner.resolved).toBe(true);
    // But it does not open again, which is what would loop.
    expect(inner?.expandable).toBe(false);
  });

  it('opens a property that is an object in its own right', () => {
    const rows = toTreeRows(
      { ...frame, locals: [row('outer', '{"inner":{"a":1,"b":2}}')] },
      openAll,
    );

    expect(rows.map((r) => r.id)).toContain('local/outer/0/0');
    expect(rows.find((r) => r.id === 'local/outer/0')?.expandable).toBe(true);
  });
});

describe('toTreeRows group labels', () => {
  // Local's label says whose scope answered, which a SOQL selection needs. The
  // others carried nothing the group name and count did not already say.
  it('names the frame on Local and nothing on the others', () => {
    const rows = toTreeRows(frame, openAll).filter((r) => r.kind === 'group');

    expect(rows.map((r) => [r.id, r.kind === 'group' ? r.of : null])).toEqual([
      ['local', 'ns.Outer.run()'],
      ['this', null],
      ['static', null],
    ]);
  });
});
