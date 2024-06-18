import { provideVSCodeDesignSystem, vsCodeTextField } from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import codiconStyles from '../../styles/codicon.css';
import { globalStyles } from '../../styles/global.styles.js';
import '../../vscode-ui/VsIconCheckbox.js';

provideVSCodeDesignSystem().register(vsCodeTextField());

@customElement('find-widget')
export class FindWidget extends LitElement {
  @state() isVisble = false;
  @state() matchCase = false;

  constructor() {
    super();
    document.addEventListener('keydown', (e: KeyboardEvent) => {
      this._keyPress(e);
    });
  }

  static styles = [
    globalStyles,
    unsafeCSS(codiconStyles),
    css`
      :host {
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

      <div class="find-actions">
        <vscode-button appearance="icon" title="Previous Match" class="find-button"
          ><span class="codicon codicon-arrow-up"></span
        ></vscode-button>
        <vscode-button appearance="icon" title="Next Match" class="find-button"
          ><span class="codicon codicon-arrow-down"></span
        ></vscode-button>
        <vscode-button appearance="icon" title="Close" class="find-button" @click=${this._closeFind}
          ><span class="codicon codicon-close"></span
        ></vscode-button>
      </div>
    </div>`;
  }

  _matchCase() {
    this.matchCase = !this.matchCase;
  }

  _closeFind() {
    this.isVisble = false;
  }

  _findInputClick() {
    const inputBox = this.inputbox;
    if (inputBox) {
      this.isVisble = true;
      inputBox.focus();
      inputBox.select();
    }
  }

  get inputbox() {
    return this.shadowRoot?.querySelector<HTMLInputElement>('.find-input-box');
  }

  _keyPress(e: KeyboardEvent) {
    if (e.key === 'f' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      this._findInputClick();
      return;
    }

    if (
      !this.shadowRoot?.activeElement ||
      !this.shadowRoot.contains(this.shadowRoot?.activeElement)
    ) {
      return;
    }

    const inputBox = this.inputbox;

    switch (e.key) {
      case 'Escape':
        this.isVisble = false;
        break;

      case 'Enter': {
        document.dispatchEvent(
          new CustomEvent('lv-find', { detail: { text: inputBox?.value.toLowerCase() } }),
        );
        break;
      }

      default:
        break;
    }
  }
}
