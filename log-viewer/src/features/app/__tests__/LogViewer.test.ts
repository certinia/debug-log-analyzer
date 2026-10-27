/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';

import { eventBus } from '#core/events/EventBus.js';
import { settle } from '#test-helpers/visibility.js';

let answerFetch: (data: { logData: string }) => void = () => {};

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
  let emitted: unknown[];
  let unsubscribe: () => void;

  beforeEach(() => {
    emitted = [];
    unsubscribe = eventBus.on('timeline:navigate-to', (detail) => emitted.push(detail));
    viewer = document.createElement('log-viewer') as typeof viewer;
    document.body.append(viewer);
  });

  afterEach(() => {
    unsubscribe();
    viewer.remove();
  });

  const timelineTarget = () =>
    (viewer.shadowRoot?.querySelector('timeline-view') as { navigateToEventIndex?: number } | null)
      ?.navigateToEventIndex;

  // The timeline subscribes to the bus only once it is built, so an id sent on the bus mid-parse is lost.
  it('hands the timeline an event sent while the log still parses', async () => {
    sendNavigate(2);
    answerFetch({ logData: LOG });
    await settle();
    await viewer.updateComplete;

    expect(timelineTarget()).toBe(2);
  });

  it('sends an event to the built timeline on the bus', async () => {
    answerFetch({ logData: LOG });
    await settle();
    await viewer.updateComplete;

    sendNavigate(2);

    // A viewer never drops its window listener, so an earlier test's viewer hears this too.
    expect(emitted).toContainEqual({ eventIndex: 2 });
    expect(timelineTarget()).toBeUndefined();
  });
});
