/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 *
 * @jest-environment jsdom
 */
import { beforeEach, describe, expect, it } from '@jest/globals';

// The swc transform can't parse `.scss`/`.css`; stub the stylesheet assets.
jest.mock('../../tabulator/style/DataGrid.scss', () => ({ default: '' }));
jest.mock('../../tabulator/format/Progress.css', () => ({}));
// The tabulator ESM build (+ its module registrations) doesn't load under jest;
// the mocked walk returns null so no table is ever built here.
jest.mock('tabulator-tables', () => ({
  Tabulator: class {
    static registerModule() {}
  },
  Module: class {},
  Renderer: class {},
}));
// vscode-button needs ElementInternals.setFormValue (absent in jsdom).
jest.mock('#vscode-elements/vscode-button.js', () => ({}));

// The walk is what this suite times, so it's stubbed; null keeps the build from
// reaching Tabulator.
jest.mock('../scopedCallTree.js', () => ({ buildScopedCallTree: jest.fn(() => null) }));

import type { CallTreeDetail } from '../CallTreeDetail.js';
import '../CallTreeDetail.js';
import { buildScopedCallTree } from '../scopedCallTree.js';

const build = jest.mocked(buildScopedCallTree);

/** Lets the rAF the build waits behind fire, then settles the render. */
async function frame(el: CallTreeDetail): Promise<void> {
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await el.updateComplete;
}

async function mount(eventIndex: number): Promise<CallTreeDetail> {
  const el = document.createElement('call-tree-detail') as CallTreeDetail;
  el.eventIndex = eventIndex;
  document.body.appendChild(el);
  await el.updateComplete;
  return el;
}

describe('CallTreeDetail scoped build', () => {
  beforeEach(() => {
    build.mockClear();
    document.body.replaceChildren();
  });

  it('defers the walk past the paint yield', async () => {
    const el = await mount(5);

    // The selection has been applied and rendered; the walk has not run yet.
    expect(build).not.toHaveBeenCalled();

    await frame(el);
    expect(build.mock.calls).toEqual([[5, null]]);
  });

  it('walks only the latest scope when selections arrive back to back', async () => {
    const el = await mount(5);
    el.eventIndex = 6;
    await el.updateComplete;

    // Both switches are still behind the same yield; the epoch guard drops the
    // superseded one before it can pay for a walk nobody is waiting on.
    await frame(el);
    expect(build.mock.calls).toEqual([[6, null]]);
  });
});
