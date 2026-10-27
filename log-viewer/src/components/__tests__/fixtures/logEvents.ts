/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog } from '@apexdevtools/apex-log-parser';

import { type FrameSpec, frameLines, rawStoreOf } from '#test-helpers/apexLog.js';
import type { LogStore } from '../../../core/log/LogStore.js';

/** A code unit whose own time is `self`; {@link log} sets its `eventIndex`. */
export interface FakeEvent extends FrameSpec {
  eventIndex: number;
  children: FakeEvent[];
}

/** A code unit in `namespace`, which the parser reads from its `apex://` name. */
export function namespaceEvent(
  namespace: string,
  self: number,
  children: FakeEvent[] = [],
): FakeEvent {
  const name = namespace && namespace !== 'default' ? `${namespace}.Cls` : 'Cls';
  return { text: `apex://${name}`, type: 'CODE_UNIT_STARTED', self, children, eventIndex: -1 };
}

/** `frames` parsed back to back from 0 ns, each frame given the id the parser gave it. */
export async function log(frames: FakeEvent[]): Promise<{ log: ApexLog; store: LogStore }> {
  const parsed = await rawStoreOf(frameLines(frames, 0));
  let next = 1;
  const number = (frame: FakeEvent): void => {
    frame.eventIndex = next++;
    frame.children.forEach(number);
  };
  frames.forEach(number);
  return parsed;
}
