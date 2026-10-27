/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { settle } from '#test-helpers/visibility.js';

let answerFetch: (data: { logData: string; navigateToEventIndex?: number }) => void = () => {};

jest.mock('#core/messaging/VSCodeExtensionMessenger.js', () => {
  const actual = jest.requireActual<typeof import('#core/messaging/VSCodeExtensionMessenger.js')>(
    '#core/messaging/VSCodeExtensionMessenger.js',
  );
  return {
    ...actual,
    vscodeMessenger: {
      request: () => new Promise((resolve) => (answerFetch = resolve)),
      send: () => {},
    },
  };
});
jest.mock('../AppHeader.js', () => ({}));
jest.mock('../../../components/LogInspector.js', () => ({}));

import '../LogViewer.js';

const LOG = [
  '09:00:00.0 (100)|EXECUTION_STARTED',
  '09:00:00.0 (200)|METHOD_ENTRY|[1]|01p|A.a()',
  '09:00:00.0 (300)|METHOD_EXIT|[1]|01p|A.a()',
  '09:00:00.0 (400)|EXECUTION_FINISHED',
].join('\n');

const sendNavigate = (eventIndex: number) =>
  window.dispatchEvent(
    new MessageEvent('message', { data: { cmd: 'navigateToTimeline', payload: { eventIndex } } }),
  );

describe('log-viewer navigateToTimeline', () => {
  let viewer: HTMLElement & { updateComplete: Promise<unknown> };

  beforeEach(() => {
    viewer = document.createElement('log-viewer') as typeof viewer;
    document.body.append(viewer);
  });

  afterEach(() => {
    viewer.remove();
  });

  const timelineRequest = () =>
    (viewer.shadowRoot?.querySelector('timeline-view') as { navigateRequest?: unknown } | null)
      ?.navigateRequest;

  const load = async (navigateToEventIndex?: number) => {
    answerFetch({ logData: LOG, navigateToEventIndex });
    await settle();
    await viewer.updateComplete;
  };

  // The timeline is not built during the parse, so an id sent then on the bus was lost.
  it('hands the timeline an event sent while the log still parses', async () => {
    sendNavigate(2);
    await load();

    expect(timelineRequest()).toEqual({ eventIndex: 2 });
  });

  it('keeps an event sent during the parse over the one the fetch carried', async () => {
    sendNavigate(2);
    await load(1);

    expect(timelineRequest()).toEqual({ eventIndex: 2 });
  });

  // The same id twice must still move the chart, so each request is a new object.
  it('hands the timeline a new request for each event sent after the load', async () => {
    await load(1);
    const first = timelineRequest();

    sendNavigate(1);
    await viewer.updateComplete;

    expect(timelineRequest()).toEqual({ eventIndex: 1 });
    expect(timelineRequest()).not.toBe(first);
  });
});
