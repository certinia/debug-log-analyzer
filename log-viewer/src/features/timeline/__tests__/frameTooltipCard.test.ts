/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { describe, expect, it } from '@jest/globals';
import type { ApexLog, LogEvent } from 'apex-log-parser';

import { EVENT_METRICS, HEAP_PEAK } from '../../../core/metrics/eventMetrics.js';

import {
  frameCard,
  markerCard,
  MAX_METRIC_ROWS,
  type CardRow,
  type TooltipCard,
} from '../optimised/frameTooltipCard.js';
import type { TimelineMarker } from '../types/flamechart.types.js';

/**
 * The log every branch is measured against. Ten times the fixture frame throughout, so
 * the fixture's readings come out at a tenth and a branch holding all of something
 * reads as the whole log.
 */
const logTotals = {
  duration: { total: 10_000_000, self: 0 },
  soqlCount: { total: 30, self: 0 },
  soqlRowCount: { total: 5_000, self: 0 },
  dmlCount: { total: 10, self: 0 },
  dmlRowCount: { total: 1_000, self: 0 },
  soslCount: { total: 10, self: 0 },
  soslRowCount: { total: 100, self: 0 },
  thrownCount: { total: 20, self: 0 },
  heapAllocated: { total: 10_000, self: 0 },
  heapGross: { total: 20_000, self: 0 },
  heapPeak: 6_000_000,
};

const apexLog = { startTime: null, timestamp: 0, ...logTotals } as unknown as ApexLog;

/** 10:29:24.600 at the first event, so a 1ms frame ends a millisecond later. */
const withStart = { startTime: 37_764_600, timestamp: 0, ...logTotals } as unknown as ApexLog;

function event(over: Record<string, unknown> = {}): LogEvent {
  return {
    isParent: true,
    type: 'METHOD_ENTRY',
    category: 'Apex',
    text: 'MyClass.myMethod()',
    namespace: '',
    lineNumber: null,
    timestamp: 0,
    exitStamp: 1_000_000,
    duration: { total: 1_000_000, self: 400_000 },
    soqlCount: { total: 0, self: 0 },
    soqlRowCount: { total: 0, self: 0 },
    dmlCount: { total: 0, self: 0 },
    dmlRowCount: { total: 0, self: 0 },
    soslCount: { total: 0, self: 0 },
    soslRowCount: { total: 0, self: 0 },
    thrownCount: { total: 0, self: 0 },
    heapAllocated: { total: 0, self: 0 },
    heapGross: { total: 0, self: 0 },
    heapPeak: 0,
    ...over,
  } as unknown as LogEvent;
}

function card(over: Record<string, unknown> = {}): TooltipCard {
  return frameCard(event(over), '#88ae58', apexLog);
}

/** The row with this label, wherever it sits. */
function row(built: TooltipCard, label: string): CardRow | undefined {
  return built.groups.flat().find((candidate) => candidate.label === label);
}

/** The labels of the metric group — the one the cap applies to. */
function metricLabels(built: TooltipCard): string[] {
  return (built.groups.at(1) ?? []).map((line) => line.label);
}

/** Every metric non-zero, so the cap has to choose. */
const crowded = {
  soqlCount: { total: 1, self: 1 },
  soqlRowCount: { total: 4_000, self: 4_000 },
  dmlCount: { total: 1, self: 1 },
  dmlRowCount: { total: 800, self: 800 },
  soslCount: { total: 1, self: 1 },
  soslRowCount: { total: 80, self: 80 },
  thrownCount: { total: 2, self: 0 },
  heapAllocated: { total: 100, self: 100 },
  heapGross: { total: 200, self: 200 },
  heapPeak: 5_000_000,
};

