/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import { type ApexLog, parse } from 'apex-log-parser';

import {
  apexCodeLevel,
  frameVariablesFor,
  recordsVariables,
  variableIndexFor,
} from '../frameVariables.js';
import { logStoreFor, type LogStore } from '../LogStore.js';

const SETTINGS = '64.0 APEX_CODE,FINEST;APEX_PROFILING,NONE;DB,NONE\n';

/** Wraps `body` in the header and footer the parser needs to build a tree. */
function logOf(body: string, settings = SETTINGS): string {
  return (
    settings +
    '09:18:22.6 (100)|EXECUTION_STARTED\n' +
    '09:18:22.6 (200)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|apex://pkg.Entry\n' +
    body +
    '09:18:22.6 (900000)|CODE_UNIT_FINISHED|apex://pkg.Entry\n' +
    '09:18:22.6 (901000)|EXECUTION_FINISHED\n'
  );
}

function storeOf(body: string, settings = SETTINGS): { log: ApexLog; store: LogStore } {
  const log = parse(logOf(body, settings));
  return { log, store: logStoreFor(log) };
}

/** The eventIndex of the frame or event whose log text is `text`. */
function indexOf(log: ApexLog, text: string): number {
  const found = log.eventsById.find((event) => event.text === text);
  if (!found) {
    throw new Error(`no event with text ${text}`);
  }
  return found.eventIndex;
}

const OUTER =
  '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
  '09:18:22.6 (1100)|VARIABLE_SCOPE_BEGIN|[2]|total|Integer|true|false\n' +
  '09:18:22.6 (1200)|VARIABLE_ASSIGNMENT|[2]|total|1\n' +
  '09:18:22.6 (1300)|METHOD_ENTRY|[5]|01p|ns.Inner.step()\n' +
  '09:18:22.6 (1400)|VARIABLE_ASSIGNMENT|[6]|inner|"deep"\n' +
  '09:18:22.6 (1500)|METHOD_EXIT|[5]|ns.Inner.step()\n' +
  '09:18:22.6 (1600)|VARIABLE_ASSIGNMENT|[8]|total|2\n' +
  '09:18:22.6 (1700)|METHOD_EXIT|[1]|ns.Outer.run()\n';

describe('apexCodeLevel', () => {
  it('reads the level the log was captured at', () => {
    expect(apexCodeLevel(storeOf('').log)).toBe('FINEST');
    expect(recordsVariables(storeOf('').log)).toBe(true);
  });

  it('tells a level that records no variables from one that does', () => {
    const { log } = storeOf('', '64.0 APEX_CODE,FINE;APEX_PROFILING,NONE;DB,NONE\n');

    expect(apexCodeLevel(log)).toBe('FINE');
    expect(recordsVariables(log)).toBe(false);
  });
});

