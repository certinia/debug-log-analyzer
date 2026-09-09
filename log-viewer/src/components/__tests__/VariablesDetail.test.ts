/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';
import { parse } from 'apex-log-parser';

import { MAX_MARKED_PER_VALUE } from '../../core/log/aggregateVariables.js';
import { logStoreFor, type LogStore } from '../../core/log/LogStore.js';

// Avoid the heavy CodeBlock import chain (vscode-elements, soql formatter). The
// raw value it renders is covered by variableValue's own tests.
jest.mock('../CodeBlock.js', () => ({}));
// The chevron is a vscode-icon, and its connectedCallback throws under jsdom.
jest.mock('#vscode-elements/vscode-icon.js', () => ({}));

import { STATICS_NOTE, type VariablesDetail } from '../VariablesDetail.js';
import '../VariablesDetail.js';

const FINEST = '64.0 APEX_CODE,FINEST;APEX_PROFILING,NONE;DB,NONE\n';
const FINE = '64.0 APEX_CODE,FINE;APEX_PROFILING,NONE;DB,NONE\n';

function logOf(body: string, settings = FINEST): LogStore {
  return logStoreFor(
    parse(
      settings +
        '09:18:22.6 (100)|EXECUTION_STARTED\n' +
        '09:18:22.6 (200)|CODE_UNIT_STARTED|[EXTERNAL]|066d0000002m8ij|apex://pkg.Entry\n' +
        body +
        '09:18:22.6 (900000)|CODE_UNIT_FINISHED|apex://pkg.Entry\n' +
        '09:18:22.6 (901000)|EXECUTION_FINISHED\n',
    ),
  );
}

const FRAME =
  '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
  '09:18:22.6 (1100)|VARIABLE_SCOPE_BEGIN|[2]|total|Integer|true|false\n' +
  '09:18:22.6 (1200)|VARIABLE_ASSIGNMENT|[2]|total|42\n' +
  '09:18:22.6 (1250)|VARIABLE_ASSIGNMENT|[3]|this.name|"Acme"\n' +
  '09:18:22.6 (1300)|VARIABLE_ASSIGNMENT|[4]|ns.Cache.hits|{"a":1,"b":2}\n' +
  '09:18:22.6 (1700)|METHOD_EXIT|[1]|ns.Outer.run()\n';

/** The eventIndex of the frame whose log text is `text`. */
function indexOf(store: LogStore, text: string): number {
  const found = store.log.eventsById.find((event) => event.text === text);
  if (!found) {
    throw new Error(`no event with text ${text}`);
  }
  return found.eventIndex;
}

/** No provider in the test, so the consumed store is assigned straight on. */
async function mount(store: LogStore, props: Partial<VariablesDetail>): Promise<VariablesDetail> {
  const el = document.createElement('variables-detail') as VariablesDetail;
  Object.assign(el, { logStore: store }, props);
  document.body.appendChild(el);
  await el.updateComplete;
  // The statics index is built on the first ask, so the first paint is a note.
  await el.updateComplete;
  await new Promise((resolve) => setTimeout(resolve, 0));
  await el.updateComplete;
  return el;
}

/** The notes on screen. A shadow root's textContent also holds its styles. */
function notes(el: VariablesDetail): string[] {
  return Array.from(el.shadowRoot?.querySelectorAll('.note') ?? []).map(
    (node) => node.textContent?.replace(/\s+/g, ' ').trim() ?? '',
  );
}

