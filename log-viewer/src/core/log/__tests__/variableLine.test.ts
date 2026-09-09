/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';

import {
  bareAddress,
  bareAddressOf,
  nestedAddressesOf,
  classOf,
  isStaticName,
  parseVariableScope,
  parseVariableWrite,
  reportedAddressOf,
} from '../variableLine.js';

describe('parseVariableWrite', () => {
  it('reads the name and the value', () => {
    const write = parseVariableWrite('11:22:33.1 (1)|VARIABLE_ASSIGNMENT|[7]|total|42');

    expect(write).toEqual({ name: 'total', value: '42', address: null });
  });

  it('takes the address off the end', () => {
    const write = parseVariableWrite(
      '11:22:33.1 (1)|VARIABLE_ASSIGNMENT|[7]|records|{"size":2}|0x3f2a1b',
    );

    expect(write).toEqual({ name: 'records', value: '{"size":2}', address: '0x3f2a1b' });
  });

  // The log can leave the address field present and empty. Taken as part of the
  // value it reads as `null|`.
  it('drops the empty address field rather than reading it as the value', () => {
    const write = parseVariableWrite('08:02:57.611 (1)|VARIABLE_ASSIGNMENT|[57]|a|null|');

    expect(write).toEqual({ name: 'a', value: 'null', address: null });
  });

  it('drops it from an object value too', () => {
    const write = parseVariableWrite('t|VARIABLE_ASSIGNMENT|[7]|held|{"a":1}|');

    expect(write?.value).toBe('{"a":1}');
  });

  it('still reads a bare address that has the empty field after it', () => {
    expect(bareAddressOf('t|VARIABLE_ASSIGNMENT|[7]|alias|0xd854c6b|')).toBe('0xd854c6b');
  });

  // No real value holds a pipe, but position parsing keeps one if it ever does.
  it('keeps a value that holds a pipe', () => {
    const write = parseVariableWrite('11:22:33.1 (1)|VARIABLE_ASSIGNMENT|[7]|clause|Name|Id');

    expect(write?.value).toBe('Name|Id');
    expect(write?.address).toBeNull();
  });

  it('keeps a piped value and still takes its address', () => {
    const write = parseVariableWrite(
      '11:22:33.1 (1)|VARIABLE_ASSIGNMENT|[7]|clause|Name|Id|0xabc123',
    );

    expect(write?.value).toBe('Name|Id');
    expect(write?.address).toBe('0xabc123');
  });

  it('reads a value that is itself hex but not an address', () => {
    const write = parseVariableWrite('11:22:33.1 (1)|VARIABLE_ASSIGNMENT|[7]|code|0xdeadbeef');

    // No pipe after the name's, so the hex is the value rather than an address.
    expect(write).toEqual({ name: 'code', value: '0xdeadbeef', address: null });
  });

  it('holds a this-qualified field name whole', () => {
    expect(parseVariableWrite('t|VARIABLE_ASSIGNMENT|[7]|this.count|3')?.name).toBe('this.count');
  });

  it('reports no write where the line carries no value', () => {
    expect(parseVariableWrite('11:22:33.1 (1)|VARIABLE_ASSIGNMENT|[7]|total')).toBeNull();
  });

  it('reports no write where the line carries no name', () => {
    expect(parseVariableWrite('11:22:33.1 (1)|VARIABLE_ASSIGNMENT|[7]||42')).toBeNull();
    expect(parseVariableWrite('11:22:33.1 (1)|VARIABLE_ASSIGNMENT')).toBeNull();
  });
});

