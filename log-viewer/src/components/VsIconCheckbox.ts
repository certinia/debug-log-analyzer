import { provideVSCodeDesignSystem, vsCodeButton } from '@vscode/webview-ui-toolkit';
import { LitElement, css, html, unsafeCSS } from 'lit';
import { customElement, property } from 'lit/decorators.js';

// styles
import codiconStyles from '../styles/codicon.css';
import { globalStyles } from '../styles/global.styles.js';

provideVSCodeDesignSystem().register(vsCodeButton());

@customElement('vs-icon-checkbox')
export class VsIconCheckbox extends LitElement {
  static shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  @property() showSelected = false;
  @property() checked = false;
  @property() title = '';

  static styles = [
    globalStyles,
    unsafeCSS(codiconStyles),
    css`
      :host {
        --button-icon-hover-background: var(--vscode-toolbar-hoverBackground);

        display: flex;
      }

      .icon-checkbox.checked {
        color: var(--vscode-inputOption-activeForeground);
        border: 1px solid var(--vscode-inputOption-activeBorder);
        background: var(--vscode-inputOption-activeBackground);
      }

      .icon-checkbox {
        border: 1px solid transparent;
        cursor: pointer;
        user-select: none;
        -webkit-user-select: none;
        justify-content: center;
        box-sizing: border-box;
        width: 22px;
        height: 22px;
      }
    `,
  ];

  render() {
    return html`<vscode-button
      appearance="icon"
      class="icon-checkbox ${this.checked && this.showSelected ? 'checked' : ''}"
      aria-label="${this.title}"
      title="${this.title}"
      @click="${this._toggleChecked}"
    >
      <slot></slot>
    </vscode-button>`;
  }

  _toggleChecked() {
    this.checked = !this.checked;
  }
}
