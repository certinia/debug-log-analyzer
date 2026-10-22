import '#vscode-elements/vscode-textfield.js';
import '#vscode-elements/vscode-toolbar-button.js';
import type { VscodeTextfield } from '#vscode-elements/vscode-textfield.js';
import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import { DelayController } from '../../../core/events/DelayController.js';
import { DomListenerController } from '../../../core/events/DomListenerController.js';
import type { FindEventMap, FindResultsEventDetail } from '../findEvents.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';

// web components
import '../../../components/VsIconCheckbox.js';

const LIVE_FIND_MS = 150;

@customElement('find-widget')
export class FindWidget extends LitElement {
  @state() totalMatches = 0;
  @state() currentMatch = 1;
  @state() isVisble = false;
  @state() matchCase = false;

  @state() lastMatch: string | null = null;
  nextMatchDirection = true; // Remembers last direction: true=next, false=previous

  private readonly _findBus = new DomListenerController<FindEventMap>(this, document, {
    'lv-find-results': (e) => this._updateCounts(e),
    'lv-find-refresh': () => this._refresh(),
    'lv-find-dismiss': () => this.isVisble && this._closeFind(),
  });

  private readonly _keyBus = new DomListenerController<WindowEventMap>(this, window, {
    keydown: (e) => this._keyPress(e),
  });

  private readonly _live = new DelayController(this, LIVE_FIND_MS);

  static styles = [
    globalStyles,
    css`
      :host {
        font-size: var(--lana-text-base);
      }

      .wrapper {
        position: absolute;
        top: 0;
        right: 28px;
        max-width: 420px;
        color: var(--vscode-editorWidget-foreground);
        background: var(--lana-popover-bg);
        z-index: 1;
        display: flex;
        border: var(--lana-stroke) solid var(--lana-surface-border);
        border-radius: var(--lana-radius-lg);
        box-sizing: border-box;
        margin-top: var(--lana-space-2xs);
        align-items: center;
        overflow: hidden;
        padding: var(--lana-space-2xs) var(--lana-space-2xs) var(--lana-space-2xs)
          var(--lana-space-sm);
        transform: translateY(calc(-100% - var(--lana-space-sm)));
        transition: transform 0.2s linear;
      }

      .visible {
        transform: translateY(0);
        box-shadow: var(--lana-shadow-popover);
      }

      @media (prefers-reduced-motion: reduce) {
        .wrapper {
          transition: none;
        }
      }

      .find-input__controls {
        display: flex;
        align-items: center;
      }

      .find-input-box {
        width: 197px;
        vertical-align: middle;
        box-sizing: border-box;
      }

      /* The field's square input paints over its rounded border's corners; a ring on top, as VS Code draws its own. */
      .find-input-box[focused] {
        border-radius: var(--lana-radius-sm);
        outline: var(--lana-focus-ring);
        outline-offset: var(--lana-focus-inset);
      }

      .find-control {
        box-sizing: border-box;
        align-items: center;
        margin-left: 3px;
        height: 20px;
        width: 20px;
      }

      .find-actions {
        display: flex;
        align-items: center;
      }

      /* VS Code's action bar greys a disabled action the same way: the icon's colour is the button's own. */
      .find-button.disabled {
        opacity: 0.4;
        pointer-events: none;
      }

      .matches-count {
        min-width: 69px;
        box-sizing: border-box;
        display: flex;
        flex: initial;
        align-items: center;
        margin: 0 0 0 3px;
        padding-left: 2px;
        text-align: center;
        vertical-align: middle;
      }

      .no-results .matches-count {
        color: var(--vscode-errorForeground);
      }
    `,
  ];