describe('frameVariablesFor', () => {
  it('reads the locals a frame wrote', async () => {
    const { log, store } = storeOf(OUTER);
    const frame = frameVariablesFor(store, indexOf(log, 'ns.Outer.run()'), null);

    expect(frame?.frameLabel).toBe('ns.Outer.run()');
    expect(frame?.locals).toEqual([
      {
        name: 'total',
        value: '2',
        declaredType: 'Integer',
        address: null,
        assigned: true,
        objectAddress: null,
      },
    ]);
  });

  // The value is what the frame left, so the later write wins.
  it('shows the last write a frame made, not the first', () => {
    const { log, store } = storeOf(OUTER);

    const frame = frameVariablesFor(store, indexOf(log, 'ns.Outer.run()'), null);

    expect(frame?.locals[0]?.value).toBe('2');
  });

  // "Only the ones on stack and would be visible": a caller's local is on the
  // stack but out of scope from the method it called.
  it('keeps a caller local out of the frame it called', () => {
    const { log, store } = storeOf(OUTER);

    const inner = frameVariablesFor(store, indexOf(log, 'ns.Inner.step()'), null);

    expect(inner?.locals.map((row) => row.name)).toEqual(['inner']);
  });

  it('reads an event inside a frame as the log reached it', () => {
    const { log, store } = storeOf(OUTER);

    // The inner call sits between the two writes to `total`.
    const atInner = frameVariablesFor(store, indexOf(log, 'ns.Inner.step()'), null);
    const outerIndex = indexOf(log, 'ns.Outer.run()');
    const inner = log.eventsById.find((event) => event.text === 'ns.Inner.step()')!;
    const fromParent = frameVariablesFor(store, outerIndex, null);

    // Asked of the inner frame, the answer is the inner frame's own scope.
    expect(atInner?.frameLabel).toBe('ns.Inner.step()');
    // Asked of the outer frame, both of its writes are in.
    expect(fromParent?.locals[0]?.value).toBe('2');
    expect(inner.eventIndex).toBeGreaterThan(outerIndex);
  });

  it('splits instance fields out of the locals', () => {
    const { log, store } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[2]|count|1\n' +
        '09:18:22.6 (1200)|VARIABLE_ASSIGNMENT|[3]|this.count|7\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );

    const frame = frameVariablesFor(store, indexOf(log, 'ns.Outer.run()'), null);

    // Shadowing stays visible: one name, one row in each group.
    expect(frame?.locals.map((row) => row.name)).toEqual(['count']);
    expect(frame?.fields).toEqual([
      {
        name: 'count',
        value: '7',
        declaredType: null,
        address: null,
        assigned: true,
        objectAddress: null,
      },
    ]);
    expect(frame?.thisType).toBe('ns.Outer');
  });

  it('leaves a static out of the locals, since the index answers for it', () => {
    const { log, store } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[2]|ns.Cache.hits|4\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );

    const frame = frameVariablesFor(store, indexOf(log, 'ns.Outer.run()'), null);

    expect(frame?.locals).toEqual([]);
    expect(frame?.fields).toEqual([]);
  });

  it('sorts a frame’s locals by name', () => {
    const { log, store } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[2]|zeta|1\n' +
        '09:18:22.6 (1150)|VARIABLE_ASSIGNMENT|[3]|alpha|2\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );

    const frame = frameVariablesFor(store, indexOf(log, 'ns.Outer.run()'), null);

    expect(frame?.locals.map((row) => row.name)).toEqual(['alpha', 'zeta']);
  });

  it('reports no frame for an event the log does not hold', () => {
    const { store } = storeOf(OUTER);

    expect(frameVariablesFor(store, 99_999, null)).toBeNull();
  });
});

describe('VariableIndex', () => {
  const STATICS =
    '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
    '09:18:22.6 (1050)|VARIABLE_SCOPE_BEGIN|[2]|ns.Cache.hits|Integer|true|true\n' +
    '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[2]|ns.Cache.hits|1\n' +
    '09:18:22.6 (1200)|METHOD_ENTRY|[5]|01p|ns.Inner.step()\n' +
    '09:18:22.6 (1300)|VARIABLE_ASSIGNMENT|[6]|ns.Cache.hits|2\n' +
    '09:18:22.6 (1350)|VARIABLE_ASSIGNMENT|[7]|ns.Other.flag|true\n' +
    '09:18:22.6 (1400)|METHOD_EXIT|[5]|ns.Inner.step()\n' +
    '09:18:22.6 (1700)|METHOD_EXIT|[1]|ns.Outer.run()\n';

  it('groups statics by their class, both sorted', async () => {
    const { log, store } = storeOf(STATICS);
    const statics = await variableIndexFor(log);

    const frame = frameVariablesFor(store, indexOf(log, 'ns.Outer.run()'), statics);

    expect(frame?.statics).toEqual([
      {
        className: 'ns.Cache',
        rows: [
          {
            name: 'hits',
            value: '2',
            declaredType: 'Integer',
            address: null,
            assigned: true,
            objectAddress: null,
          },
        ],
      },
      {
        className: 'ns.Other',
        rows: [
          {
            name: 'flag',
            value: 'true',
            declaredType: null,
            address: null,
            assigned: true,
            objectAddress: null,
          },
        ],
      },
    ]);
  });

  // A static assigned after the frame ran was not visible from it.
  it('holds back a static assigned after the frame', async () => {
    const { log, store } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.First.run()\n' +
        '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[2]|ns.Cache.hits|1\n' +
        '09:18:22.6 (1200)|METHOD_EXIT|[1]|ns.First.run()\n' +
        '09:18:22.6 (1300)|METHOD_ENTRY|[9]|01p|ns.Second.run()\n' +
        '09:18:22.6 (1400)|VARIABLE_ASSIGNMENT|[10]|ns.Later.set|9\n' +
        '09:18:22.6 (1500)|METHOD_EXIT|[9]|ns.Second.run()\n',
    );
    const statics = await variableIndexFor(log);

    const first = frameVariablesFor(store, indexOf(log, 'ns.First.run()'), statics);
    const second = frameVariablesFor(store, indexOf(log, 'ns.Second.run()'), statics);

    expect(first?.statics.map((group) => group.className)).toEqual(['ns.Cache']);
    // Every static assigned by this point is visible, whichever frame wrote it.
    expect(second?.statics.map((group) => group.className)).toEqual(['ns.Cache', 'ns.Later']);
  });

  it('says whether the log recorded any write at all', async () => {
    const withWrites = await variableIndexFor(storeOf(OUTER).log);
    const withNone = await variableIndexFor(
      storeOf('09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n').log,
    );

    expect(withWrites.sawAnyWrite).toBe(true);
    expect(withNone.sawAnyWrite).toBe(false);
  });

  it('builds one index per log, however many readers ask', async () => {
    const { log } = storeOf(STATICS);

    const [first, second] = await Promise.all([variableIndexFor(log), variableIndexFor(log)]);

    expect(second).toBe(first);
    expect(await variableIndexFor(log)).toBe(first);
  });
});