/** Every row's text, styles left out. */
function rowText(el: VariablesDetail): string {
  return Array.from(el.shadowRoot?.querySelectorAll('[role="treeitem"], .is-note, .note') ?? [])
    .map((node) => node.textContent ?? '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Names as shown, without the colon that joins a name to its value. */
function rowNames(el: VariablesDetail): string[] {
  return Array.from(el.shadowRoot?.querySelectorAll('.name') ?? []).map(
    (node) => node.textContent?.trim().replace(/:$/, '') ?? '',
  );
}

function rowNamed(el: VariablesDetail, name: string): Element | undefined {
  return treeRows(el).find(
    (row) => row.querySelector('.name')?.textContent?.replace(/:$/, '') === name,
  );
}

function groupNames(el: VariablesDetail): string[] {
  return Array.from(el.shadowRoot?.querySelectorAll('.group-name') ?? []).map(
    (node) => node.textContent?.trim() ?? '',
  );
}

// A throw during the whole-log walk must not leave the section reading forever
// with no error and no way to retry.
describe('VariablesDetail read failure', () => {
  it('shows a message rather than staying on "Reading the log…" forever', async () => {
    const store = logOf(FRAME);
    Object.defineProperty(store.log, 'children', {
      get(): never {
        throw new Error('boom');
      },
    });
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    expect(notes(el)).toContain('Could not read the log for variables.');
    errorSpy.mockRestore();
  });
});

// Reading an aggregate's frame back through the log costs tens of ms on a huge
// frame (frameVariables.ts), and render() throws it away unread.
describe('VariablesDetail skips the frame read for an aggregate', () => {
  it('never asks for the frame when more than one instance is selected', async () => {
    const store = logOf(FRAME);
    const el = await mount(store, {
      eventIndex: indexOf(store, 'ns.Outer.run()'),
      frames: [indexOf(store, 'ns.Outer.run()'), indexOf(store, 'ns.Outer.run()')],
    });

    expect((el as unknown as { _frame: unknown })._frame).toBeNull();
  });
});

describe('VariablesDetail empty states', () => {
  // Telling a FINEST user to set FINEST is the worst answer available, so each
  // case has to read differently.
  it('names the log level that would fill it', async () => {
    const store = logOf(FRAME, FINE);

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    expect(notes(el)).toEqual(['Variables available with the Apex Code log level at FINEST.']);
  });

  it('says a FINEST log recorded no write at all', async () => {
    const store = logOf('09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n');

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    expect(notes(el)).toEqual(['This log records no variable assignments.']);
  });

  it('says a frame had nothing in scope, where the log has writes elsewhere', async () => {
    const store = logOf(
      FRAME +
        '09:18:22.6 (1800)|METHOD_ENTRY|[9]|01p|ns.Quiet.run()\n' +
        '09:18:22.6 (1900)|METHOD_EXIT|[9]|ns.Quiet.run()\n',
    );

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Quiet.run()') });

    // The statics are still visible from it, so this frame reports them.
    expect(groupNames(el)).toContain('Static');
  });
});

function treeRows(el: VariablesDetail): HTMLElement[] {
  return Array.from(el.shadowRoot?.querySelectorAll<HTMLElement>('[role="treeitem"]') ?? []);
}

function tree(el: VariablesDetail): HTMLElement {
  const found = el.shadowRoot?.querySelector<HTMLElement>('[role="tree"]');
  if (!found) {
    throw new Error('no tree');
  }
  return found;
}

/** The row holding the tree's one tab stop. */
function tabStop(el: VariablesDetail): string | null {
  return el.shadowRoot?.querySelector('[tabindex="0"]')?.getAttribute('data-id') ?? null;
}

/** Returns the event, so a caller can read back whether the tree consumed it. */
async function press(
  el: VariablesDetail,
  key: string,
  options: Partial<KeyboardEventInit> = {},
): Promise<KeyboardEvent> {
  const event = new KeyboardEvent('keydown', {
    key,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  tree(el).dispatchEvent(event);
  await el.updateComplete;
  return event;
}

describe('VariablesDetail groups', () => {
  it('shows Local, this and Static, in that order', async () => {
    const store = logOf(FRAME);

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    expect(groupNames(el)).toEqual(['Local', 'this', 'Static']);
  });

  it('opens Local and leaves the rest closed', async () => {
    const store = logOf(FRAME);

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    const groups = treeRows(el).filter((row) => row.querySelector('.group-name'));
    expect(groups.map((row) => row.getAttribute('aria-expanded'))).toEqual([
      'true',
      'false',
      'false',
    ]);
    // Local is open, so its one row shows.
    expect(rowNames(el)).toContain('total');
  });

  // Everything that opens says so, groups included.
  it('gives every row that opens a chevron, and every other row its gap', async () => {
    const store = logOf(FRAME);

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    for (const row of treeRows(el)) {
      const opens = row.getAttribute('aria-expanded') !== null;
      expect(!!row.querySelector('.chevron')).toBe(opens);
      expect(!!row.querySelector('.chevron-gap')).toBe(!opens);
    }
  });

  it('shows the declared type the log recorded', async () => {
    const store = logOf(FRAME);

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    expect(rowText(el)).toContain('Integer');
  });

  it('keeps a disclosure the user closed when the selection moves', async () => {
    const store = logOf(
      FRAME +
        '09:18:22.6 (1800)|METHOD_ENTRY|[9]|01p|ns.Second.run()\n' +
        '09:18:22.6 (1850)|VARIABLE_ASSIGNMENT|[10]|other|7\n' +
        '09:18:22.6 (1900)|METHOD_EXIT|[9]|ns.Second.run()\n',
    );
    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    treeRows(el)[0]?.click();
    await el.updateComplete;
    el.eventIndex = indexOf(store, 'ns.Second.run()');
    await el.updateComplete;

    expect(treeRows(el)[0]?.getAttribute('aria-expanded')).toBe('false');
  });

  // A chevron that opened on nothing would teach a depth the log lacks.
  it('offers no expander on a value a row can hold', async () => {
    const store = logOf(FRAME);

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    // `total` is 42, so its row opens on nothing.
    const total = rowNamed(el, 'total');
    expect(total?.getAttribute('aria-expanded')).toBeNull();
    expect(total?.querySelector('.chevron-gap')).not.toBeNull();
  });

  // Open, the rows below carry the value; a preview as well would print it twice.
  it('drops the preview once the value is open below it', async () => {
    const store = logOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[2]|held|{"a":1,"b":2}\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );
    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });
    const held = () => treeRows(el).find((row) => row.dataset.id === 'local/held');

    const before = held()?.querySelector('.value')?.textContent?.trim();
    held()?.click();
    await el.updateComplete;

    expect(before).toContain('a: 1');
    expect(held()?.getAttribute('aria-expanded')).toBe('true');
    expect(held()?.querySelector('.value')).toBeNull();
    // The properties are rows of their own, so the arrows reach them.
    expect(treeRows(el).some((row) => row.dataset.id === 'local/held/0')).toBe(true);
  });

  it('says so where the log declared a name and never wrote it', async () => {
    const store = logOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|VARIABLE_SCOPE_BEGIN|[2]|never|Boolean|true|false\n' +
        '09:18:22.6 (1150)|VARIABLE_ASSIGNMENT|[3]|written|1\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    expect(rowText(el)).toContain('not assigned');
  });

  // A colon joins a name to its value, and only where a value follows it.
  it('joins a name to its value with a colon', async () => {
    const store = logOf(FRAME);

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    expect(rowNamed(el, 'total')?.querySelector('.name')?.textContent).toBe('total:');
  });

  it('leaves the colon off a name with no value', async () => {
    const store = logOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|VARIABLE_SCOPE_BEGIN|[2]|never|Boolean|true|false\n' +
        '09:18:22.6 (1150)|VARIABLE_ASSIGNMENT|[3]|written|1\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    expect(rowNamed(el, 'never')?.querySelector('.name')?.textContent).toBe('never');
  });

  // One rule for an address: it always trails the row, and the value slot says
  // whether the log ever wrote the object down.
  it('says the object is not recorded where the log wrote no value for it', async () => {
    const store = logOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[2]|alias|0xd854c6b\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });
    const alias = rowNamed(el, 'alias');

    expect(alias?.querySelector('.missing')?.textContent).toContain('no value recorded');
    expect(alias?.querySelector('.ref')?.textContent).toContain('0xd854c6b');
    expect(alias?.querySelector('.chip')).toBeNull();
  });

  // The address is only the identity the runtime printed for the reference. The
  // contents are a separate event, which may land after the frame.
  it('says so where the log recorded the object only after this frame', async () => {
    const store = logOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[2]|alias|0xd854c6b\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n' +
        '09:18:22.6 (1400)|METHOD_ENTRY|[4]|01p|ns.Outer.after()\n' +
        '09:18:22.6 (1500)|VARIABLE_ASSIGNMENT|[5]|held|{"Id":"001"}|0xd854c6b\n' +
        '09:18:22.6 (1600)|METHOD_EXIT|[4]|ns.Outer.after()\n',
    );

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });
    const alias = rowNamed(el, 'alias');

    expect(alias?.querySelector('.missing')?.textContent).toContain('recorded later');
    expect(alias?.querySelector('.ref')?.textContent).toContain('0xd854c6b');
    // Named, because that frame can be far from the one the reader picked.
    expect(alias?.querySelector('.missing')?.getAttribute('title')).toContain('ns.Outer.after()');
  });

  // An interface-typed variable holding a stateless instance reads as `{}`, and
  // the class is the only thing that says what it is.
  it('names the class of the object it shows', async () => {
    const store = logOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1050)|CONSTRUCTOR_ENTRY|[2]|01p|<init>()|ns.Writer.WithoutSharing\n' +
        '09:18:22.6 (1060)|VARIABLE_SCOPE_BEGIN|[9]|this|ns.Writer.WithoutSharing|true|false\n' +
        '09:18:22.6 (1070)|VARIABLE_ASSIGNMENT|[9]|this|{}|0x12d441a3\n' +
        '09:18:22.6 (1080)|CONSTRUCTOR_EXIT|[2]|01p|<init>()|ns.Writer.WithoutSharing\n' +
        '09:18:22.6 (1100)|VARIABLE_SCOPE_BEGIN|[3]|writer|ns.IWriter|true|false\n' +
        '09:18:22.6 (1150)|VARIABLE_ASSIGNMENT|[3]|writer|{}|0x12d441a3\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });
    const writer = rowNamed(el, 'writer');

    // The row has no width for the namespace, so the hover carries it whole.
    expect(writer?.querySelector('.cls')?.textContent).toBe('WithoutSharing');
    expect(writer?.querySelector('.value')?.getAttribute('title')).toContain(
      'ns.Writer.WithoutSharing',
    );
    // The declared type stays its own column, so both read together.
    expect(writer?.querySelector('.type')?.textContent).toBe('ns.IWriter');
  });

  // The type column already says it, so saying it twice is noise.
  it('leaves the class out where it matches the declared type', async () => {
    const store = logOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1060)|VARIABLE_SCOPE_BEGIN|[9]|this|ns.Writer|true|false\n' +
        '09:18:22.6 (1070)|VARIABLE_ASSIGNMENT|[9]|this|{}|0x12d441a3\n' +
        '09:18:22.6 (1100)|VARIABLE_SCOPE_BEGIN|[3]|writer|ns.Writer|true|false\n' +
        '09:18:22.6 (1150)|VARIABLE_ASSIGNMENT|[3]|writer|{}|0x12d441a3\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    expect(rowNamed(el, 'writer')?.querySelector('.cls')).toBeNull();
  });

  // `this` is the instance the frame runs on. Listing it among the locals reads
  // as a variable the method declared.
  it('keeps this out of the locals', async () => {
    const store = logOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Writer.run()\n' +
        '09:18:22.6 (1060)|VARIABLE_SCOPE_BEGIN|[9]|this|ns.Writer|true|false\n' +
        '09:18:22.6 (1070)|VARIABLE_ASSIGNMENT|[9]|this|{}|0x12d441a3\n' +
        '09:18:22.6 (1150)|VARIABLE_ASSIGNMENT|[3]|total|1\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Writer.run()\n',
    );

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Writer.run()') });

    expect(rowNames(el)).not.toContain('this');
    expect(groupNames(el)).toContain('this');
    // A stateless class has nothing to open, and the group says so.
    const group = treeRows(el).find((r) => r.getAttribute('data-id') === 'this');
    expect(group?.getAttribute('aria-expanded')).toBeNull();
    expect(group?.querySelector('.value')?.textContent).toContain('{}');
  });

  it('marks an object it read out of a string', async () => {
    const store = logOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[2]|payload|"{\\"a\\":1}"\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    expect(rowNamed(el, 'payload')?.querySelector('.chip')?.textContent).toBe('json');
  });

  it('reads an address as the object it names', async () => {
    const store = logOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[2]|held|{"Id":"001"}|0xd854c6b\n' +
        '09:18:22.6 (1200)|VARIABLE_ASSIGNMENT|[3]|alias|0xd854c6b\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });
    const alias = rowNamed(el, 'alias');

    expect(alias?.querySelector('.value')?.textContent).toContain('Id');
    // The arrow says the log wrote no value on this line.
    const ref = alias?.querySelector('.ref');
    expect(ref?.textContent).toContain('0xd854c6b');
    expect(ref?.textContent).toContain('\u2192');
  });
});