  render() {
    const cannotStep = !this.lastMatch || !this.totalMatches;
    const noResults = !!this.lastMatch && !this.totalMatches;
    return html`<div
      class="wrapper ${this.isVisble ? 'visible' : ''} ${noResults ? 'no-results' : ''}"
    >
      <vscode-textfield
        placeholder="Find"
        label="Find"
        class="find-input-box"
        @click=${this._findInputClick}
        @input=${this._onInput}
      >
        <section slot="content-after" class="find-input__controls">
          <vs-icon-checkbox
            icon="case-sensitive"
            showSelected="true"
            title="Match Case"
            class="find-control"
            @click=${this._matchCase}
          ></vs-icon-checkbox>
        </section>
      </vscode-textfield>
      <div class="matches-count">
        <span aria-hidden="true">${this._getMatchesText()}</span>
        <span class="sr-only" role="status">${this._getMatchesSpoken()}</span>
      </div>

      <div class="find-actions">
        <vscode-toolbar-button
          icon="arrow-up"
          label="Previous Match"
          title="Previous Match"
          class="find-button ${cannotStep ? 'disabled' : ''}"
          @click=${this._previousMatch}
        ></vscode-toolbar-button>
        <vscode-toolbar-button
          icon="arrow-down"
          label="Next Match"
          title="Next Match"
          class="find-button ${cannotStep ? 'disabled' : ''}"
          @click=${this._nextMatch}
        ></vscode-toolbar-button>
        <vscode-toolbar-button
          icon="close"
          label="Close"
          title="Close"
          class="find-button"
          @click=${this._closeFind}
        ></vscode-toolbar-button>
      </div>
    </div>`;
  }

  _getMatchesText() {
    if (this.totalMatches === 0) {
      return 'No results';
    }

    return (this.currentMatch || '?') + ' of ' + this.totalMatches;
  }

  // A reader says "?" as "question mark", and hears no term in "3 of 28".
  _getMatchesSpoken() {
    const text = this.lastMatch;
    if (!this.totalMatches) {
      return text ? `No results found for '${text}'` : 'No results found';
    }
    if (!this.currentMatch) {
      const matches = this.totalMatches === 1 ? 'match' : 'matches';
      return `${this.totalMatches} ${matches} found for '${text}'`;
    }
    return `${this.currentMatch} of ${this.totalMatches} found for '${text}'`;
  }

  _matchCase() {
    this._live.cancel();
    this._resetCounts();
    this.matchCase = !this.matchCase;
    this.nextMatchDirection = true; // Reset to forward direction
    this._triggerFind();
  }

  _closeFind() {
    this._live.cancel();
    this.isVisble = false;
    this._resetCounts();
    const findEvt = this._getFindEvent();
    findEvt.detail.text = '';
    document.dispatchEvent(new CustomEvent('lv-find-close', findEvt));
  }

  _findInputClick() {
    const inputBox = this.inputbox;
    if (inputBox) {
      this.isVisble = true;
      this.nextMatchDirection = true; // Reset to forward direction
      inputBox.focus();
      inputBox.wrappedElement?.select();
    }
  }

  /**
   * Navigate to previous match.
   * @param setDirection - If true, remembers this direction for Enter key. Button clicks pass true, Shift+Enter passes false.
   */
  _previousMatch(setDirection = true) {
    if (!this.totalMatches) {
      return;
    }
    if (!this.currentMatch) {
      if (setDirection) {
        this.nextMatchDirection = false;
      }
      this._stepFromView('prev');
      return;
    }
    if (this.currentMatch !== null) {
      this.currentMatch--;
      if (setDirection) {
        this.nextMatchDirection = false;
      }
      if (this.currentMatch < 1) {
        this.currentMatch = this.totalMatches;
      }

      document.dispatchEvent(new CustomEvent('lv-find-match', this._getFindEvent()));
    }
  }