// Where a value would not serialise the log writes a bare address, and reports
// that same address beside a real value elsewhere, which is how nearly every
// bare address resolves.
// A frame can run with another instance of its own class on the stack. The class
// alone cannot tell them apart; the object's address can.
// Past the per-name cap the walk drops the oldest writes to a static, so a late
// frame reads the true last value rather than a stale early one.
describe('classAt does not leak the last declared class', () => {
  // `this` is not redeclared on every call: the second frame here writes `this`
  // with no scope declaration of its own, and must not borrow the first
  // frame's class just because it was the last one the walk saw.
  it('names no class for a this write its own frame never declared', async () => {
    const { log } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1050)|CONSTRUCTOR_ENTRY|[2]|01p|<init>()|ns.First\n' +
        '09:18:22.6 (1060)|VARIABLE_SCOPE_BEGIN|[9]|this|ns.First|true|false\n' +
        '09:18:22.6 (1070)|VARIABLE_ASSIGNMENT|[9]|this|{}|0xaaa111\n' +
        '09:18:22.6 (1080)|CONSTRUCTOR_EXIT|[2]|01p|<init>()|ns.First\n' +
        '09:18:22.6 (1200)|METHOD_ENTRY|[3]|01p|ns.Second.run()\n' +
        '09:18:22.6 (1250)|VARIABLE_ASSIGNMENT|[3]|this|{}|0xbbb222\n' +
        '09:18:22.6 (1260)|METHOD_EXIT|[3]|ns.Second.run()\n' +
        '09:18:22.6 (1900)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );
    const index = await variableIndexFor(log);

    expect(index.classAt('0xaaa111', 99_999)).toBe('ns.First');
    expect(index.classAt('0xbbb222', 99_999)).toBeNull();
  });
});

describe('static write cap keeps recency, not insertion order', () => {
  it('answers with the most recent write, not the earliest', async () => {
    const lines: string[] = ['09:18:22.6 (300)|METHOD_ENTRY|[1]|01p|ns.Outer.run()'];
    const total = 20_005;
    for (let i = 0; i < total; i++) {
      lines.push(`09:18:22.6 (${400 + i})|VARIABLE_ASSIGNMENT|[2]|ns.Counter.total|${i}`);
    }
    lines.push('09:18:22.6 (999999)|METHOD_EXIT|[1]|ns.Outer.run()');
    const { log, store } = storeOf(lines.join('\n') + '\n');
    const index = await variableIndexFor(log);

    const frame = frameVariablesFor(store, indexOf(log, 'ns.Outer.run()'), index);
    const counter = frame?.statics.find((entry) => entry.className === 'ns.Counter');

    expect(counter?.rows.find((row) => row.name === 'total')?.value).toBe(String(total - 1));
  }, 15_000);
});

