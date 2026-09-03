/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import {
  clampRaw,
  isExpandable,
  parseVariableValue,
  previewOf,
  RAW_CLAMP_CHARS,
} from '../variableValue.js';

describe('parseVariableValue', () => {
  it('reads a number, the commonest value', () => {
    expect(parseVariableValue('42')).toEqual({ kind: 'literal', text: '42' });
    expect(parseVariableValue('-1.5')).toEqual({ kind: 'literal', text: '-1.5' });
  });

  it('reads a boolean and a null', () => {
    expect(parseVariableValue('true')).toEqual({ kind: 'literal', text: 'true' });
    expect(parseVariableValue('null')).toEqual({ kind: 'literal', text: 'null' });
  });

  it('reads a value the log left blank', () => {
    expect(parseVariableValue('')).toEqual({ kind: 'empty' });
    expect(parseVariableValue('   ')).toEqual({ kind: 'empty' });
  });

  // A bare address means the value would not serialise. Calling it an empty
  // object would claim the log knew it held nothing.
  it('reads a bare address as an address', () => {
    expect(parseVariableValue('0x3f2a1b')).toEqual({ kind: 'address', text: '0x3f2a1b' });
  });

  it('reads a one-level object', () => {
    const value = parseVariableValue('{"name":"Acme","count":2}');

    expect(value).toEqual({
      kind: 'container',
      brackets: '{}',
      truncated: false,
      fromString: false,
      entries: [
        { key: 'name', text: '"Acme"', address: null },
        { key: 'count', text: '2', address: null },
      ],
    });
  });

  it('reads a list', () => {
    const value = parseVariableValue('[1, 2, 3]');

    expect(value).toMatchObject({ brackets: '[]' });
    expect(value).toMatchObject({
      entries: [
        { key: null, text: '1' },
        { key: null, text: '2' },
        { key: null, text: '3' },
      ],
    });
  });

  it('reads an empty object as an empty object', () => {
    const value = parseVariableValue('{}');

    expect(value).toEqual({
      kind: 'container',
      brackets: '{}',
      entries: [],
      truncated: false,
      fromString: false,
    });
    expect(previewOf(value)).toBe('{}');
    expect(isExpandable(value)).toBe(false);
  });

  it('reads an empty list', () => {
    expect(previewOf(parseVariableValue('[]'))).toBe('[]');
  });

  // A Map serialises with repeats, so dropping them would hide entries the
  // transaction really held. JSON.parse loses them in silence.
  it('keeps duplicate keys, in the order the log wrote them', () => {
    const value = parseVariableValue('{"key":"a","key":"b","key":"c"}');

    expect(value).toMatchObject({
      entries: [
        { key: 'key', text: '"a"' },
        { key: 'key', text: '"b"' },
        { key: 'key', text: '"c"' },
      ],
    });
  });

  it('reads a string', () => {
    const value = parseVariableValue('"Acme Corp"');

    expect(value).toMatchObject({ kind: 'string', inner: 'Acme Corp', toStringLike: false });
  });

  it('marks a string the log cut short', () => {
    const value = parseVariableValue('"first20charsofthisva (10 more) ..."');

    expect(value).toMatchObject({ kind: 'string', truncated: true });
    // The marker is the log's own text and stays in it.
    expect(previewOf(value, 200)).toContain('(10 more) ...');
  });

  it('marks an Apex toString() that landed inside a string', () => {
    const value = parseVariableValue('"{Id=001, Name=Acme}"');

    expect(value).toMatchObject({ kind: 'string', toStringLike: true });
  });

  it('marks a collection the log cut short', () => {
    const value = parseVariableValue('{"a":1, "b":2, ...}');

    expect(value).toMatchObject({ truncated: true, entries: [{ key: 'a' }, { key: 'b' }] });
    expect(previewOf(value, 200)).toBe('{a: 1, b: 2, …}');
  });

  it('keeps a nested value verbatim rather than reading into it', () => {
    const value = parseVariableValue('{"child":{"aot":"0x1f"},"n":1}');

    // One level: the log holds no more, so a scan would find nothing deeper.
    expect(value).toMatchObject({
      entries: [
        { key: 'child', text: '{"aot":"0x1f"}' },
        { key: 'n', text: '1' },
      ],
    });
  });

  it('does not split on a comma inside a string', () => {
    const value = parseVariableValue('{"address":"1 High St, London","n":2}');

    expect(value).toMatchObject({
      entries: [
        { key: 'address', text: '"1 High St, London"' },
        { key: 'n', text: '2' },
      ],
    });
  });

  it('does not split on a comma inside a nested value', () => {
    expect(parseVariableValue('{"a":{"x":1,"y":2},"n":3}')).toMatchObject({
      entries: [
        { key: 'a', text: '{"x":1,"y":2}' },
        { key: 'n', text: '3' },
      ],
    });
  });

  // One escaped quote before the comma: a scanner that does not skip the escape
  // reads the string as closed and splits the entry in half.
  it('reads an escaped quote without losing the key', () => {
    expect(parseVariableValue('{"quote":"say \\"hi, there","n":1}')).toMatchObject({
      entries: [
        { key: 'quote', text: '"say \\"hi, there"' },
        { key: 'n', text: '1' },
      ],
    });
  });

  it('holds an unquoted key as text rather than guessing one', () => {
    expect(parseVariableValue('{a=1}')).toMatchObject({ entries: [{ key: null, text: 'a=1' }] });
  });

  // A logged value can be very long. Scanning that shape earns nothing, and the
  // raw text is the honest answer.
  it('hands back a huge value as text rather than scanning it', () => {
    const huge = `{${'"k":"' + 'x'.repeat(70_000) + '"'}}`;

    expect(parseVariableValue(huge).kind).toBe('literal');
  });
});

