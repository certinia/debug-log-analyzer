/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */

import type { LogEvent } from 'apex-log-parser';
import { getCallerNamespace } from '../CallerNamespace.js';

type Stub = { parent: Stub | null; namespace: string };

const make = (namespace: string, parent: Stub | null = null): LogEvent =>
  ({ parent, namespace }) as unknown as LogEvent;

describe('getCallerNamespace', () => {
  it('returns default when the event has no parent', () => {
    const dml = make('default');
    expect(getCallerNamespace(dml)).toBe('default');
  });

  it("returns the direct parent's namespace", () => {
    const pkg2Wrapper = make('pkg2');
    const pkg1Trigger = make('pkg1', pkg2Wrapper);
    const dml = make('default', pkg1Trigger);

    expect(getCallerNamespace(dml)).toBe('pkg1');
  });

  it("returns 'default' when the direct parent's namespace is 'default'", () => {
    const pkg1Code = make('pkg1');
    const platformFrame = make('default', pkg1Code);
    const dml = make('default', platformFrame);

    expect(getCallerNamespace(dml)).toBe('default');
  });

  it("returns 'default' when the direct parent's namespace is empty", () => {
    const emptyFrame = make('');
    const dml = make('default', emptyFrame);

    expect(getCallerNamespace(dml)).toBe('default');
  });

  it('memoizes the result per event', () => {
    const pkg1 = make('pkg1');
    const dml = make('default', pkg1);

    expect(getCallerNamespace(dml)).toBe('pkg1');
    pkg1.namespace = 'mutated';
    expect(getCallerNamespace(dml)).toBe('pkg1');
  });
});