// A field row's own line reports its owner, never the field's own value: taking
// it as the field's address would resolve the field to the OWNER's class.
describe('a field row never borrows its owner as its own address', () => {
  it('carries no object address of its own', () => {
    const { log, store } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1060)|VARIABLE_SCOPE_BEGIN|[9]|this|ns.Outer|true|false\n' +
        '09:18:22.6 (1070)|VARIABLE_ASSIGNMENT|[9]|this|{}|0xbbb222\n' +
        '09:18:22.6 (1150)|VARIABLE_ASSIGNMENT|[3]|this.total|42|0xbbb222\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );

    const frame = frameVariablesFor(store, indexOf(log, 'ns.Outer.run()'), null);
    const total = frame?.fields.find((row) => row.name === 'total');

    expect(total?.value).toBe('42');
    expect(total?.objectAddress).toBeNull();
  });
});

describe('two instances of one class on the stack', () => {
  const TWO =
    '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Same.outer()\n' +
    '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[2]|this.outerOnly|"A"|0xaaa111\n' +
    '09:18:22.6 (1200)|METHOD_ENTRY|[9]|01p|ns.Same.inner()\n' +
    '09:18:22.6 (1300)|VARIABLE_ASSIGNMENT|[10]|this.innerOnly|"B"|0xbbb222\n' +
    '09:18:22.6 (1400)|METHOD_EXIT|[9]|ns.Same.inner()\n' +
    '09:18:22.6 (1500)|METHOD_EXIT|[1]|ns.Same.outer()\n';

  it('keeps one instance out of the other instance fields', () => {
    const { log, store } = storeOf(TWO);

    const frame = frameVariablesFor(store, indexOf(log, 'ns.Same.inner()'), null);

    expect(frame?.fields.map((row) => row.name)).toEqual(['innerOnly']);
  });

  // The caller's own frame reads as its own object, not the callee's.
  it('reads the caller as its own instance', () => {
    const { log, store } = storeOf(TWO);

    const frame = frameVariablesFor(store, indexOf(log, 'ns.Same.outer()'), null);

    expect(frame?.fields.map((row) => row.name)).toEqual(['outerOnly']);
  });

  // A frame the log never named still merges by class, which is all it has.
  it('still merges by class where the log named no object', () => {
    const { log, store } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Same.outer()\n' +
        '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[2]|this.outerOnly|"A"\n' +
        '09:18:22.6 (1200)|METHOD_ENTRY|[9]|01p|ns.Same.inner()\n' +
        '09:18:22.6 (1300)|VARIABLE_ASSIGNMENT|[10]|this.innerOnly|"B"|0xbbb222\n' +
        '09:18:22.6 (1400)|METHOD_EXIT|[9]|ns.Same.inner()\n' +
        '09:18:22.6 (1500)|METHOD_EXIT|[1]|ns.Same.outer()\n',
    );

    const frame = frameVariablesFor(store, indexOf(log, 'ns.Same.inner()'), null);

    expect(frame?.fields.map((row) => row.name).sort()).toEqual(['innerOnly', 'outerOnly']);
  });
});