describe('frameCard', () => {
  /** No log figure: the chart already shows the log's span, and the counts do not. */
  it("leads with the duration and the frame's own share of it", () => {
    expect(row(card(), 'Time')).toEqual({
      label: 'Time',
      value: '1 ms',
      self: '0.4 ms',
      // Unranked: the timing row is its own group, so the cap never weighs it.
      share: null,
      // The card's emphasis follows the row, not its position: a frame with no duration
      // would otherwise put it on the wall clock.
      lead: true,
    });
  });

  /**
   * In the label, not a figure column: the columns are a fixed width and the word ran
   * into the reading beside it. Common on database frames, so it has to fit.
   */
  it('names free time in the label', () => {
    expect(row(card({ cpuType: 'free' }), 'Time · free')?.value).toBe('1 ms');
  });

  it('has no timing row for a frame that never exited', () => {
    expect(row(card({ exitStamp: undefined }), 'Time')).toBeUndefined();
  });

  /** The line is the call site in the containing code, so it reads as where the call
   *  came from rather than as where the frame is defined. */
  it('names the category, type, namespace and call site on one identity line', () => {
    expect(card({ namespace: 'acme', lineNumber: 42 }).identity).toEqual([
      'Apex',
      'METHOD_ENTRY',
      'acme',
      'from line 42',
    ]);
  });

  it('keeps a line number the parser could not resolve as it found it', () => {
    expect(card({ lineNumber: 'EXTERNAL' }).identity).toContain('EXTERNAL');
  });

  it('paints the rail in the category colour', () => {
    expect(card().rail).toBe('#88ae58');
  });

  /**
   * The branch's share of the log, never of a governor limit: the reading states no
   * denominator at all, so the meter cannot be read as governor pressure.
   */
  it("reads a metric against the log's own figure", () => {
    expect(row(card({ soqlCount: { total: 3, self: 1 } }), 'SOQL')).toEqual({
      label: 'SOQL',
      value: '3 of 30',
      self: '1',
      share: 0.1,
    });
  });

  it('states the count alone where there is no log to read it against', () => {
    const built = frameCard(event({ soqlCount: { total: 3, self: 1 } }), '', null);

    expect(row(built, 'SOQL')?.value).toBe('3');
    expect(row(built, 'SOQL')?.share).toBeNull();
  });

  /**
   * The unit follows the value, so a pair would read "100 bytes of 6 MB" — the same
   * mismatch that keeps the log's span off the timing row.
   */
  it('states a byte reading alone, with no log figure beside it', () => {
    const heap = row(card({ heapAllocated: { total: 1_000, self: 500 } }), 'Heap net');

    expect(heap?.value).toBe('1 KB');
    expect(heap?.self).toBe('500 bytes');
    // Still ranked, so the cap weighs it against the counts.
    expect(heap?.share).toBe(0.1);
  });

  it('reads the heap peak alone: a max is no share of a total', () => {
    const peak = row(card({ heapPeak: 3_000_000 }), 'Heap peak');

    expect(peak?.value).toBe('3 MB');
    expect(peak?.share).toBeNull();
  });

  // A share of a signed net says nothing, so the log's figure is left off.
  it('states a negative net heap alone', () => {
    const heap = row(card({ heapAllocated: { total: -500, self: -500 } }), 'Heap net');

    expect(heap?.value).toBe('-500 bytes');
    expect(heap?.share).toBeNull();
  });

  /**
   * A zero self reading is the answer, not noise: it says the statements ran in a
   * descendant rather than in this frame.
   */
  it('keeps a self reading of zero', () => {
    expect(row(card({ dmlRowCount: { total: 100, self: 0 } }), 'DML Rows')?.self).toBe('0');
  });

  // Throws only ever record on the leaf, so a self reading would say nothing.
  it('gives throws no self reading', () => {
    expect(row(card({ thrownCount: { total: 2, self: 0 } }), 'Throws')?.self).toBeNull();
  });

  it('gives the wall clock the self column, having no figure to line up', () => {
    const built = frameCard(event(), '', withStart);

    expect(row(built, 'Wall clock')).toEqual({
      label: 'Wall clock',
      value: '10:29:24.600 → 10:29:24.601',
      self: null,
      share: null,
      wide: true,
    });
  });

  // Reference data, not what the hover asked, so it reads after the metrics.
  it('reads the clock after the metrics', () => {
    const built = frameCard(event({ soqlCount: { total: 3, self: 1 } }), '', withStart);

    expect(built.groups.map((group) => group.map((line) => line.label))).toEqual([
      ['Time'],
      ['SOQL'],
      ['Wall clock'],
    ]);
  });

  it('has no wall-clock row where the log records no start time', () => {
    expect(row(card(), 'Wall clock')).toBeUndefined();
  });

  describe('the row cap', () => {
    it('keeps every metric while they fit', () => {
      expect(card({ soqlCount: { total: 3, self: 1 } }).hidden).toBe(0);
    });

    it('drops the least answerable past the cap, and counts what it dropped', () => {
      const built = card(crowded);

      // The timing group is never capped; the metric group is.
      expect(built.groups.at(1)).toHaveLength(MAX_METRIC_ROWS);
      expect(built.hidden).toBe(4);
    });

    // A throw is rare and never incidental, so it outranks any share.
    it('never drops a throw', () => {
      expect(metricLabels(card(crowded))).toContain('Throws');
    });

    it('keeps the metrics this branch holds most of', () => {
      expect(metricLabels(card(crowded))).toContain('SOQL Rows');
    });

    /**
     * The share decides what survives; declaration order decides where it sits.
     * Without that a row would overtake another as the pointer moved between frames.
     */
    it('renders the survivors in declaration order, whatever their share', () => {
      const kept = metricLabels(card(crowded));

      expect(kept).toEqual([...kept].sort(byDeclaration));
    });
  });
});

const ORDER = [...EVENT_METRICS.map((metric) => metric.label), HEAP_PEAK.label];
const byDeclaration = (a: string, b: string) => ORDER.indexOf(a) - ORDER.indexOf(b);

describe('markerCard', () => {
  function marker(over: Partial<TimelineMarker> = {}): TimelineMarker {
    return {
      id: 'm1',
      type: 'exception',
      summary: 'System.NullPointerException',
      startTime: 1_000_000,
      ...over,
    } as TimelineMarker;
  }

  it('leads with the summary and takes the rail colour it is given', () => {
    const built = markerCard(marker(), '#e5484d');

    expect(built.title).toBe('System.NullPointerException');
    expect(built.rail).toBe('#e5484d');
  });

  it('reports how long a marker spans, where it spans anything', () => {
    expect(markerCard(marker({ endTime: 3_000_000 }), '#e5484d').groups).toEqual([
      [{ label: 'Spans', value: '2 ms', self: null, share: null, lead: true }],
    ]);
  });

  it('has no span row for a marker at a point in time', () => {
    expect(markerCard(marker(), '#e5484d').groups).toEqual([]);
  });
});
