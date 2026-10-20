/**
 * @jest-environment jsdom
 */
/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { FindWidget } from '../FindWidget.js';

afterEach(() => {
  document.body.replaceChildren();
});

describe('FindWidget', () => {
  it('announces the match count as a status', async () => {
    const widget = new FindWidget();
    document.body.append(widget);
    widget.totalMatches = 5;
    widget.currentMatch = 2;
    await widget.updateComplete;
    const status = widget.renderRoot.querySelector('[role="status"]');
    expect(status?.textContent).toBe('2 of 5');
  });

  describe('a view reporting results', () => {
    const results = (detail: { totalMatches: number; currentMatch?: number }): void => {
      document.dispatchEvent(new CustomEvent('lv-find-results', { detail }));
    };

    async function shown(): Promise<{ widget: FindWidget; status: () => string | undefined }> {
      const widget = new FindWidget();
      document.body.append(widget);
      await widget.updateComplete;
      return {
        widget,
        status: () => widget.renderRoot.querySelector('[role="status"]')?.textContent ?? undefined,
      };
    }

    it.each([
      ['starts at the first match when the view gives no position', undefined, '1 of 5'],
      ['shows the match the view holds', 4, '4 of 5'],
      ['shows no position when the view holds none', 0, '? of 5'],
    ])('%s', async (_name, currentMatch, text) => {
      const { widget, status } = await shown();
      results({ totalMatches: 5, currentMatch });
      await widget.updateComplete;

      expect(status()).toBe(text);
    });

    it.each([
      ['next', 1],
      ['previous', 5],
    ] as const)('goes from no position to the %s end', async (way, match) => {
      const { widget } = await shown();
      results({ totalMatches: 5, currentMatch: 0 });
      const counts: number[] = [];
      const onMatch = (e: Event): void => {
        counts.push((e as CustomEvent<{ count: number }>).detail.count);
      };
      document.addEventListener('lv-find-match', onMatch);
      if (way === 'next') {
        widget._nextMatch();
      } else {
        widget._previousMatch();
      }
      document.removeEventListener('lv-find-match', onMatch);

      expect(counts).toEqual([match]);
    });
  });
});