// The class of the object at an address, which the declared type often gives
// only as an interface.
describe('VariableIndex classAt', () => {
  // A superclass constructor runs on the same object, inside the subclass
  // constructor. Taking the later declaration would report the ancestor.
  const SUBCLASS =
    '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
    '09:18:22.6 (1050)|CONSTRUCTOR_ENTRY|[17]|01p|<init>()|ns.Handler\n' +
    '09:18:22.6 (1060)|VARIABLE_SCOPE_BEGIN|[11]|this|ns.Handler|true|false\n' +
    '09:18:22.6 (1070)|VARIABLE_ASSIGNMENT|[11]|this|{}|0x7b43a738\n' +
    '09:18:22.6 (1080)|CONSTRUCTOR_ENTRY|[12]|01p|<init>()|ns.BaseHandler\n' +
    '09:18:22.6 (1090)|VARIABLE_SCOPE_BEGIN|[15]|this|ns.BaseHandler|true|false\n' +
    '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[15]|this|{}|0x7b43a738\n' +
    '09:18:22.6 (1110)|CONSTRUCTOR_EXIT|[12]|01p|<init>()|ns.BaseHandler\n' +
    '09:18:22.6 (1120)|CONSTRUCTOR_EXIT|[17]|01p|<init>()|ns.Handler\n' +
    '09:18:22.6 (1900)|METHOD_EXIT|[1]|ns.Outer.run()\n';

  it('names the class the object was constructed as', async () => {
    const { log } = storeOf(SUBCLASS);
    const index = await variableIndexFor(log);

    expect(index.classAt('0x7b43a738', 99_999)).toBe('ns.Handler');
  });

  it('names none before the log declared it', async () => {
    const { log } = storeOf(SUBCLASS);
    const index = await variableIndexFor(log);

    expect(index.classAt('0x7b43a738', 0)).toBeNull();
    expect(index.classAt('0xnothere', 99_999)).toBeNull();
  });

  // An object built outside the log is only ever named by a method, which
  // declares `this` as the type it was compiled against.
  it('falls back to the type a method declared', async () => {
    const { log } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.BaseHandler.run()\n' +
        '09:18:22.6 (1060)|VARIABLE_SCOPE_BEGIN|[15]|this|ns.BaseHandler|true|false\n' +
        '09:18:22.6 (1070)|VARIABLE_ASSIGNMENT|[15]|this|{}|0x7b43a738\n' +
        '09:18:22.6 (1900)|METHOD_EXIT|[1]|ns.BaseHandler.run()\n',
    );
    const index = await variableIndexFor(log);

    expect(index.classAt('0x7b43a738', 99_999)).toBe('ns.BaseHandler');
  });
});