// The tree keyboard pattern: one tab stop, the arrows walk and open.
describe('VariablesDetail keyboard', () => {
  // A note carries no tabindex, so a move that landed on one would leave the
  // tree with no tab stop at all: focus and forth keys would then do nothing.
  it('never lands the tab stop on a note', async () => {
    const store = logOf(
      '09:18:22.6 (900)|METHOD_ENTRY|[1]|01p|ns.Setup.run()\n' +
        '09:18:22.6 (950)|VARIABLE_ASSIGNMENT|[1]|ns.Cache.hits|1\n' +
        '09:18:22.6 (990)|METHOD_EXIT|[1]|ns.Setup.run()\n' +
        '09:18:22.6 (1000)|METHOD_ENTRY|[2]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[2]|ns.Outer.run()\n',
    );
    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    // Local starts open with no locals, so it opens onto a note.
    expect(tabStop(el)).toBe('local');
    await press(el, 'ArrowDown');

    expect(tabStop(el)).not.toBeNull();
    expect(treeRows(el).find((row) => row.dataset.id === tabStop(el))?.classList).not.toContain(
      'is-note',
    );
  });

  it('gives the tree one tab stop', async () => {
    const store = logOf(FRAME);

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    expect(el.shadowRoot?.querySelectorAll('[tabindex="0"]')).toHaveLength(1);
    expect(tabStop(el)).toBe('local');
  });

  it('walks down and up', async () => {
    const store = logOf(FRAME);
    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    await press(el, 'ArrowDown');
    const second = tabStop(el);
    await press(el, 'ArrowUp');

    expect(second).not.toBe('local');
    expect(tabStop(el)).toBe('local');
  });

  it('opens with the right arrow and closes with the left', async () => {
    const store = logOf(FRAME);
    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    // Walk to `this`, which starts closed.
    while (tabStop(el) !== 'this') {
      await press(el, 'ArrowDown');
    }
    const fields = () => treeRows(el).find((row) => row.dataset.id === 'this');
    await press(el, 'ArrowRight');
    const opened = fields()?.getAttribute('aria-expanded');
    await press(el, 'ArrowLeft');

    expect(opened).toBe('true');
    expect(fields()?.getAttribute('aria-expanded')).toBe('false');
  });

  it('steps out to the row that holds it', async () => {
    const store = logOf(FRAME);
    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    // Local is open, so the row below it is one of its own.
    await press(el, 'ArrowDown');
    await press(el, 'ArrowLeft');

    expect(tabStop(el)).toBe('local');
  });

  it('reaches the first and last row', async () => {
    const store = logOf(FRAME);
    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    await press(el, 'End');
    const last = tabStop(el);
    await press(el, 'Home');

    expect(last).toBe('static');
    expect(tabStop(el)).toBe('local');
  });

  it('opens every group at one depth with a star', async () => {
    const store = logOf(FRAME);
    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    await press(el, '*');

    const groups = treeRows(el).filter((row) => row.querySelector('.group-name'));
    expect(groups.map((row) => row.getAttribute('aria-expanded'))).toEqual([
      'true',
      'true',
      'true',
    ]);
  });

  it('toggles with Enter', async () => {
    const store = logOf(FRAME);
    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    await press(el, 'Enter');

    expect(treeRows(el)[0]?.getAttribute('aria-expanded')).toBe('false');
  });
});

