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
  const results = (detail: { totalMatches: number; currentMatch: number }): void => {
    document.dispatchEvent(new CustomEvent('lv-find-results', { detail }));
  };

  async function shown() {
    const widget = new FindWidget();
    document.body.append(widget);
    await widget.updateComplete;
    const root = widget.renderRoot;
    return {
      widget,
      shownText: () => root.querySelector('.matches-count [aria-hidden]')?.textContent,
      spoken: () => root.querySelector('[role="status"]')?.textContent,
    };
  }

  it.each([
    [
      'shows the match the view holds',
      { totalMatches: 5, currentMatch: 4 },
      '4 of 5',
      "4 of 5 found for 'Handler'",
    ],
    [
      'shows no position when the view holds none',
      { totalMatches: 5, currentMatch: 0 },
      '? of 5',
      "5 matches found for 'Handler'",
    ],
    [
      'shows no matches',
      { totalMatches: 0, currentMatch: 0 },
      'No results',
      "No results found for 'Handler'",
    ],
  ])('%s', async (_name, detail, text, spokenText) => {
    const { widget, shownText, spoken } = await shown();
    widget.lastMatch = 'Handler';
    results(detail);
    await widget.updateComplete;

    expect(shownText()).toBe(text);
    expect(spoken()).toBe(spokenText);
  });

  it('names a new term it found nothing for, when the count stays at none', async () => {
    const { widget, spoken } = await shown();
    widget.lastMatch = 'foo';
    results({ totalMatches: 0, currentMatch: 0 });
    await widget.updateComplete;
    widget.lastMatch = 'bar';
    results({ totalMatches: 0, currentMatch: 0 });
    await widget.updateComplete;

    expect(spoken()).toBe("No results found for 'bar'");
  });

  it.each([
    ['an empty box', null, 0, false, true],
    ['a term with no match', 'foo', 0, true, true],
    ['a term with matches', 'foo', 3, false, false],
  ])(
    'with %s, marks no results and disables the steps as VS Code does',
    async (_name, term, total, red, disabled) => {
      const { widget } = await shown();
      widget.lastMatch = term;
      results({ totalMatches: total, currentMatch: 0 });
      await widget.updateComplete;
      const root = widget.renderRoot;
      const steps = [...root.querySelectorAll('.find-button')].slice(0, 2);

      expect(root.querySelector('.wrapper')?.classList.contains('no-results')).toBe(red);
      expect(steps.map((step) => step.classList.contains('disabled'))).toEqual([
        disabled,
        disabled,
      ]);
    },
  );

  it.each([
    ['searches its text again without moving, when open', true, [{ text: 'foo', count: 0 }]],
    ['does nothing when closed', false, []],
  ])('on a refresh, %s', async (_name, open, searches) => {
    const { widget } = await shown();
    widget.isVisble = open;
    Object.assign(widget.inputbox ?? {}, { value: 'foo' });
    const seen: { text: string; count: number }[] = [];
    const onFind = (e: Event): void => {
      const { text, count } = (e as CustomEvent<{ text: string; count: number }>).detail;
      seen.push({ text, count });
    };
    document.addEventListener('lv-find', onFind);
    document.dispatchEvent(new CustomEvent('lv-find-refresh', { detail: null }));
    document.removeEventListener('lv-find', onFind);

    expect(seen).toEqual(searches);
  });

  it('keeps its count on a refresh until the view reports', async () => {
    const { widget, shownText } = await shown();
    widget.isVisble = true;
    Object.assign(widget.inputbox ?? {}, { value: 'foo' });
    results({ totalMatches: 5, currentMatch: 2 });
    document.dispatchEvent(new CustomEvent('lv-find-refresh', { detail: null }));
    await widget.updateComplete;

    expect(shownText()).toBe('2 of 5');
  });

  it.each([
    ['closes, and asks the views to drop the search, when open', true, 1],
    ['does nothing when closed', false, 0],
  ])('on a dismiss, %s', async (_name, open, closes) => {
    const { widget } = await shown();
    widget.isVisble = open;
    const onClose = jest.fn();
    document.addEventListener('lv-find-close', onClose);
    document.dispatchEvent(new CustomEvent('lv-find-dismiss', { detail: null }));
    document.removeEventListener('lv-find-close', onClose);

    expect(onClose).toHaveBeenCalledTimes(closes);
    expect(widget.isVisble).toBe(false);
  });

  describe('as you type', () => {
    let listening: AbortController;

    beforeEach(() => {
      jest.useFakeTimers();
      listening = new AbortController();
    });

    afterEach(() => {
      listening.abort();
      jest.useRealTimers();
    });

    async function typed() {
      const { widget } = await shown();
      const box = widget.inputbox;
      Object.assign(box ?? {}, { tabIndex: 0 });
      box?.focus();
      const searches: { text: string; count: number; from?: string }[] = [];
      document.addEventListener(
        'lv-find',
        (e) => {
          const { text, count, from } = (
            e as CustomEvent<{ text: string; count: number; from?: string }>
          ).detail;
          searches.push(from ? { text, count, from } : { text, count });
        },
        { signal: listening.signal },
      );
      const type = (value: string): void => {
        Object.assign(box ?? {}, { value });
        box?.dispatchEvent(new Event('input'));
      };
      return { searches, type };
    }

    it('searches once the typing pauses, without moving', async () => {
      const { searches, type } = await typed();
      type('f');
      jest.advanceTimersByTime(100);
      type('fo');
      jest.advanceTimersByTime(149);
      expect(searches).toEqual([]);

      jest.advanceTimersByTime(1);
      expect(searches).toEqual([{ text: 'fo', count: 0 }]);
    });

    it('runs a waiting search at once on Enter, and moves to the match nearest the screen', async () => {
      const { searches, type } = await typed();
      type('fo');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
      jest.advanceTimersByTime(150);

      expect(searches).toEqual([{ text: 'fo', count: 0, from: 'next' }]);
    });
  });

  it.each([
    ['Enter asks for the next', false, 'next'],
    ['Shift+Enter asks for the previous', true, 'prev'],
  ])('from no position, %s match nearest the screen', async (_name, shiftKey, from) => {
    const { widget } = await shown();
    const box = widget.inputbox;
    // jsdom focuses only an element with a tabindex; a browser focuses the textfield's input.
    Object.assign(box ?? {}, { tabIndex: 0 });
    box?.focus();
    const press = (init: KeyboardEventInit = {}): void =>
      void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ...init }));
    press();
    results({ totalMatches: 5, currentMatch: 0 });
    const steps: { count: number; from?: string }[] = [];
    const onMatch = (e: Event): void => {
      const { count, from } = (e as CustomEvent<{ count: number; from?: string }>).detail;
      steps.push({ count, from });
    };
    document.addEventListener('lv-find-match', onMatch);
    press({ shiftKey });
    document.removeEventListener('lv-find-match', onMatch);

    expect(steps).toEqual([{ count: 0, from }]);
  });
});