describe('VariableIndex address resolution', () => {
  const ADDRESSED =
    '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
    '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[2]|held|{"Id":"001"}|0xd854c6b\n' +
    '09:18:22.6 (1200)|VARIABLE_ASSIGNMENT|[3]|alias|0xd854c6b\n' +
    '09:18:22.6 (1900)|METHOD_EXIT|[1]|ns.Outer.run()\n';

  // The row names the address; the index says what the log holds for it. The
  // row's own value stays exactly what the log wrote on that line.
  it('names the address a value is, and holds what the log wrote for it', async () => {
    const { log, store } = storeOf(ADDRESSED);
    const index = await variableIndexFor(log);

    const frame = frameVariablesFor(store, indexOf(log, 'ns.Outer.run()'), index)!;
    const alias = frame.locals.find((row) => row.name === 'alias');

    expect(alias?.address).toBe('0xd854c6b');
    expect(alias?.value).toBe('0xd854c6b');
    expect(index.addressState('0xd854c6b', frame.cut).text).toBe('{"Id":"001"}');
  });

  it('leaves a value that is not an address alone', async () => {
    const { log, store } = storeOf(ADDRESSED);
    const index = await variableIndexFor(log);

    const frame = frameVariablesFor(store, indexOf(log, 'ns.Outer.run()'), index);

    expect(frame?.locals.find((row) => row.name === 'held')?.address).toBeNull();
  });

  // The address names an object whose contents change, so answering with a
  // later write would show a state the frame never saw.
  it('answers as the value stood at the cut, not a later one', async () => {
    const { log, store } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.First.run()\n' +
        '09:18:22.6 (1050)|VARIABLE_ASSIGNMENT|[2]|held|{"n":1}|0xaaa\n' +
        '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[3]|alias|0xaaa\n' +
        '09:18:22.6 (1150)|METHOD_EXIT|[1]|ns.First.run()\n' +
        '09:18:22.6 (1200)|METHOD_ENTRY|[9]|01p|ns.Second.run()\n' +
        '09:18:22.6 (1250)|VARIABLE_ASSIGNMENT|[10]|held|{"n":2}|0xaaa\n' +
        '09:18:22.6 (1300)|VARIABLE_ASSIGNMENT|[11]|alias|0xaaa\n' +
        '09:18:22.6 (1350)|METHOD_EXIT|[9]|ns.Second.run()\n',
    );
    const index = await variableIndexFor(log);

    const first = frameVariablesFor(store, indexOf(log, 'ns.First.run()'), index)!;
    const second = frameVariablesFor(store, indexOf(log, 'ns.Second.run()'), index)!;

    expect(index.addressState('0xaaa', first.cut).text).toBe('{"n":1}');
    expect(index.addressState('0xaaa', second.cut).text).toBe('{"n":2}');
  });

  it('holds nothing for an address the log never serialised', async () => {
    const { log, store } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[2]|alias|0xbbb\n' +
        '09:18:22.6 (1900)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );
    const index = await variableIndexFor(log);

    const frame = frameVariablesFor(store, indexOf(log, 'ns.Outer.run()'), index)!;

    expect(frame.locals[0]?.address).toBe('0xbbb');
    expect(index.addressState('0xbbb', frame.cut)).toEqual({ text: null, laterAt: null });
  });

  // On a `this.field` line the reported address is the object the field belongs
  // to, not the value the line wrote: one such address usually carries two or
  // more different values. Taking it as a witness answers about an object with
  // one of its fields.
  it('takes no value from a field write, whose address is the owner', async () => {
    const { log } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[2]|this.sortDir|"asc"|0xf1e2d3\n' +
        '09:18:22.6 (1150)|VARIABLE_ASSIGNMENT|[3]|alias|0xf1e2d3\n' +
        '09:18:22.6 (1900)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );
    const index = await variableIndexFor(log);

    expect(index.addressState('0xf1e2d3', 99_999).text).toBeNull();
  });

  // The same address on a `this` line does name the value: the variable is the
  // object.
  it('takes the value from a write of this, whose address is the object', async () => {
    const { log } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[2]|this|{"sortDir":"asc"}|0xf1e2d3\n' +
        '09:18:22.6 (1150)|VARIABLE_ASSIGNMENT|[3]|alias|0xf1e2d3\n' +
        '09:18:22.6 (1900)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );
    const index = await variableIndexFor(log);

    expect(index.addressState('0xf1e2d3', 99_999).text).toBe('{"sortDir":"asc"}');
  });

  // The frame answers before the index exists, so the section can show the
  // scope while the walk runs. Only the log-wide statics wait for it.
  it('answers the frame alone before the index is built', () => {
    const { log, store } = storeOf(ADDRESSED);

    const frame = frameVariablesFor(store, indexOf(log, 'ns.Outer.run()'), null);

    expect(frame?.locals.find((row) => row.name === 'alias')?.address).toBe('0xd854c6b');
    expect(frame?.statics).toEqual([]);
  });
});