describe('VariablesDetail keyboard, key repeat', () => {
  it('holds a row where a held Enter left it, rather than flapping', async () => {
    const store = logOf(FRAME);
    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    await press(el, 'Enter');
    await press(el, 'Enter', { repeat: true });
    const afterEnter = treeRows(el)[0]?.getAttribute('aria-expanded');
    await press(el, ' ', { repeat: true });

    expect(afterEnter).toBe('false');
    expect(treeRows(el)[0]?.getAttribute('aria-expanded')).toBe('false');
  });

  it('leaves a group closed that a held star would re-open', async () => {
    const store = logOf(FRAME);
    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });
    const local = () => treeRows(el).find((row) => row.dataset.id === 'local');

    // Local starts open, and holds the tab stop, so Enter closes it.
    await press(el, 'Enter');
    await press(el, '*', { repeat: true });

    expect(local()?.getAttribute('aria-expanded')).toBe('false');
  });

  it('keeps the key consumed on a suppressed repeat', async () => {
    const store = logOf(FRAME);
    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    const event = await press(el, 'Enter', { repeat: true });

    expect(event.defaultPrevented).toBe(true);
  });

  it('walks on every repeat, so holding an arrow scrubs', async () => {
    const store = logOf(FRAME);
    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    await press(el, 'ArrowDown');
    const second = tabStop(el);
    await press(el, 'ArrowDown', { repeat: true });

    expect(second).not.toBe('local');
    expect(tabStop(el)).not.toBe(second);
  });
});

