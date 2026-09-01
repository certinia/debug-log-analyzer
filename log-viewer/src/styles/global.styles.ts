import { css } from 'lit';

import { tokenStyles } from './tokens.styles.js';

/**
 * Shared component styles. Carries `tokenStyles` because the rules below read
 * `--lana-*`, so every component that adopts `globalStyles` gets the tokens with it.
 */
export const globalStyles = [
  tokenStyles,
  css`
    :host {
      /* Filter-bar design tokens — every compact control (facet/range pills,
       toggle pills, dense VsSelect, Expand/Collapse, view-mode buttons) reads
       off these so the bar is one visual family instead of N hand-tuned
       copies. */
      --filter-control-height: 22px;
      /* For a control in the inspector's action bar, which is shorter than a filter bar. */
      --filter-control-height-dense: 20px;
      --filter-control-font-size: var(--lana-text-base);
      --filter-control-padding: 0 var(--lana-space-sm);
      --filter-control-radius: var(--lana-radius-sm);

      /* Popover design tokens — facet/range/select/context-menu popovers all
       consume these so they render as one family. */
      --filter-popover-bg: var(--vscode-menu-background, var(--lana-editor-bg));
      --filter-popover-border-color: var(--vscode-menu-border, var(--lana-surface-border));
      --filter-popover-radius: var(--lana-radius-md);
      --filter-popover-shadow: var(--lana-shadow-popover);
      --filter-popover-row-font-size: var(--lana-text-base);
      --filter-popover-row-padding: var(--lana-space-2xs) var(--lana-space-sm);

      /* Label column width shared by every filter's overflow-panel row (facet,
       range, select) so their labels + controls line up as one form. */
      --filter-panel-label-width: 6.5rem;
    }

    /* A shadow root gets no document reset, so a paragraph carries the UA's 1em
       block margin. Every section owns its own rhythm through padding. */
    p {
      margin-block: 0;
    }

    a {
      color: var(--lana-link-fg);
      text-decoration: none;
      cursor: pointer;

      &:hover {
        color: var(--lana-link-fg-active);
        text-decoration: underline;
      }

      &:active {
        background: transparent;
        color: var(--lana-link-fg-active);
        text-decoration: underline;
      }
    }

    ::-webkit-scrollbar {
      width: 10px;
      height: 10px;
    }

    ::-webkit-scrollbar-corner {
      background-color: var(--lana-editor-bg);
    }

    ::-webkit-scrollbar-thumb {
      background-color: var(--vscode-scrollbarSlider-background);
    }

    /* findMatch is the match you are on; findMatchHighlight is the rest. */
    ::highlight(find-match) {
      color: var(--vscode-editor-findMatchHighlightForeground);
      background-color: var(--vscode-editor-findMatchHighlightBackground, yellow);
    }

    ::highlight(current-find-match) {
      color: var(--vscode-editor-findMatchForeground);
      background-color: var(--vscode-editor-findMatchBackground, #8b8000);
    }

    /* vscode-button shows its focus ring + hover background on any focus
     (including mouse click); restrict that to keyboard focus like the
     native VS Code button */
    vscode-button:focus:not(:focus-visible)::part(base) {
      outline: none;
    }

    vscode-button:focus:not(:hover)::part(base) {
      background-color: var(--vscode-button-background);
    }

    vscode-button[secondary]:focus:not(:hover)::part(base) {
      background-color: var(--vscode-button-secondaryBackground);
    }

    /* Native checkbox: box background/border never change on check (matching
     vscode-checkbox) — only a currentColor tick appears on top, drawn with
     the same tick path vscode-checkbox uses via mask-image so it scales
     cleanly instead of being clipped out of a filled square. The 16px box and
     3px radius are vscode-checkbox's own metrics, not the --lana-* scale. */
    .vs-checkbox {
      box-sizing: border-box;
      appearance: none;
      margin: 0;
      width: 16px;
      height: 16px;
      flex-shrink: 0;
      border: var(--lana-stroke) solid var(--vscode-checkbox-border, var(--lana-control-border));
      border-radius: 3px;
      background-color: var(--vscode-checkbox-background, var(--lana-control-bg));
      cursor: pointer;
    }

    .vs-checkbox:checked::before {
      content: '';
      display: block;
      width: 100%;
      height: 100%;
      background-color: var(--vscode-checkbox-foreground);
      -webkit-mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill-rule='evenodd' clip-rule='evenodd' d='M14.431 3.323l-8.47 10-.79-.036-3.35-4.77.818-.574 2.978 4.24 8.051-9.506.764.646z'/%3E%3C/svg%3E");
      mask-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16'%3E%3Cpath fill-rule='evenodd' clip-rule='evenodd' d='M14.431 3.323l-8.47 10-.79-.036-3.35-4.77.818-.574 2.978 4.24 8.051-9.506.764.646z'/%3E%3C/svg%3E");
      -webkit-mask-repeat: no-repeat;
      mask-repeat: no-repeat;
      -webkit-mask-position: center;
      mask-position: center;
      -webkit-mask-size: 70%;
      mask-size: 70%;
    }

    .vs-checkbox:focus-visible {
      outline: 1px solid var(--lana-focus-border);
      outline-offset: 1px;
    }

    .vs-checkbox-label {
      display: inline-flex;
      align-items: center;
      gap: var(--lana-space-xs);
      font-size: var(--lana-text-base);
      cursor: pointer;
    }

    /* Shared base for every compact filter-bar control (facet/range trigger
     pills, toggle pills, dense VsSelect face) — one place for the
     height/padding/border/radius/hover/focus so they're never re-tuned
     independently. Consumers add their own class alongside this one for
     anything control-specific (active state, tabular numerals, etc). */
    .filter-control {
      box-sizing: border-box;
      height: var(--filter-control-height);
      display: inline-flex;
      align-items: center;
      gap: var(--lana-space-2xs);
      padding: var(--filter-control-padding);
      border: var(--lana-stroke) solid var(--lana-control-border);
      border-radius: var(--filter-control-radius);
      background-color: var(--lana-control-bg);
      color: var(--lana-fg);
      font: inherit;
      font-size: var(--filter-control-font-size);
      line-height: 1.4;
      white-space: nowrap;
      cursor: pointer;
    }

    .filter-control:hover {
      background-color: var(--lana-row-hover-bg);
    }

    .filter-control:focus-visible {
      outline: 1px solid var(--lana-focus-border);
      outline-offset: 1px;
    }

    /* Toggle-button counterpart to the facet/range trigger pills — same
     filter-control base, with an on/off state instead of a popover. ON uses
     VS Code's own toggle triad (Find widget, VsIconCheckbox); OFF is just
     the plain bordered pill, never dimmed. Binary toggles (Details/Debug
     Only) get the full filled treatment — this is a real "state", not a
     value-carrying filter. */
    .pill-toggle[aria-pressed='true'] {
      background-color: var(--vscode-inputOption-activeBackground);
      border-color: var(--vscode-inputOption-activeBorder, var(--lana-focus-border));
      color: var(--vscode-inputOption-activeForeground, var(--lana-fg));
    }

    /* Value-filter controls (facet/range triggers with a value, single-select
     filters ≠ default) get an accent border + text only — no fill. This
     distinguishes "a filter is applied" from the binary toggle's ON state
     above, while still reading as accented against the plain pill. */
    .filter-control--active {
      border-color: var(--vscode-inputOption-activeBorder, var(--lana-focus-border));
      color: var(--vscode-inputOption-activeForeground, var(--lana-fg));
    }

    /* Shared base for every filter-bar popover (facet checklist, range inputs,
     VsSelect dropdown, context menu) so they render as one family. Consumers
     keep their own positioning (fixed/anchor/inset/margin/size) and add this
     class for the look. */
    .filter-popover {
      background-color: var(--filter-popover-bg);
      border: var(--lana-stroke) solid var(--filter-popover-border-color);
      border-radius: var(--filter-popover-radius);
      box-shadow: var(--filter-popover-shadow);
      color: var(--vscode-menu-foreground, var(--lana-fg));
      font-family: var(--lana-font-ui);
    }

    .filter-popover-row {
      padding: var(--filter-popover-row-padding);
      border-radius: var(--lana-radius-sm);
      font-size: var(--filter-popover-row-font-size);
      cursor: pointer;
    }

    .filter-popover-row:hover {
      background-color: var(--lana-row-hover-bg);
    }
  `,
];