// "Everything that frame could access": a name in scope with no value recorded
// is still in scope, and a field the frame never touched is still its field.
describe('frameVariablesFor whole scope', () => {
  it('lists a local the log declared and never assigned', () => {
    const { log, store } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|VARIABLE_SCOPE_BEGIN|[2]|never|Boolean|true|false\n' +
        '09:18:22.6 (1200)|VARIABLE_ASSIGNMENT|[3]|written|1\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );

    const frame = frameVariablesFor(store, indexOf(log, 'ns.Outer.run()'), null);
    const never = frame?.locals.find((row) => row.name === 'never');

    expect(never?.assigned).toBe(false);
    expect(never?.value).toBe('');
    expect(never?.declaredType).toBe('Boolean');
  });

  // A method of class X shares its `this` with another method of X that called
  // it, so a field the caller set is in scope in the callee.
  it('gathers fields from a caller frame of the same class', () => {
    const { log, store } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[2]|this.fromCaller|"set early"\n' +
        '09:18:22.6 (1200)|METHOD_ENTRY|[5]|01p|ns.Outer.step()\n' +
        '09:18:22.6 (1300)|VARIABLE_ASSIGNMENT|[6]|this.fromCallee|7\n' +
        '09:18:22.6 (1400)|METHOD_EXIT|[5]|ns.Outer.step()\n' +
        '09:18:22.6 (1500)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );

    const frame = frameVariablesFor(store, indexOf(log, 'ns.Outer.step()'), null);

    expect(frame?.fields.map((row) => row.name)).toEqual(['fromCallee', 'fromCaller']);
  });

  // A different class on the stack has a different `this`.
  it('leaves the fields of another class out', () => {
    const { log, store } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Other.run()\n' +
        '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[2]|this.notMine|1\n' +
        '09:18:22.6 (1200)|METHOD_ENTRY|[5]|01p|ns.Outer.step()\n' +
        '09:18:22.6 (1300)|VARIABLE_ASSIGNMENT|[6]|this.mine|2\n' +
        '09:18:22.6 (1400)|METHOD_EXIT|[5]|ns.Outer.step()\n' +
        '09:18:22.6 (1500)|METHOD_EXIT|[1]|ns.Other.run()\n',
    );

    const frame = frameVariablesFor(store, indexOf(log, 'ns.Outer.step()'), null);

    expect(frame?.fields.map((row) => row.name)).toEqual(['mine']);
  });

  it('lists a static the log declared and never assigned', async () => {
    const { log, store } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|VARIABLE_SCOPE_BEGIN|[2]|ns.Cache.never|Integer|true|true\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );
    const index = await variableIndexFor(log);

    const frame = frameVariablesFor(store, indexOf(log, 'ns.Outer.run()'), index);

    expect(frame?.statics).toEqual([
      {
        className: 'ns.Cache',
        rows: [
          {
            name: 'never',
            value: '',
            declaredType: 'Integer',
            address: null,
            assigned: false,
            objectAddress: null,
          },
        ],
      },
    ]);
  });

  it('holds back a static declared after the frame ran', async () => {
    const { log, store } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.First.run()\n' +
        '09:18:22.6 (1050)|VARIABLE_ASSIGNMENT|[2]|seen|1\n' +
        '09:18:22.6 (1100)|METHOD_EXIT|[1]|ns.First.run()\n' +
        '09:18:22.6 (1200)|METHOD_ENTRY|[9]|01p|ns.Second.run()\n' +
        '09:18:22.6 (1250)|VARIABLE_SCOPE_BEGIN|[10]|ns.Late.field|Integer|true|true\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[9]|ns.Second.run()\n',
    );
    const index = await variableIndexFor(log);

    const first = frameVariablesFor(store, indexOf(log, 'ns.First.run()'), index);
    const second = frameVariablesFor(store, indexOf(log, 'ns.Second.run()'), index);

    expect(first?.statics).toEqual([]);
    expect(second?.statics.map((group) => group.className)).toEqual(['ns.Late']);
  });
});

/**
 * A SOQL statement is not Apex code with locals of its own: `Database.query`
 * issued it, and the query was built two lines above in the calling method. So
 * the scope answered is the nearest frame recording a variable, and the label
 * says which frame that was.
 */
