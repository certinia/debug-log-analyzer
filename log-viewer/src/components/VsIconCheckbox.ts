import '#vscode-elements/vscode-toolbar-button.js';
import { LitElement, css, html } from 'lit';
import { customElement, property } from 'lit/decorators.js';

// styles
import { globalStyles } from '../styles/global.styles.js';

@customElement('vs-icon-checkbox')
export class VsIconCheckbox extends LitElement {
  static shadowRootOptions = { ...LitElement.shadowRootOptions, delegatesFocus: true };

  @property() icon = '';
  @property() showSelected = false;
  @property() checked = false;
  @property() label = '';

  static styles = [
    globalStyles,
    css`
      :host {
        display: flex;
      }
    `,
  ];

  render() {
    // keep the element empty: whitespace counts as slotted content and adds text padding
    return html`<vscode-toolbar-button
      icon="${this.icon}"
      ?toggleable="${this.showSelected}"
      ?checked="${this.checked && this.showSelected}"
      label="${this.label}"
      title="${this.label}"
      @click="${this._toggleChecked}"
    ></vscode-toolbar-button>`;
  }

  _toggleChecked() {
    this.checked = !this.checked;
  }
}
