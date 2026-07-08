/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { VscodeSingleSelect } from '#vscode-elements/vscode-single-select.js';
import { css } from 'lit';
import { customElement } from 'lit/decorators.js';

/** Reusable for a `VscodeMultiSelect` subclass if multi-select is ever needed. */
export const selectSizingStyles = css`
  :host {
    width: fit-content;
  }

  .dropdown {
    /* widens the popup past the control width the base sets as an inline
       style: used width = max(width, min-width) */
    min-width: max-content;
  }
`;

/** vscode-single-select where the control fits the selected value and the popup its widest option. */
@customElement('vs-select')
export class VsSelect extends VscodeSingleSelect {
  static styles = [...VscodeSingleSelect.styles, selectSizingStyles];
}
