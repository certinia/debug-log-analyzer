/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';

import { VscodeSingleSelect } from '#vscode-elements/vscode-single-select.js';
import { css, html, nothing, type TemplateResult } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { classMap } from 'lit/directives/class-map.js';
import { ifDefined } from 'lit/directives/if-defined.js';
import { repeat } from 'lit/directives/repeat.js';

import { globalStyles } from '../styles/global.styles.js';
import { selectFaceText } from './selectFaceText.js';

/** Current-value marker for single-select rows — same tick as vscode-checkbox/`.vs-checkbox`. */
const checkIcon = html`
  <svg
    width="12"
    height="12"
    viewBox="0 0 16 16"
    xmlns="http://www.w3.org/2000/svg"
    fill="currentColor"
  >
    <path
      fill-rule="evenodd"
      clip-rule="evenodd"
      d="M14.431 3.323l-8.47 10-.79-.036-3.35-4.77.818-.574 2.978 4.24 8.051-9.506.764.646z"
    />
  </svg>
`;

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

  /* In the overflow panel: aligned label column + select control, matching the
     facet/range panel rows (shared --filter-panel-label-width). */
  :host([slot='overflow']) {
    display: grid;
    grid-template-columns: var(--filter-panel-label-width) 1fr;
    align-items: center;
    column-gap: 8px;
    width: 100%;
  }

  .vs-panel-label {
    grid-column: 1;
    font-size: var(--filter-control-font-size);
    color: var(--vscode-foreground);
    white-space: nowrap;
  }

  .vs-panel-control {
    grid-column: 2;
    justify-self: start;
  }

  .dropdown {
    /* Hugs its widest option (base sets an inline width style; min-width here
       floors that at the trigger's own width so the popup is never narrower
       than the control that opens it — same content-sizing as the facet
       popover, no fixed 220px). */
    min-width: max-content;
    padding: 4px;
    background-color: var(--filter-popover-bg);
    border-color: var(--filter-popover-border-color);
    border-radius: var(--filter-popover-radius);
    box-shadow: var(--filter-popover-shadow);
  }

  /* Vendor's '.option.single-select' (two classes, higher specificity than a
     plain '.option' rule) sets display:block — it wins over a '.option {
     display:flex }' override regardless of source order, which is why the
     checkmark and label used to stack instead of sitting inline. Override
     the two-class selector directly so this is the row layout for every
     single-select option, matching the facet popover row exactly. */
  .option,
  .option.single-select {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: 6px;
    box-sizing: border-box;
    font-size: var(--filter-popover-row-font-size);
    padding: var(--filter-popover-row-padding);
    height: auto;
    line-height: normal;
    min-height: 0;
    overflow: visible;
    white-space: normal;
  }

  /* Row highlight is the same calm grey as every other filter-bar popover row
     — the base vendor style uses the blue list-active-selection token here,
     which is the one place blue leaked into the shared popover family.
     Current value is shown by the checkmark (.option-check), not a fill. */
  .option.active,
  .option.active:hover {
    background-color: var(--vscode-list-hoverBackground);
    color: var(--vscode-foreground);
    outline-color: var(--vscode-list-hoverBackground);
  }

  /* Same 16px marker column as the facet checklist's checkbox (.vs-checkbox), so
     single-select and multi-select dropdowns share one label indent + tick. */
  .option-check {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    width: 16px;
    height: 16px;
    color: var(--vscode-foreground);
  }

  .option:not(.selected) .option-check {
    visibility: hidden;
  }

  /* Base sets width:100%, which overflows the flex row now that a check icon
     shares it with the label. */
  .option-label {
    flex: 1;
    width: auto;
    min-width: 0;
  }

  .face {
    cursor: pointer;
  }

  :host(:not([dense])) .face:hover {
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

  /* Dense face box model (height/padding/font-size/border-radius) comes from
     the shared .filter-control class (applied via classMap below) so it
     matches the filter bar's facet/range trigger pills. vscode-single-select's
     base styles still fix inner chrome to a 13px-font layout (.select-face
     .text height:18px, .combobox-input line-height:16px, .combobox-button
     height:16px) that .filter-control's own padding/font-size doesn't reach —
     these resets on the inner chrome are what actually make the row match. */
  :host([dense]) .select-face .text {
    height: auto;
    line-height: inherit;
  }

  :host([dense]) .select-face .icon {
    top: 50%;
    transform: translateY(-50%);
  }

  :host([dense]) .combobox-input {
    height: auto;
    padding: 0;
    font-size: inherit;
    line-height: inherit;
  }

  :host([dense]) .combobox-button {
    height: auto;
    align-self: stretch;
    margin: 0;
    padding: 0 3px;
    box-sizing: border-box;
  }

  /* Rows carrying a reset affordance lay the icon out at the trailing edge
     (.option is already flex, see above). */
  .option-reset {
    margin-left: auto;
  }
`;

/** vscode-single-select where the control fits the selected value and the popup its widest option. */
@customElement('vs-select')
export class VsSelect extends VscodeSingleSelect {
  static styles = [...VscodeSingleSelect.styles, globalStyles, selectSizingStyles];

  /** Shrinks padding/font-size to match the filter bar's facet/range trigger pills. */
  @property({ type: Boolean, reflect: true })
  dense = false;

  /** Field name shown before the value when active, e.g. `Group` → `Group: Namespace`. */
  @property({ type: String })
  prefix = '';

  /** Value treated as "no selection" — renders the placeholder rather than an active value. */
  @property({ type: String })
  emptyValue = 'None';

  /**
   * Option values shown as "edited": each gets a trailing reset icon (and a `•`
   * marker on both the row and the face). Empty → default select behaviour.
   */
  @property({ attribute: false })
  resettableValues: string[] = [];

  /**
   * Marks this as a filter control (e.g. the Type dropdown) rather than a view
   * preference (Columns, Group by): its trigger gets the same active-pill
   * treatment as facet/range triggers whenever its value is a real filter —
   * the host computes that (it knows what "no filter" means for this select,
   * which usually differs from `emptyValue`/the bold-text `active` state).
   */
  @property({ type: Boolean, reflect: true })
  filterActive = false;

  /** Reactive mirror of the native `slot` attribute so the control re-renders as
   *  an aligned label + select row when `<overflow-list>` moves it into its panel. */
  @property({ attribute: 'slot' }) slot = '';

  override render(): TemplateResult {
    const base = super.render() as TemplateResult;
    if (this.slot !== 'overflow') {
      return base;
    }
    // In the overflow panel: a label column + the compact select, aligned with
    // the facet/range rows via the shared label-width token.
    return html`<span class="vs-panel-label" title=${this.label ?? ''}>${this.label}</span>
      <div class="vs-panel-control">${base}</div>`;
  }

  private _faceContent(): TemplateResult {
    const { prefixText, valueText } = selectFaceText({
      prefix: this.prefix,
      placeholder: this.label ?? '',
      value: this.value,
      emptyValue: this.emptyValue,
    });
    const marker = this.resettableValues.includes(this.value) ? ' •' : '';
    return html`${prefixText ? html`<span class="face-prefix">${prefixText}</span>` : ''}<span
        class="face-value"
        >${valueText}${marker}</span
      >`;
  }

  private _onResetOption(event: Event, value: string): void {
    // Keep the click from selecting/closing the row it lives in.
    event.stopPropagation();
    this.dispatchEvent(
      new CustomEvent('vs-reset-option', { detail: { value }, bubbles: true, composed: true }),
    );
  }

  protected override _renderOptions(): TemplateResult | TemplateResult[] {
    return html`
      <ul
        aria-label=${ifDefined(this.label ?? undefined)}
        class="options"
        id="select-listbox"
        role="listbox"
        tabindex="-1"
        @click=${this._onOptionClick}
        @mouseover=${this._onOptionMouseOver}
      >
        ${repeat(
          this._opts.options,
          (op) => op.index,
          (op, index) => {
            if (!op.visible) {
              return nothing;
            }
            const active = op.index === this._opts.activeIndex && !op.disabled;
            const selected = this._opts.getIsIndexSelected(op.index);
            const edited = this.resettableValues.includes(op.value);
            const optionClasses = {
              active,
              disabled: op.disabled,
              option: true,
              'single-select': true,
              'resettable-option': edited,
              selected,
            };
            return html`
              <li
                aria-selected=${selected ? 'true' : 'false'}
                class=${classMap(optionClasses)}
                data-index=${op.index}
                data-filtered-index=${index}
                id=${`op-${op.index}`}
                role="option"
                tabindex="-1"
              >
                <span class="option-check">${selected ? checkIcon : nothing}</span>
                <span class="option-label">${op.label}${edited ? ' •' : ''}</span>
                ${
                  edited
                    ? html`<vscode-icon
                        name="discard"
                        action-icon
                        class="option-reset"
                        title="Reset ${op.label} columns"
                        @click=${(event: Event) => this._onResetOption(event, op.value)}
                      ></vscode-icon>`
                    : nothing
                }
              </li>
            `;
          },
        )}
        ${this._renderPlaceholderOption(this._opts.numOfVisibleOptions < 1)}
      </ul>
    `;
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
        class=${classMap({
          'select-face': true,
          face: true,
          active,
          'filter-control': this.dense,
          'filter-control--active': this.filterActive,
        })}
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
      <div
        class=${classMap({
          'combobox-face': true,
          face: true,
          active,
          'filter-control': this.dense,
          'filter-control--active': this.filterActive,
        })}
      >
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
