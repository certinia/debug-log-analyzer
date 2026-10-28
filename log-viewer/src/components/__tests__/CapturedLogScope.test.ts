/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { describe, expect, it } from '@jest/globals';
import { ContextEvent, ContextProvider } from '@lit/context';

import { logContext } from '#core/log/logContext.js';
import type { LogStore } from '#core/log/LogStore.js';
import type { CapturedLogScope } from '../CapturedLogScope.js';
import '../CapturedLogScope.js';

const captured = { id: 'captured' } as unknown as LogStore;
const shown = { id: 'shown', captured } as unknown as LogStore;

/** A child of the scope, under a provider of `outer`, and every store the child is given. */
async function scoped(outer: LogStore) {
  const root = document.createElement('div');
  const provider = new ContextProvider(root, { context: logContext, initialValue: outer });
  const scope = document.createElement('captured-log-scope') as CapturedLogScope;
  const child = document.createElement('span');
  scope.append(child);
  root.append(scope);
  document.body.replaceChildren(root);
  await scope.updateComplete;

  const given: (LogStore | undefined)[] = [];
  child.dispatchEvent(
    new ContextEvent(
      logContext,
      child,
      (value) => {
        given.push(value ?? undefined);
      },
      true,
    ),
  );
  return { provider, scope, given };
}

describe('captured-log-scope', () => {
  it('gives its children the log as captured, not the one the levels filter', async () => {
    const { given } = await scoped(shown);

    expect(given).toEqual([captured]);
  });

  it('follows a new log, and not a new filter of the same one', async () => {
    const { provider, scope, given } = await scoped(shown);
    const refiltered = { id: 'refiltered', captured } as unknown as LogStore;
    const next = { id: 'next' } as unknown as LogStore;
    const nextShown = { id: 'nextShown', captured: next } as unknown as LogStore;

    provider.setValue(refiltered);
    await scope.updateComplete;
    provider.setValue(nextShown);
    await scope.updateComplete;

    expect(given).toEqual([captured, next]);
  });
});