// Reading the scope back through a huge frame costs tens of ms, so opening a
// row must not pay it again.
describe('VariablesDetail reads the scope once per selection', () => {
  /** The snapshot the section is rendering from. */
  const held = (el: VariablesDetail): unknown => (el as unknown as { _frame: unknown })._frame;

  it('keeps the same reading when a row opens', async () => {
    const store = logOf(FRAME);
    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });
    const before = held(el);

    treeRows(el)[0]?.click();
    await el.updateComplete;
    tree(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await el.updateComplete;

    expect(before).toBeTruthy();
    expect(held(el)).toBe(before);
  });

  /** The row list the keyboard walks. */
  const rows = (el: VariablesDetail): unknown => (el as unknown as { _rows: unknown })._rows;

  // Scanning a value is the cost, so a key that only moves the tab stop must not
  // pay it again: a held arrow key fires ~20 times a second.
  it('keeps the same rows when the tab stop moves', async () => {
    const store = logOf(FRAME);
    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });
    const before = rows(el);

    tree(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await el.updateComplete;

    expect(before).toBeTruthy();
    expect(rows(el)).toBe(before);
  });

  it('builds the rows again when a row opens', async () => {
    const store = logOf(FRAME);
    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });
    const before = rows(el);

    treeRows(el)[0]?.click();
    await el.updateComplete;

    expect(rows(el)).not.toBe(before);
  });

  it('reads again when the selection moves', async () => {
    const store = logOf(
      FRAME +
        '09:18:22.6 (1800)|METHOD_ENTRY|[9]|01p|ns.Second.run()\n' +
        '09:18:22.6 (1850)|VARIABLE_ASSIGNMENT|[10]|other|7\n' +
        '09:18:22.6 (1900)|METHOD_EXIT|[9]|ns.Second.run()\n',
    );
    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });
    const before = held(el);

    el.eventIndex = indexOf(store, 'ns.Second.run()');
    await el.updateComplete;

    expect(held(el)).not.toBe(before);
  });
});

// A property is a row like any other, so the arrow keys reach it and it opens.
describe('VariablesDetail properties', () => {
  it('opens a property that is an object in its own right', async () => {
    const store = logOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[2]|outer|{"inner":{"a":1,"b":2},"n":3}\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );
    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });
    const at = (id: string) => treeRows(el).find((r) => r.dataset.id === id);

    at('local/outer')?.click();
    await el.updateComplete;
    const before = at('local/outer/0')?.getAttribute('aria-expanded');
    at('local/outer/0')?.click();
    await el.updateComplete;

    expect(before).toBe('false');
    expect(at('local/outer/0')?.getAttribute('aria-expanded')).toBe('true');
    // Its own properties are rows, one level deeper.
    expect(at('local/outer/0/0')?.getAttribute('aria-level')).toBe('4');
  });

  it('leaves a property that opens on nothing without a chevron', async () => {
    const store = logOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1100)|VARIABLE_ASSIGNMENT|[2]|outer|{"n":3}\n' +
        '09:18:22.6 (1300)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );
    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    treeRows(el)
      .find((r) => r.dataset.id === 'local/outer')
      ?.click();
    await el.updateComplete;
    const property = treeRows(el).find((r) => r.dataset.id === 'local/outer/0');

    expect(property?.getAttribute('aria-expanded')).toBeNull();
    expect(property?.querySelector('.chevron-gap')).not.toBeNull();
  });
});