  /**
   * Navigate to next match.
   * @param setDirection - If true, remembers this direction for Enter key. Button clicks pass true, Enter key passes false.
   */
  _nextMatch(setDirection = true) {
    if (!this.totalMatches) {
      return;
    }
    if (!this.currentMatch) {
      if (setDirection) {
        this.nextMatchDirection = true;
      }
      this._stepFromView('next');
      return;
    }
    if (this.currentMatch !== null) {
      this.currentMatch++;
      if (setDirection) {
        this.nextMatchDirection = true;
      }
      if (this.currentMatch > this.totalMatches) {
        this.currentMatch = 1;
      }

      document.dispatchEvent(new CustomEvent('lv-find-match', this._getFindEvent()));
    }
  }

  get inputbox() {
    return this.shadowRoot?.querySelector<VscodeTextfield>('.find-input-box');
  }

  _updateCounts(e: CustomEvent<FindResultsEventDetail>) {
    this.totalMatches = e.detail.totalMatches;
    this.currentMatch = e.detail.currentMatch;
  }

  _resetCounts() {
    this.totalMatches = 0;
    this.currentMatch = 1;
  }

  _keyPress(e: KeyboardEvent) {
    // Allow Enter to repeat for holding, block other repeated keys
    if (e.repeat && e.key !== 'Enter') {
      return;
    }

    if (e.key === 'f' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
      e.preventDefault();
      this.nextMatchDirection = true; // Reset to forward direction

      if (!this.isVisble && !this.totalMatches) {
        this._triggerFind();
      }
      this._findInputClick();
      return;
    }

    if (
      !this.shadowRoot?.activeElement ||
      !this.shadowRoot.contains(this.shadowRoot?.activeElement)
    ) {
      return;
    }

    switch (e.key) {
      case 'Escape':
        this.nextMatchDirection = true; // Reset to forward direction
        this._closeFind();
        break;

      case 'Enter': {
        e.preventDefault(); // Prevent double-firing from input field
        this._live.cancel();
        if (this._hasMatchValueChanged() || !this.totalMatches) {
          this._triggerFind(e.shiftKey || !this.nextMatchDirection ? 'prev' : 'next');
        } else if (e.shiftKey) {
          this._previousMatch(false); // Shift+Enter → always previous, don't change remembered direction
        } else if (this.nextMatchDirection) {
          this._nextMatch(false); // Enter → next (default direction)
        } else {
          this._previousMatch(false); // Enter → previous (if Prev button was last clicked)
        }
        break;
      }

      default:
        // Any other key resets direction to forward
        this.nextMatchDirection = true;
        break;
    }
  }

  _refresh() {
    if (!this.isVisble || !this._getMatchValue()) {
      return;
    }
    const findEvt = this._getFindEvent();
    findEvt.detail.count = 0;
    document.dispatchEvent(new CustomEvent('lv-find', findEvt));
  }

  _onInput() {
    this._live.schedule(() => this._liveFind());
  }

  // A typed key searches without moving: only Enter steps.
  _liveFind() {
    if (!this._hasMatchValueChanged()) {
      return;
    }
    const findEvt = this._getFindEvent();
    findEvt.detail.count = 0;
    document.dispatchEvent(new CustomEvent('lv-find', findEvt));
  }

  // Searches without moving, or, with `from`, moves to the match nearest the screen that way.
  _triggerFind(from?: 'next' | 'prev') {
    this._resetCounts();
    const { detail } = this._getFindEvent();
    document.dispatchEvent(new CustomEvent('lv-find', { detail: { ...detail, count: 0, from } }));
  }

  // No match is current, so the views pick the one nearest the screen.
  _stepFromView(from: 'next' | 'prev') {
    const { detail } = this._getFindEvent();
    document.dispatchEvent(
      new CustomEvent('lv-find-match', { detail: { ...detail, count: 0, from } }),
    );
  }

  _getMatchValue() {
    return this.inputbox?.value ?? '';
  }

  _hasMatchValueChanged() {
    return this.lastMatch !== this._getMatchValue();
  }

  _getFindEvent() {
    this.lastMatch = this._getMatchValue();
    return {
      detail: {
        text: this._getMatchValue(),
        count: this.currentMatch,
        options: { matchCase: this.matchCase },
      },
    };
  }
}
