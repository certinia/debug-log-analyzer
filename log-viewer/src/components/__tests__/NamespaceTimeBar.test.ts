/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import type { ApexLog } from '@apexdevtools/apex-log-parser';

let apexLog: ApexLog | null = null;

import { indexTree } from '#test-helpers/apexLog.js';
import { logStoreFor } from '../../core/log/LogStore.js';
import type { NamespaceTimeBar } from '../NamespaceTimeBar.js';
import { DEFAULT_MAX_SEGMENTS } from '../StackedTimeBar.js';
import '../NamespaceTimeBar.js';
import { logNamespacePalette } from '../namespacePalette.js';
import { namespaceEvent, log, type FakeEvent } from './fixtures/logEvents.js';

const logOf = (children: FakeEvent[], namespaces: string[]) => {
  apexLog = log(children, namespaces);
  indexTree(apexLog);
};

async function mount(props: Partial<Pick<NamespaceTimeBar, 'eventIndex' | 'instances'>> = {}) {
  const element = document.createElement('namespace-time-bar');
  // No provider in the test, so the consumed store is assigned straight on.
  Object.assign(element, { logStore: apexLog && logStoreFor(apexLog) }, props);
  document.body.append(element);
  // The first render only starts the index; the result lands a task later.
  for (let settle = 0; settle < 5; settle++) {
    await element.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));
    await element.updateComplete;
  }
  return element;
}

const bar = (element: NamespaceTimeBar) =>
  element.shadowRoot?.querySelector('stacked-time-bar') ?? null;

const segments = (element: NamespaceTimeBar) => bar(element)?.segments ?? [];

describe('namespace-time-bar', () => {
  beforeEach(() => {
    document.body.replaceChildren();
    apexLog = null;
  });

  it('scopes to the selected frame and everything below it', async () => {
    const frame = namespaceEvent('pkg', 40, [namespaceEvent('other', 10)]);
    logOf([namespaceEvent('default', 100, [frame])], ['pkg', 'other']);

    const element = await mount({ eventIndex: frame.eventIndex });

    expect(segments(element).map(({ label }) => label)).toEqual(['pkg', 'other']);
    // The log's palette, not the scope's order: `other` keeps its log colour even
    // though it is second here and third in the log.
    expect(segments(element)[1]?.color).toBe(logNamespacePalette(apexLog!)('other'));
  });

  it('sums every occurrence of an aggregate, counting a nested one once', async () => {
    const inner = namespaceEvent('pkg', 20);
    const outer = namespaceEvent('pkg', 30, [inner]);
    logOf([outer], ['pkg']);

    const element = await mount({ instances: [outer.eventIndex, inner.eventIndex] });

    expect(segments(element)[0]).toMatchObject({ label: 'pkg', value: 50 });
  });

  it('gathers the namespaces past the cap into one tail segment', async () => {
    const namespaces = Array.from(
      { length: DEFAULT_MAX_SEGMENTS },
      (_, index) => `ns${index}`,
    ).concat('nsA', 'nsB');
    // Descending self time, so the two smallest fall past the palette.
    logOf(
      namespaces.map((namespace, index) =>
        namespaceEvent(namespace, (namespaces.length - index) * 10),
      ),
      namespaces,
    );

    const shown = segments(await mount());

    expect(shown).toHaveLength(DEFAULT_MAX_SEGMENTS + 1);
    // nsA at 20 and nsB at 10.
    expect(shown.at(-1)).toMatchObject({ label: '2 others', value: 30 });
  });

  it('keeps its bar while a new scope in the same log adds up', async () => {
    const first = namespaceEvent('pkg', 40);
    const second = namespaceEvent('other', 10);
    logOf([first, second], ['pkg', 'other']);
    const element = await mount({ eventIndex: first.eventIndex });
    const shown = bar(element);

    element.eventIndex = second.eventIndex;
    await element.updateComplete;
    expect(bar(element)).toBe(shown);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await element.updateComplete;

    expect(bar(element)).toBe(shown);
    expect(segments(element).map(({ label }) => label)).toEqual(['other']);
  });

  it("drops the last log's bar when the log changes", async () => {
    logOf([namespaceEvent('pkg', 40)], ['pkg']);
    const element = await mount();
    const next = log([namespaceEvent('other', 10)], ['other']);
    indexTree(next);
    const nextStore = logStoreFor(next);
    // Held, so the new log's sum cannot land before the assertion.
    jest.spyOn(nextStore, 'logIndex').mockReturnValue(new Promise(() => {}));

    element.logStore = nextStore;
    await element.updateComplete;
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(bar(element)).toBeNull();
    expect(element.shadowRoot?.querySelector('section-skeleton')).not.toBeNull();
  });

  it.each([
    ['a scope with no recorded time', () => logOf([namespaceEvent('pkg', 0)], ['pkg']), {}],
    [
      'a frame the log does not hold',
      () => logOf([namespaceEvent('pkg', 100)], ['pkg']),
      { eventIndex: 99 },
    ],
    ['the lack of a log', () => {}, {}],
  ])('notes %s', async (_name, setup, props) => {
    setup();

    const element = await mount(props);

    expect(bar(element)).toBeNull();
    expect(element.shadowRoot?.querySelector('.note')?.textContent).toContain('No time');
  });
});
