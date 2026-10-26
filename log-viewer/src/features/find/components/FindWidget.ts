import '#vscode-elements/vscode-textfield.js';
import '#vscode-elements/vscode-toolbar-button.js';
import type { VscodeTextfield } from '#vscode-elements/vscode-textfield.js';
import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';

import { DelayController } from '../../../core/events/DelayController.js';
import { DomListenerController } from '../../../core/events/DomListenerController.js';
import type { FindDirection, FindEventMap, FindResultsEventDetail } from '../findEvents.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';

// web components
import '../../../components/VsIconCheckbox.js';

const LIVE_FIND_MS = 150;

// The field's input is square and opaque, so it paints over the rounded border's corners; VS Code's find input is see-through too.
const seeThroughInput = css`
  input {
    background-color: transparent;
  }
`.styleSheet;

@customElement('find-widget')
export class FindWidget extends LitElement {
  @state() totalMatches = 0;
  @state() currentMatch = 1;
  @state() isVisble = false;
  @state() matchCase = false;

  _sentTerm: string | null = null;
  // The term the counts are for: a search sent for a newer one keeps the old counts until it reports.
  @state() private _countedTerm: string | null = null;

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
        /* VS Code's own find widget geometry, not spacing. */
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

      .find-control {
        box-sizing: border-box;
        align-items: center;
        margin-left: var(--lana-space-2xs);
        height: 20px;
        width: 20px;
      }

      .find-actions {
        display: flex;
        align-items: center;
      }

      /* The button colours its icon from this var; VS Code's find widget greys a disabled action so. */
      .find-button.disabled {
        --vscode-foreground: var(--vscode-disabledForeground);
        pointer-events: none;
      }

      .matches-count {
        min-width: 69px;
        box-sizing: border-box;
        display: flex;
        flex: initial;
        align-items: center;
        margin: 0 0 0 var(--lana-space-2xs);
        padding-left: var(--lana-space-3xs);
        text-align: center;
        vertical-align: middle;
      }

      .no-results .matches-count {
        color: var(--vscode-errorForeground);
      }
    `,
  ];

  render() {
    const cannotStep = !this.totalMatches;
    const noResults = !!this._countedTerm && !this.totalMatches;
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
            label="Match Case"
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
          @click=${() => this._step('prev')}
        ></vscode-toolbar-button>
        <vscode-toolbar-button
          icon="arrow-down"
          label="Next Match"
          title="Next Match"
          class="find-button ${cannotStep ? 'disabled' : ''}"
          @click=${() => this._step('next')}
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
    const text = this._countedTerm;
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
    this.matchCase = !this.matchCase;
    this._send('lv-find', 'next');
  }

  _closeFind() {
    this._live.cancel();
    this.isVisble = false;
    this._resetCounts();
    this._send('lv-find-close');
  }

  _findInputClick() {
    const inputBox = this.inputbox;
    if (inputBox) {
      this.isVisble = true;
      inputBox.focus();
      inputBox.wrappedElement?.select();
    }
  }

  // New text, or nothing to step through, searches first: the views have no matches for it yet.
  _step(direction: FindDirection) {
    this._live.cancel();
    if (this._hasMatchValueChanged() || !this.totalMatches) {
      this._send('lv-find', direction);
      return;
    }
    if (!this.currentMatch) {
      this._send('lv-find-match', direction);
      return;
    }
    const by = direction === 'next' ? 1 : -1;
    this.currentMatch = ((this.currentMatch - 1 + by + this.totalMatches) % this.totalMatches) + 1;
    document.dispatchEvent(new CustomEvent('lv-find-match', this._getFindEvent()));
  }

  get inputbox() {
    return this.shadowRoot?.querySelector<VscodeTextfield>('.find-input-box');
  }

  firstUpdated() {
    const field = this.inputbox?.shadowRoot;
    if (field && seeThroughInput) {
      field.adoptedStyleSheets = [...field.adoptedStyleSheets, seeThroughInput];
    }
  }

  _updateCounts(e: CustomEvent<FindResultsEventDetail>) {
    this._countedTerm = this._sentTerm;
    this.totalMatches = e.detail.totalMatches;
    this.currentMatch = e.detail.currentMatch;
  }

  _resetCounts() {
    this._countedTerm = null;
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
      if (!this.isVisble && !this.totalMatches) {
        this._send('lv-find');
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
        this._closeFind();
        break;

      case 'Enter': {
        e.preventDefault(); // Prevent double-firing from input field
        this._step(e.shiftKey ? 'prev' : 'next');
        break;
      }
    }
  }

  _refresh() {
    if (!this.isVisble || !this._getMatchValue()) {
      return;
    }
    this._send('lv-find');
  }

  _onInput() {
    this._live.schedule(() => this._liveFind());
  }

  _liveFind() {
    if (!this._hasMatchValueChanged()) {
      return;
    }
    this._send('lv-find', 'next');
  }

  // Counts stay until the views report, so a new search does not flash "No results".
  _send(type: 'lv-find' | 'lv-find-match' | 'lv-find-close', direction?: FindDirection) {
    const { detail } = this._getFindEvent();
    document.dispatchEvent(new CustomEvent(type, { detail: { ...detail, count: 0, direction } }));
  }

  _getMatchValue() {
    return this.inputbox?.value ?? '';
  }

  _hasMatchValueChanged() {
    return this._sentTerm !== this._getMatchValue();
  }

  _getFindEvent() {
    this._sentTerm = this._getMatchValue();
    return {
      detail: {
        text: this._getMatchValue(),
        count: this.currentMatch,
        options: { matchCase: this.matchCase },
      },
    };
  }
}