describe('parseVariableScope', () => {
  it('reads the declared type and the static flag', () => {
    const scope = parseVariableScope(
      '11:22:33.1 (1)|VARIABLE_SCOPE_BEGIN|[7]|Account.cache|Map<Id,Account>|true|true',
    );

    expect(scope).toEqual({
      name: 'Account.cache',
      declaredType: 'Map<Id,Account>',
      isStatic: true,
    });
  });

  it('reads a local as not static', () => {
    const scope = parseVariableScope(
      '11:22:33.1 (1)|VARIABLE_SCOPE_BEGIN|[7]|total|Integer|false|false',
    );

    expect(scope).toEqual({ name: 'total', declaredType: 'Integer', isStatic: false });
  });

  // The type holds commas, so the flags are read from the right, not by count.
  it('keeps a generic type whole', () => {
    const scope = parseVariableScope(
      't|VARIABLE_SCOPE_BEGIN|[7]|byKey|Map<String,List<Account>>|false|true',
    );

    expect(scope?.declaredType).toBe('Map<String,List<Account>>');
    expect(scope?.isStatic).toBe(true);
  });

  it('reports no scope for a line too short to carry one', () => {
    expect(parseVariableScope('t|VARIABLE_SCOPE_BEGIN|[7]|total|Integer|false')).toBeNull();
  });
});

describe('static names', () => {
  it('names the class a static belongs to', () => {
    expect(classOf('Account.cache')).toBe('Account');
    expect(classOf('ns.Account.cache')).toBe('ns.Account');
    expect(classOf('total')).toBeNull();
  });

  it('tells a static from a field and a local', () => {
    expect(isStaticName('Account.cache')).toBe(true);
    expect(isStaticName('this.count')).toBe(false);
    expect(isStaticName('total')).toBe(false);
  });
});

describe('addresses', () => {
  it('reads a value that is only an address', () => {
    expect(bareAddress('0xd854c6b')).toBe('0xd854c6b');
    expect(bareAddress(' 0xd854c6b ')).toBe('0xd854c6b');
    expect(bareAddress('{"a":1}')).toBeNull();
    expect(bareAddress('42')).toBeNull();
  });

  it('reads one straight off a line', () => {
    expect(bareAddressOf('t|VARIABLE_ASSIGNMENT|[7]|alias|0xd854c6b')).toBe('0xd854c6b');
    expect(bareAddressOf('t|VARIABLE_ASSIGNMENT|[7]|held|{"a":1}|0xd854c6b')).toBeNull();
  });

  // The walk reads every line of the log, and a value can be very long.
  it('gives up on a long value before it slices it', () => {
    const long = `t|VARIABLE_ASSIGNMENT|[7]|big|${'x'.repeat(70_000)}`;

    expect(bareAddressOf(long)).toBeNull();
  });

  it('reads the address a line reported for its value', () => {
    expect(reportedAddressOf('t|VARIABLE_ASSIGNMENT|[7]|held|{"a":1}|0xd854c6b')).toBe('0xd854c6b');
    expect(reportedAddressOf('t|VARIABLE_ASSIGNMENT|[7]|held|{"a":1}')).toBeNull();
    // A piped value whose tail is not an address.
    expect(reportedAddressOf('t|VARIABLE_ASSIGNMENT|[7]|clause|Name|Id')).toBeNull();
  });
});

describe('nestedAddressesOf', () => {
  it('finds an address a value names inside itself', () => {
    const line = 't|VARIABLE_ASSIGNMENT|[7]|view|{"m_tliFilter":"0x6c98700c","n":1}';

    expect(nestedAddressesOf(line)).toEqual(['0x6c98700c']);
  });

  // Every assignment reports one, so taking them all would hold the whole log.
  it('leaves out the address the line reports for its own value', () => {
    const line = 't|VARIABLE_ASSIGNMENT|[7]|view|{"n":1}|0x7d1781a3';

    expect(nestedAddressesOf(line)).toEqual([]);
  });

  it('finds both when a value names one and the line reports another', () => {
    const line = 't|VARIABLE_ASSIGNMENT|[7]|view|{"ref":"0x6c98700c"}|0x7d1781a3';

    expect(nestedAddressesOf(line)).toEqual(['0x6c98700c']);
  });

  it('finds nothing in a value that names none', () => {
    expect(nestedAddressesOf('t|VARIABLE_ASSIGNMENT|[7]|n|42')).toEqual([]);
  });
});
