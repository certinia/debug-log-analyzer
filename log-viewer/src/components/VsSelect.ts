/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { VscodeSingleSelect } from '#vscode-elements/vscode-single-select.js';
import { css, html, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';

import { selectFaceText } from './selectFaceText.js';

/** Chevron matching the vscode-elements select face (base `.icon` styles position it). */
const chevronDownIcon = html`
  <span class="icon">
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      fill="currentColor"
    >
      <path
        fill-rule="evenodd"
        clip-rule="evenodd"
        d="M7.976 10.072l4.357-4.357.62.618L8.284 11h-.618L3 6.333l.619-.618 4.357 4.357z"
      />
    </svg>
  </span>
`;

/** Reusable for a `VscodeMultiSelect` subclass if multi-select is ever needed. */
export const selectSizingStyles = css`
  :host {
    width: fit-content;
  }

  .dropdown {
    /* widens the popup past the control width the base sets as an inline
       style: used width = max(width, min-width) */
    min-width: max-content;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
  }

  .face {
    cursor: pointer;
  }

  .face:hover {
    background-color: var(--vscode-toolbar-hoverBackground);
  }

  /* Combobox face: size to placeholder/value (like the select face's fit-content
     host) and vertically centre prefix / input / chevron. */
  .combobox-face {
    align-items: center;
  }

  .combobox-input {
    field-sizing: content;
    width: auto;
    min-width: 3ch;
  }

  .face-prefix {
    color: var(--vscode-descriptionForeground);
  }

  .face-value {
    color: var(--vscode-foreground);
  }

  .face.active .face-value {
    font-weight: 600;
  }

  /* Inactive placeholder is muted. */
  .face:not(.active) .face-value {
    color: var(--vscode-descriptionForeground);
  }

  .face-prefix + .face-value {
    margin-left: 4px;
  }

  .combobox-face .face-prefix {
    padding-left: 4px;
  }
`;

/** vscode-single-select where the control fits the selected value and the popup its widest option. */
@customElement('vs-select')
export class VsSelect extends VscodeSingleSelect {
  static styles = [...VscodeSingleSelect.styles, selectSizingStyles];

  /** Field name shown before the value when active, e.g. `Group` → `Group: Namespace`. */
  @property({ type: String })
  prefix = '';

  /** Value treated as "no selection" — renders the placeholder rather than an active value. */
  @property({ type: String })
  emptyValue = 'None';

  private _faceContent(): TemplateResult {
    const { prefixText, valueText } = selectFaceText({
      prefix: this.prefix,
      placeholder: this.label ?? '',
      value: this.value,
      emptyValue: this.emptyValue,
    });
    return html`${prefixText ? html`<span class="face-prefix">${prefixText}</span>` : ''}<span
        class="face-value"
        >${valueText}</span
      >`;
  }

  protected override _renderSelectFace(): TemplateResult {
    const activeDescendant = this._opts.activeIndex > -1 ? `op-${this._opts.activeIndex}` : '';
    const { active } = selectFaceText({
      prefix: this.prefix,
      placeholder: this.label ?? '',
      value: this.value,
      emptyValue: this.emptyValue,
    });
    return html`
      <div
        aria-activedescendant=${activeDescendant}
        aria-controls="select-listbox"
        aria-expanded=${this.open ? 'true' : 'false'}
        aria-haspopup="listbox"
        aria-label=${ifDefined(this.label)}
        class=${classMap({ 'select-face': true, face: true, active })}
        @click=${this._onFaceClick}
        role="combobox"
        tabindex="0"
      >
        <span class="text">${this._faceContent()}</span> ${chevronDownIcon}
      </div>
    `;
  }

  protected override _renderComboboxFace(): TemplateResult {
    const inputVal = this._isBeingFiltered ? this._opts.filterPattern : this.value;
    const activeDescendant = this._opts.activeIndex > -1 ? `op-${this._opts.activeIndex}` : '';
    const { prefixText, active } = selectFaceText({
      prefix: this.prefix,
      placeholder: this.label ?? '',
      value: this.value,
      emptyValue: this.emptyValue,
    });
    return html`
      <div class=${classMap({ 'combobox-face': true, face: true, active })}>
        ${prefixText ? html`<span class="face-prefix">${prefixText}</span>` : ''}
        <input
          aria-activedescendant=${activeDescendant}
          aria-autocomplete="list"
          aria-controls="select-listbox"
          aria-expanded=${this.open ? 'true' : 'false'}
          aria-haspopup="listbox"
          aria-label=${ifDefined(this.label)}
          class="combobox-input"
          role="combobox"
          spellcheck="false"
          type="text"
          autocomplete="off"
          placeholder=${active ? '' : ifDefined(this.label)}
          .value=${inputVal}
          @focus=${this._onComboboxInputFocus}
          @blur=${this._onComboboxInputBlur}
          @input=${this._onComboboxInputInput}
          @click=${this._onComboboxInputClick}
          @keydown=${this._onComboboxInputSpaceKeyDown}
        />
        <button
          aria-label="Open the list of options"
          class="combobox-button"
          type="button"
          @click=${this._onComboboxButtonClick}
          @keydown=${this._onComboboxButtonKeyDown}
          tabindex="-1"
        >
          ${chevronDownIcon}
        </button>
      </div>
    `;
  }
}
