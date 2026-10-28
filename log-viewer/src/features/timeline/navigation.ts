/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

/** Document event asking the app to show a log event on the Timeline tab. */
export const TIMELINE_GO_TO_EVENT = 'timeline-go-to-event';

/** A request to move the timeline to an event. */
export interface TimelineNavigateRequest {
  readonly eventId: number;
}

/** {@link TIMELINE_GO_TO_EVENT} keyed by name, for a listener that wants its payload. */
export interface TimelineNavigationEventMap {
  [TIMELINE_GO_TO_EVENT]: CustomEvent<TimelineNavigateRequest>;
}

/**
 * Show a log event on the Timeline tab: switches to the tab and moves the chart to the
 * event, once the chart is built if it is not yet. Lives apart from the timeline so
 * callers don't pull in the chart module.
 */
export function goToTimelineEvent(target: TimelineNavigateRequest): void {
  document.dispatchEvent(new CustomEvent(TIMELINE_GO_TO_EVENT, { detail: target }));
}