describe('isExpandable', () => {
  it('offers an expander only where a row cannot hold the value', () => {
    expect(isExpandable(parseVariableValue('42'))).toBe(false);
    expect(isExpandable(parseVariableValue('0x3f2a'))).toBe(false);
    expect(isExpandable(parseVariableValue('{}'))).toBe(false);
    expect(isExpandable(parseVariableValue('{"a":1}'))).toBe(true);
    expect(isExpandable(parseVariableValue(`"${'x'.repeat(200)}"`))).toBe(true);
    expect(isExpandable(parseVariableValue('"short"'))).toBe(false);
  });
});

describe('an entry that names an address', () => {
  // The log quotes a nested address, and the tree needs it to resolve the object.
  it('reads it off a quoted entry', () => {
    const value = parseVariableValue('{"m_tliFilter":"0x6c98700c","n":1}');

    expect(value).toMatchObject({
      entries: [
        { key: 'm_tliFilter', address: '0x6c98700c' },
        { key: 'n', address: null },
      ],
    });
  });

  it('reads it off a bare list entry', () => {
    expect(parseVariableValue('[0x6c98700c]')).toMatchObject({
      entries: [{ key: null, address: '0x6c98700c' }],
    });
  });
});

describe('a string holding JSON', () => {
  it('reads it as the object it holds', () => {
    const value = parseVariableValue('"{\\"a\\":1}"');

    expect(value).toMatchObject({
      kind: 'container',
      brackets: '{}',
      fromString: true,
      entries: [{ key: 'a', text: '1' }],
    });
  });

  it('reads an unescaped one too', () => {
    expect(parseVariableValue('"{"a":1}"')).toMatchObject({ kind: 'container', fromString: true });
  });

  it('reads a list it holds', () => {
    expect(parseVariableValue('"[1,2]"')).toMatchObject({ brackets: '[]', fromString: true });
  });

  // An Apex toString() is text. Reading structure out of one would claim the log
  // recorded something it did not.
  it('leaves an Apex toString() as text', () => {
    expect(parseVariableValue('"{accountid=AccountId, name=Name}"')).toMatchObject({
      kind: 'string',
      toStringLike: true,
    });
  });

  it('leaves a braced string with no key as text', () => {
    expect(parseVariableValue('"{not json}"')).toMatchObject({ kind: 'string' });
  });

  it('leaves an ordinary string alone', () => {
    expect(parseVariableValue('"Acme"')).toMatchObject({ kind: 'string', inner: 'Acme' });
  });
});

describe('previewOf', () => {
  it('clamps a long value to one row', () => {
    const preview = previewOf(parseVariableValue(`"${'x'.repeat(500)}"`));

    expect(preview.length).toBeLessThanOrEqual(82);
    expect(preview.endsWith('…')).toBe(true);
  });

  it('shows nothing for a value the log left blank', () => {
    expect(previewOf(parseVariableValue(''))).toBe('');
  });
});

describe('clampRaw', () => {
  it('cuts a value too big to lay out, and says so', () => {
    const clamped = clampRaw('x'.repeat(RAW_CLAMP_CHARS + 1));

    expect(clamped.clamped).toBe(true);
    expect(clamped.text).toHaveLength(RAW_CLAMP_CHARS);
  });

  it('leaves a value that fits alone', () => {
    expect(clampRaw('{"a":1}')).toEqual({ text: '{"a":1}', clamped: false });
  });
});
