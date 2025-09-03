//totod: event types

import { provideVSCodeDesignSystem, vsCodeTextField } from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import '../../../ui/components/VsIconCheckbox.js';
import codiconStyles from '../../../ui/styles/codicon.css';
import { globalStyles } from '../../../ui/styles/global.styles.js';

provideVSCodeDesignSystem().register(vsCodeTextField());

@customElement('find-widget')
export class FindWidget extends LitElement {
  @state() totalMatches = 0;
  @state() currentMatch = 1;
  @state() isVisble = false;
  @state() matchCase = false;

  lastMatch: string | null = null;
  nextMatchDirection = true;

  constructor() {
    super();
    window.addEventListener('keydown', (e: KeyboardEvent) => {
      this._keyPress(e);
    });

    document.addEventListener('lv-find-results', ((
      e: CustomEvent<{ totalMatches: number; count?: number }>,
    ) => {
      this._updateCounts(e);
    }) as EventListener);
  }

  static styles = [
    globalStyles,
    unsafeCSS(codiconStyles),
    css`
      :host {
        font-size: 12px;
      }

      .wrapper {
        position: absolute;
        top: 0;
        right: 28px;
        max-width: 420px;
        border: 1px solid var(--vscode-contrastBorder);
        color: var(--vscode-editorWidget-foreground);
        background: var(--vscode-editorWidget-background);
        z-index: 1;
        display: flex;
        border-bottom: 1px solid var(--vscode-widget-border);
        border-bottom-left-radius: 4px;
        border-bottom-right-radius: 4px;
        border-left: 1px solid var(--vscode-widget-border);
        border-right: 1px solid var(--vscode-widget-border);
        box-sizing: border-box;
        margin-top: 3px;
        height: 33px;
        line-height: 19px;
        overflow: hidden;
        padding: 3px 4px 0px 4px;
        position: absolute;
        transform: translateY(calc(-100% - 10px));
        transition: transform 0.2s linear;
      }

      .visible {
        transform: translateY(0);
        box-shadow: 0 0 8px 2px var(--vscode-widget-shadow);
      }

      .find-input__controls {
        display: flex;
        align-items: center;
      }

      .find-input-box {
        height: 25px;
        vertical-align: middle;
        box-sizing: border-box;
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
        height: 25px;
      }

      .find-button:focus {
        border: 1px solid transparent;
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        justify-content: center;
        box-sizing: border-box;
        width: 22px;
        height: 22px;
      }

      .find-button:focus {
        color: var(--vscode-inputOption-activeForeground);
        border: 1px solid var(--vscode-inputOption-activeBorder);
      }

      .matches-count {
        min-width: 69px;
        box-sizing: border-box;
        display: flex;
        flex: initial;
        height: 25px;
        line-height: 23px;
        margin: 0 0 0 3px;
        padding: 2px 0 0 2px;
        text-align: center;
        vertical-align: middle;
      }
    `,
  ];

  render() {
    return html`<div class="wrapper ${this.isVisble ? 'visible' : ''}">
      <vscode-text-field
        placeholder="Find"
        aria-label="Find"
        class="find-input-box"
        @click=${this._findInputClick}
      >
        <section slot="end" class="find-input__controls">
          <vs-icon-checkbox
            showSelected="true"
            title="Match Case"
            class="find-control"
            @click=${this._matchCase}
          >
            <span class="codicon codicon-case-sensitive"></span>
          </vs-icon-checkbox>
        </section>
      </vscode-text-field>
      <div class="matches-count">${this._getMatchesText()}</div>

      <div class="find-actions">
        <vscode-button
          appearance="icon"
          title="Previous Match"
          class="find-button"
          @click=${this._previousMatch}
          ><span class="codicon codicon-arrow-up"></span
        ></vscode-button>
        <vscode-button
          appearance="icon"
          title="Next Match"
          class="find-button"
          @click=${this._nextMatch}
          ><span class="codicon codicon-arrow-down"></span
        ></vscode-button>
        <vscode-button appearance="icon" title="Close" class="find-button" @click=${this._closeFind}
          ><span class="codicon codicon-close"></span
        ></vscode-button>
      </div>
    </div>`;
  }

  _getMatchesText() {
    if (this.totalMatches === 0) {
      return 'No Matches';
    }

    return (this.totalMatches ? this.currentMatch : '?') + ' of ' + this.totalMatches;
  }

  _matchCase() {
    this._resetCounts();
    this.matchCase = !this.matchCase;
    this._triggerFind();
  }

  _closeFind() {
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
      inputBox.focus();
      inputBox.select();
    }
  }

  _previousMatch() {
    if (this.currentMatch !== null) {
      this.currentMatch--;
      this.nextMatchDirection = false;
      if (this.currentMatch < 1) {
        this.currentMatch = this.totalMatches;
      }

      document.dispatchEvent(new CustomEvent('lv-find-match', this._getFindEvent()));
    }
  }

  _nextMatch() {
    if (this.currentMatch !== null) {
      this.currentMatch++;
      this.nextMatchDirection = true;
      if (this.currentMatch > this.totalMatches) {
        this.currentMatch = 1;
      }

      document.dispatchEvent(new CustomEvent('lv-find-match', this._getFindEvent()));
    }
  }

  get inputbox() {
    return this.shadowRoot?.querySelector<HTMLInputElement>('.find-input-box');
  }

  _updateCounts(e: { detail: { totalMatches: number; count?: number } }) {
    this.totalMatches = e.detail.totalMatches;
    this.currentMatch = e.detail.count ?? 1;
  }

  _resetCounts() {
    this.totalMatches = 0;
    this.currentMatch = 1;
  }

  _keyPress(e: KeyboardEvent) {
    if (e.repeat) {
      return;
    }

    if (e.key === 'f' && (e.metaKey || e.ctrlKey) && !e.shiftKey) {
      e.preventDefault();

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
        this._closeFind();

        break;

      case 'Enter': {
        if (this._hasMatchValueChanged() || !this.totalMatches) {
          this._triggerFind();
        } else if (this.nextMatchDirection) {
          this._nextMatch();
        } else {
          this._previousMatch();
        }
        break;
      }

      default:
        break;
    }
  }

  _triggerFind() {
    this._resetCounts();
    document.dispatchEvent(new CustomEvent('lv-find', this._getFindEvent()));
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