// A local holding an object reads `{}`, because the log could not serialise it.
// Its fields are lines of their own, and the badge is what says so.
describe('VariablesDetail object fields', () => {
  const BUILT =
    '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
    '09:18:22.6 (1010)|CONSTRUCTOR_ENTRY|[9]|01p|<init>()|ns.Holder\n' +
    '09:18:22.6 (1020)|VARIABLE_SCOPE_BEGIN|[1]|this|ns.Holder|true|false\n' +
    '09:18:22.6 (1030)|VARIABLE_ASSIGNMENT|[1]|this|{}|0xaaa\n' +
    '09:18:22.6 (1040)|VARIABLE_ASSIGNMENT|[2]|this.sObj|"Account"|0xaaa\n' +
    '09:18:22.6 (1050)|CONSTRUCTOR_EXIT|[9]|01p|<init>()|ns.Holder\n' +
    '09:18:22.6 (1060)|VARIABLE_SCOPE_BEGIN|[10]|holder|ns.Holder|true|false\n' +
    '09:18:22.6 (1070)|VARIABLE_ASSIGNMENT|[10]|holder|{}|0xaaa\n' +
    '09:18:22.6 (1080)|VARIABLE_SCOPE_BEGIN|[11]|plain|ns.Other|true|false\n' +
    '09:18:22.6 (1090)|VARIABLE_ASSIGNMENT|[11]|plain|{}|0xzzz\n' +
    '09:18:22.6 (1100)|METHOD_EXIT|[1]|ns.Outer.run()\n';

  it('counts the fields beside a value the log wrote as {}', async () => {
    const store = logOf(BUILT);

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });
    const holder = rowNamed(el, 'holder');

    expect(holder?.querySelector('.count')?.textContent?.trim()).toBe('1');
    expect(holder?.getAttribute('aria-expanded')).toBe('false');
  });

  // `{}` beside a count of one reads as empty, so the row shows what it opens on.
  it('previews the recorded fields on the closed row', async () => {
    const store = logOf(BUILT);

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });
    const holder = rowNamed(el, 'holder');

    expect(holder?.querySelector('.value')?.textContent).toContain('sObj: "Account"');
  });

  // The log wrote no value for the whole object and still recorded its parts. A
  // row that shows those parts must not also claim the log holds nothing.
  it('shows the recorded parts rather than "no value recorded"', async () => {
    const store = logOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1010)|VARIABLE_ASSIGNMENT|[2]|this.rows|5|0xbbb\n' +
        '09:18:22.6 (1020)|VARIABLE_SCOPE_BEGIN|[3]|big|ns.Big|true|false\n' +
        '09:18:22.6 (1030)|VARIABLE_ASSIGNMENT|[3]|big|0xbbb\n' +
        '09:18:22.6 (1040)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });
    const big = rowNamed(el, 'big');

    expect(big?.querySelector('.missing')).toBeNull();
    expect(big?.querySelector('.value')?.textContent).toContain('rows: 5');
    expect(big?.querySelector('.count')?.textContent?.trim()).toBe('1');
  });

  // A cycle leaves a row that cannot open, so a count on it would promise rows
  // the tree will not give.
  it('leaves the count off a row that cannot open', async () => {
    const store = logOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Loop.run()\n' +
        '09:18:22.6 (1010)|VARIABLE_ASSIGNMENT|[2]|this.me|0xddd|0xddd\n' +
        '09:18:22.6 (1020)|VARIABLE_SCOPE_BEGIN|[3]|holder|ns.Loop|true|false\n' +
        '09:18:22.6 (1030)|VARIABLE_ASSIGNMENT|[3]|holder|{}|0xddd\n' +
        '09:18:22.6 (1040)|METHOD_EXIT|[1]|ns.Loop.run()\n',
    );
    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Loop.run()') });

    // The field names the object it belongs to, so it may be read but not opened.
    treeRows(el)
      .find((row) => row.dataset.id === 'local/holder')
      ?.click();
    await el.updateComplete;
    const me = treeRows(el).find((row) => row.dataset.id === 'local/holder/me');

    expect(me).toBeDefined();
    expect(me?.getAttribute('aria-expanded')).toBeNull();
    expect(me?.querySelector('.count')).toBeNull();
  });

  it('offers nothing to open where the log recorded no fields', async () => {
    const store = logOf(BUILT);

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });
    const plain = rowNamed(el, 'plain');

    expect(plain?.querySelector('.count')).toBeNull();
    expect(plain?.getAttribute('aria-expanded')).toBeNull();
  });
});