describe('frameVariablesFor scope attribution', () => {
  const QUERY =
    '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
    '09:18:22.6 (1050)|VARIABLE_ASSIGNMENT|[2]|compId|"a450R000004NtIoQAK"\n' +
    '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[3]|qry|"SELECT Id FROM Account"\n' +
    '09:18:22.6 (1150)|STATEMENT_EXECUTE|[4]\n' +
    '09:18:22.6 (1200)|SYSTEM_METHOD_ENTRY|[4]|Database.query(String)\n' +
    '09:18:22.6 (1250)|SOQL_EXECUTE_BEGIN|[4]|Aggregations:0|SELECT Id FROM Account\n' +
    '09:18:22.6 (1300)|SOQL_EXECUTE_END|[4]|Rows:204\n' +
    '09:18:22.6 (1350)|SYSTEM_METHOD_EXIT|[4]|Database.query(String)\n' +
    '09:18:22.6 (1400)|METHOD_EXIT|[1]|ns.Outer.run()\n';

  it('answers a SOQL selection with the scope that built the query', () => {
    const { log, store } = storeOf(QUERY);

    const frame = frameVariablesFor(store, indexOf(log, 'SELECT Id FROM Account'), null);

    expect(frame?.locals.map((row) => row.name)).toEqual(['compId', 'qry']);
    // The label names the frame the locals belong to, so it is never a guess.
    expect(frame?.frameLabel).toBe('ns.Outer.run()');
  });

  it('answers a frame that has its own variables with its own', () => {
    const { log, store } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1050)|VARIABLE_ASSIGNMENT|[2]|outer|1\n' +
        '09:18:22.6 (1100)|METHOD_ENTRY|[5]|01p|ns.Inner.step()\n' +
        '09:18:22.6 (1150)|VARIABLE_ASSIGNMENT|[6]|inner|2\n' +
        '09:18:22.6 (1200)|METHOD_EXIT|[5]|ns.Inner.step()\n' +
        '09:18:22.6 (1250)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );

    const frame = frameVariablesFor(store, indexOf(log, 'ns.Inner.step()'), null);

    // It records a variable of its own, so the climb stops there.
    expect(frame?.locals.map((row) => row.name)).toEqual(['inner']);
    expect(frame?.frameLabel).toBe('ns.Inner.step()');
  });

  it('reads the query scope as it stood when the query ran', () => {
    const { log, store } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1050)|VARIABLE_ASSIGNMENT|[2]|compId|"first"\n' +
        '09:18:22.6 (1100)|SYSTEM_METHOD_ENTRY|[4]|Database.query(String)\n' +
        '09:18:22.6 (1150)|SOQL_EXECUTE_BEGIN|[4]|Aggregations:0|SELECT Id FROM Account\n' +
        '09:18:22.6 (1200)|SOQL_EXECUTE_END|[4]|Rows:1\n' +
        '09:18:22.6 (1250)|SYSTEM_METHOD_EXIT|[4]|Database.query(String)\n' +
        '09:18:22.6 (1300)|VARIABLE_ASSIGNMENT|[7]|compId|"after the query"\n' +
        '09:18:22.6 (1350)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );

    const atQuery = frameVariablesFor(store, indexOf(log, 'SELECT Id FROM Account'), null);
    const atFrame = frameVariablesFor(store, indexOf(log, 'ns.Outer.run()'), null);

    // The write after the query was not in scope when the query ran.
    expect(atQuery?.locals[0]?.value).toBe('"first"');
    expect(atFrame?.locals[0]?.value).toBe('"after the query"');
  });
});

// An address can appear inside a value rather than as one, such as a field
// holding a reference to another object.
describe('VariableIndex nested addresses', () => {
  it('resolves an address that only ever appears inside a value', async () => {
    const { log } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1050)|VARIABLE_ASSIGNMENT|[2]|filter|{"RowLimit":3000}|0x6c98700c\n' +
        '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[3]|view|{"m_tliFilter":"0x6c98700c"}|0x7d1781a3\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );
    const index = await variableIndexFor(log);

    expect(index.addressState('0x6c98700c', Number.MAX_SAFE_INTEGER).text).toBe(
      '{"RowLimit":3000}',
    );
  });

  it('reads it as it stood at the cut', async () => {
    const { log, store } = storeOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.First.run()\n' +
        '09:18:22.6 (1050)|VARIABLE_ASSIGNMENT|[2]|filter|{"n":1}|0xaaa\n' +
        '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[3]|view|{"ref":"0xaaa"}\n' +
        '09:18:22.6 (1150)|METHOD_EXIT|[1]|ns.First.run()\n' +
        '09:18:22.6 (1200)|METHOD_ENTRY|[9]|01p|ns.Second.run()\n' +
        '09:18:22.6 (1250)|VARIABLE_ASSIGNMENT|[10]|filter|{"n":2}|0xaaa\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[9]|ns.Second.run()\n',
    );
    const index = await variableIndexFor(log);
    const first = frameVariablesFor(store, indexOf(log, 'ns.First.run()'), index);

    expect(index.addressState('0xaaa', first!.cut).text).toBe('{"n":1}');
    expect(index.addressState('0xaaa', Number.MAX_SAFE_INTEGER).text).toBe('{"n":2}');
  });
});
