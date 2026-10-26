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
    widget._sentTerm = 'Handler';
    results(detail);
    await widget.updateComplete;

    expect(shownText()).toBe(text);
    expect(spoken()).toBe(spokenText);
  });

  it('names a new term it found nothing for, when the count stays at none', async () => {
    const { widget, spoken } = await shown();
    widget._sentTerm = 'foo';
    results({ totalMatches: 0, currentMatch: 0 });
    await widget.updateComplete;
    widget._sentTerm = 'bar';
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
      widget._sentTerm = term;
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

  type Sent = { text: string; count: number; direction?: string; matchCase?: boolean };

  // Records each `type` event the widget sends, as long as `signal` is live.
  function sent(type: 'lv-find' | 'lv-find-match' | 'lv-find-close', signal: AbortSignal): Sent[] {
    const seen: Sent[] = [];
    document.addEventListener(
      type,
      (e) => {
        const { text, count, direction, options } = (
          e as CustomEvent<Sent & { options: { matchCase: boolean } }>
        ).detail;
        seen.push({
          text,
          count,
          ...(direction ? { direction } : {}),
          ...(options.matchCase ? { matchCase: true } : {}),
        });
      },
      { signal },
    );
    return seen;
  }

  let listening: AbortController;

  beforeEach(() => {
    listening = new AbortController();
  });

  afterEach(() => {
    listening.abort();
  });

  it.each([
    ['searches its text again without moving, when open', true, [{ text: 'foo', count: 0 }]],
    ['does nothing when closed', false, []],
  ])('on a refresh, %s', async (_name, open, searches) => {
    const { widget } = await shown();
    widget.isVisble = open;
    Object.assign(widget.inputbox ?? {}, { value: 'foo' });
    const seen = sent('lv-find', listening.signal);
    document.dispatchEvent(new CustomEvent('lv-find-refresh', { detail: null }));

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

  // jsdom focuses only an element with a tabindex; a browser focuses the textfield's input.
  async function focused() {
    const view = await shown();
    const box = view.widget.inputbox;
    Object.assign(box ?? {}, { tabIndex: 0 });
    box?.focus();
    const type = (value: string): void => {
      Object.assign(box ?? {}, { value });
      box?.dispatchEvent(new Event('input'));
    };
    const press = (init: KeyboardEventInit = {}): void =>
      void window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ...init }));
    const click = (name: string): void =>
      void view.widget.renderRoot
        .querySelector(`[title="${name}"]`)
        ?.dispatchEvent(new MouseEvent('click'));
    return { ...view, type, press, click };
  }

  describe('as you type', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('searches once the typing pauses, and moves to the match nearest the screen', async () => {
      const { type } = await focused();
      const searches = sent('lv-find', listening.signal);
      type('f');
      jest.advanceTimersByTime(100);
      type('fo');
      jest.advanceTimersByTime(149);
      expect(searches).toEqual([]);

      jest.advanceTimersByTime(1);
      expect(searches).toEqual([{ text: 'fo', count: 0, direction: 'next' }]);
    });

    it('searches nothing after a pause when the text is back to what it searched', async () => {
      const { type } = await focused();
      const searches = sent('lv-find', listening.signal);
      type('fo');
      jest.advanceTimersByTime(150);
      type('f');
      type('fo');
      jest.advanceTimersByTime(150);

      expect(searches).toHaveLength(1);
    });

    it.each([
      ['Enter, the nearest next', {}, 'next'],
      ['Shift+Enter, the nearest previous', { shiftKey: true }, 'prev'],
    ])('runs a waiting search at once on %s', async (_name, init, direction) => {
      const { type, press } = await focused();
      const searches = sent('lv-find', listening.signal);
      type('fo');
      press(init);
      jest.advanceTimersByTime(150);

      expect(searches).toEqual([{ text: 'fo', count: 0, direction }]);
    });

    it('keeps the counts, and the term they are for, until the views report on a new one', async () => {
      const { widget, type, press, shownText, spoken } = await focused();
      type('foo');
      jest.advanceTimersByTime(150);
      results({ totalMatches: 10, currentMatch: 3 });
      type('foob');
      jest.advanceTimersByTime(150);
      type('fooba');
      press();
      await widget.updateComplete;

      expect([shownText(), spoken()]).toEqual(['3 of 10', "3 of 10 found for 'foo'"]);
      results({ totalMatches: 0, currentMatch: 0 });
      await widget.updateComplete;
      expect(spoken()).toBe("No results found for 'fooba'");
    });

    it('searches new text at once on an arrow, and moves that way', async () => {
      const { type, click } = await focused();
      type('foo');
      jest.advanceTimersByTime(150);
      results({ totalMatches: 5, currentMatch: 1 });
      const searches = sent('lv-find', listening.signal);
      const steps = sent('lv-find-match', listening.signal);
      type('foob');
      click('Previous Match');
      jest.advanceTimersByTime(150);

      expect(searches).toEqual([{ text: 'foob', count: 0, direction: 'prev' }]);
      expect(steps).toEqual([]);
    });
  });

  it.each([
    ['Next from the last wraps to the first', 'Next Match', 3, 1],
    ['Previous from the first wraps to the last', 'Previous Match', 1, 3],
    ['Next moves on one', 'Next Match', 1, 2],
  ])('%s', async (_name, button, from, to) => {
    const { widget, click } = await focused();
    Object.assign(widget.inputbox ?? {}, { value: 'foo' });
    widget._sentTerm = 'foo';
    results({ totalMatches: 3, currentMatch: from });
    const steps = sent('lv-find-match', listening.signal);
    click(button);

    expect(steps.map((step) => step.count)).toEqual([to]);
  });

  it('steps forward on Enter after the Previous button, as Enter always does', async () => {
    const { press, click, type } = await focused();
    type('foo');
    press();
    results({ totalMatches: 3, currentMatch: 2 });
    const steps = sent('lv-find-match', listening.signal);
    click('Previous Match');
    press();

    expect(steps.map((step) => step.count)).toEqual([1, 2]);
  });

  it('closes on Escape, and drops the term its counts were for', async () => {
    const { widget, press, spoken } = await focused();
    widget.isVisble = true;
    widget._sentTerm = 'foo';
    results({ totalMatches: 0, currentMatch: 0 });
    const closes = sent('lv-find-close', listening.signal);
    press({ key: 'Escape' });
    await widget.updateComplete;

    expect(closes).toHaveLength(1);
    expect(widget.isVisble).toBe(false);
    expect(widget.renderRoot.querySelector('.no-results')).toBeNull();
    expect(spoken()).toBe('No results found');
  });

  it('sends nothing on Ctrl+F when it is already open', async () => {
    const { widget } = await focused();
    widget.isVisble = true;
    const searches = sent('lv-find', listening.signal);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }));

    expect(searches).toEqual([]);
  });

  it.each([
    ['Enter asks for the next', {}, 'next'],
    ['Shift+Enter asks for the previous', { shiftKey: true }, 'prev'],
  ])('from no position, %s match nearest the screen', async (_name, init, direction) => {
    const { press } = await focused();
    press();
    results({ totalMatches: 5, currentMatch: 0 });
    const steps = sent('lv-find-match', listening.signal);
    press(init);

    expect(steps).toEqual([{ text: '', count: 0, direction }]);
  });

  it.each([
    ['Ctrl+F searches without moving', 'ctrl+f', { text: '', count: 0 }],
    [
      'Match Case moves to the match nearest the screen',
      'Match Case',
      { text: '', count: 0, direction: 'next', matchCase: true },
    ],
  ])('%s', async (_name, action, search) => {
    const { click } = await focused();
    const searches = sent('lv-find', listening.signal);
    if (action === 'ctrl+f') {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }));
    } else {
      click(action);
    }

    expect(searches).toEqual([search]);
  });
});