// A merged row has no single frame, so the section compares its calls: which
// name varied is the reading the grids beside it do not carry.
describe('VariablesDetail comparing a merged row', () => {
  /** One call of `ns.Svc.run()`, writing `retry` and the constant `batchSize`. */
  function call(at: number, retry: string): string {
    const t = (offset: number): string => `09:18:22.6 (${at + offset})`;
    return (
      `${t(0)}|METHOD_ENTRY|[1]|01p|ns.Svc.run()\n` +
      `${t(10)}|VARIABLE_SCOPE_BEGIN|[2]|retry|Boolean|true|false\n` +
      `${t(20)}|VARIABLE_ASSIGNMENT|[2]|retry|${retry}\n` +
      `${t(30)}|VARIABLE_ASSIGNMENT|[3]|batchSize|200\n` +
      `${t(40)}|METHOD_EXIT|[1]|ns.Svc.run()\n`
    );
  }

  const CALLS = call(1000, 'true') + call(2000, 'false') + call(3000, 'false');

  /** Every frame whose text is `text`: a METHOD_EXIT carries the entry's text. */
  function framesOf(store: LogStore, text: string): number[] {
    return store.log.eventsById
      .filter((event) => event.isParent && event.text === text)
      .map((event) => event.eventIndex);
  }

  /** The comparison on screen, once its walk has answered. */
  async function compared(body = CALLS): Promise<VariablesDetail> {
    const store = logOf(body);
    const frames = framesOf(store, 'ns.Svc.run()');
    const el = await mount(store, { eventIndex: frames[0]!, frames });
    // The comparison is a walk of its own, after the index it reads through.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await el.updateComplete;
    return el;
  }

  it('lists every name the calls held, varying ones first', async () => {
    const el = await compared();

    expect(rowNames(el)).toEqual(['retry', 'batchSize']);
  });

  it('opens a name the calls disagreed on into its values and their counts', async () => {
    const el = await compared();
    rowNamed(el, 'retry')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await el.updateComplete;

    expect(rowText(el)).toContain('false');
    expect(rowText(el)).toContain('true');
  });

  it('shows a name every call agreed on as its one value', async () => {
    const el = await compared();

    expect(rowNamed(el, 'batchSize')?.textContent).toContain('200');
    expect(rowNamed(el, 'batchSize')?.getAttribute('aria-expanded')).toBeNull();
  });

  /** Every locate the section raised, in order. */
  function locates(el: VariablesDetail): { eventIndexes: readonly number[]; sticky: boolean }[] {
    const seen: { eventIndexes: readonly number[]; sticky: boolean }[] = [];
    el.addEventListener('inspector-locate', (event) => {
      const { eventIndexes, sticky } = (
        event as CustomEvent<{ eventIndexes: readonly number[]; sticky: boolean }>
      ).detail;
      seen.push({ eventIndexes, sticky });
    });
    return seen;
  }

  /** The value rows of an opened name. */
  async function valuesOf(el: VariablesDetail, name: string): Promise<HTMLElement[]> {
    rowNamed(el, name)?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await el.updateComplete;
    return treeRows(el).filter((row) => row.dataset.id?.startsWith(`local/${name}/`));
  }

  // Every other section answers a merged row with aggregated figures, so
  // dropping onto one of its calls would throw away the reading.
  it('never re-scopes the panel to one call', async () => {
    const el = await compared();
    const revealed: number[] = [];
    el.addEventListener('inspector-reveal', (event) => {
      revealed.push((event as CustomEvent<{ eventIndex: number }>).detail.eventIndex);
    });
    const values = await valuesOf(el, 'retry');

    values[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    rowNamed(el, 'batchSize')?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(revealed).toEqual([]);
  });

  it('marks the calls that held a value while the pointer is over it', async () => {
    const el = await compared();
    const values = await valuesOf(el, 'retry');
    const seen = locates(el);
    const calls = framesOf(el.logStore!, 'ns.Svc.run()');

    values[0]?.dispatchEvent(new MouseEvent('pointerenter', { bubbles: true }));
    values[0]?.dispatchEvent(new MouseEvent('pointerleave', { bubbles: true }));

    // `false` was the second and third calls; leaving hands the mark back.
    expect(seen).toEqual([
      { eventIndexes: [calls[1], calls[2]], sticky: false },
      { eventIndexes: [], sticky: false },
    ]);
  });

  it('holds the mark once a value is picked', async () => {
    const el = await compared();
    const values = await valuesOf(el, 'retry');
    const seen = locates(el);
    const calls = framesOf(el.logStore!, 'ns.Svc.run()');

    values[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    // `true` was the first call. Sticky, and no selection rides with it.
    expect(seen).toEqual([{ eventIndexes: [calls[0]], sticky: true }]);
  });

  // A value is often a scalar with nothing to open, so a keyboard that only
  // toggled could never reach the mark at all.
  it('marks the calls that held a value from the keyboard', async () => {
    const el = await compared();
    await valuesOf(el, 'retry');
    const seen = locates(el);
    const calls = framesOf(el.logStore!, 'ns.Svc.run()');

    // Opening `retry` left the tab stop on it, so one step down lands on its
    // first value.
    tree(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
    await el.updateComplete;
    tree(el).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await el.updateComplete;

    // `false` was the second and third calls, and it leads on count.
    expect(seen).toEqual([{ eventIndexes: [calls[1], calls[2]], sticky: true }]);
  });

  // Every other cap in this section says so; a mark that stops short while the
  // count beside it says thousands would read as a bug in the mark.
  it('says a value holds more calls than its mark names', async () => {
    const many = Array.from({ length: MAX_MARKED_PER_VALUE + 5 }, (_, at) =>
      call(1000 + at * 100, 'true'),
    ).join('');
    const el = await compared(many);

    expect(notes(el)).toContain(
      `A value held by over ${MAX_MARKED_PER_VALUE} calls marks that many of them.`,
    );
  });

  it('says nothing of the kind where every call is marked', async () => {
    const el = await compared();

    expect(notes(el).join(' ')).not.toContain('marks that many');
  });

  // Counts alone mislead: an unbroken run is a state the calls were in.
  it('says whether a value was one run or came and went', async () => {
    const el = await compared();
    const values = await valuesOf(el, 'retry');

    expect(values[0]?.textContent).toContain('one run');
  });

  it('counts the runs of a value the calls returned to', async () => {
    const el = await compared(call(1000, 'true') + call(2000, 'false') + call(3000, 'true'));
    const values = await valuesOf(el, 'retry');

    expect(values[0]?.textContent).toContain('2 runs');
  });

  // The panel stays on the comparison, so a value has to open where it stands.
  it('opens a value that is an object into its fields', async () => {
    const held = (at: number, name: string): string => {
      const t = (offset: number): string => `09:18:22.6 (${at + offset})`;
      return (
        `${t(0)}|METHOD_ENTRY|[1]|01p|ns.Svc.run()\n` +
        `${t(10)}|VARIABLE_ASSIGNMENT|[2]|opts|{"name":"${name}","rows":5}\n` +
        `${t(20)}|METHOD_EXIT|[1]|ns.Svc.run()\n`
      );
    };
    const el = await compared(held(1000, 'A') + held(2000, 'B'));

    const values = await valuesOf(el, 'opts');
    expect(values[0]?.getAttribute('aria-expanded')).toBe('false');

    values[0]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await el.updateComplete;

    expect(rowText(el)).toContain('name');
    expect(rowText(el)).toContain('rows');
  });

  // A static moves for reasons the row does not own, so leaving them out is a
  // decision the reader is owed.
  it('says the statics are not compared', async () => {
    const el = await compared();

    expect(notes(el)).toContain(STATICS_NOTE);
  });

  it('does not say the statics are not compared for a single frame', async () => {
    const store = logOf(FRAME);

    const el = await mount(store, { eventIndex: indexOf(store, 'ns.Outer.run()') });

    expect(notes(el)).not.toContain(STATICS_NOTE);
  });

  // A row's frames are its own scope; its calls are a level below it. A bottom-up
  // caller row that ran once comes down to one frame, and reading the calls it
  // counts would show the called method's scope under the caller's name.
  it('reads its own frame where a merged row comes down to one', async () => {
    const store = logOf(
      '09:18:22.6 (1000)|METHOD_ENTRY|[1]|01p|ns.Outer.run()\n' +
        '09:18:22.6 (1010)|VARIABLE_ASSIGNMENT|[2]|outerLocal|"here"\n' +
        '09:18:22.6 (1020)|METHOD_ENTRY|[3]|01p|ns.Svc.query()\n' +
        '09:18:22.6 (1030)|VARIABLE_ASSIGNMENT|[4]|inner|1\n' +
        '09:18:22.6 (1040)|METHOD_EXIT|[3]|ns.Svc.query()\n' +
        '09:18:22.6 (1050)|METHOD_ENTRY|[3]|01p|ns.Svc.query()\n' +
        '09:18:22.6 (1060)|VARIABLE_ASSIGNMENT|[4]|inner|2\n' +
        '09:18:22.6 (1070)|METHOD_EXIT|[3]|ns.Svc.query()\n' +
        '09:18:22.6 (1080)|METHOD_EXIT|[1]|ns.Outer.run()\n',
    );
    const calls = store.log.eventsById
      .filter((event) => event.isParent && event.text === 'ns.Svc.query()')
      .map((event) => event.eventIndex);

    // What a bottom-up caller row hands over: the calls it counts, and the one
    // frame that made them.
    const el = await mount(store, {
      eventIndex: calls[0]!,
      frames: [indexOf(store, 'ns.Outer.run()')],
    });

    expect(rowNames(el)).toContain('outerLocal');
    expect(rowNames(el)).not.toContain('inner');
  });
});
