/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { formatDuration } from '../../../core/utility/Util.js';
import { markerColorCss } from '../../timeline/types/flamechart.types.js';
import { SEVERITY_META, sortBySeverity, type LogIssue } from '../types.js';

// styles
import { globalStyles } from '../../../styles/global.styles.js';

// web components
import '../../../components/Divider.js';

/**
 * Renders a list of {@link LogIssue}s as cards, most severe first — the shared body of
 * both header popovers, and reusable by any surface that has issues to show.
 *
 * A card is activatable when its issue carries an {@link LogIssue.action}, whose `run` is
 * the consumer's to supply: this component knows nothing about what activation does.
 */
@customElement('issue-list')
export class IssueList extends LitElement {
  @property({ attribute: false })
  issues: readonly LogIssue[] = [];

  /** Indices of cards whose message has been expanded past the two-line clamp. */
  @state()
  private _expanded = new Set<number>();

  /**
   * Indices whose clamped message is taller than its two lines, so only those become toggles.
   * Measured rather than guessed: `message` can be a template, so its rendered height is the
   * only truth, and a one-line message offering to expand would expand nothing.
   */
  @state()
  private _clipped = new Set<number>();

  static styles = [
    globalStyles,
    css`
      :host {
        display: block;
      }

      .issue {
        display: flex;
        gap: 8px;
        padding: 8px;
        border-radius: 4px;
        overflow-wrap: anywhere;
        text-wrap: wrap;
      }

      /* Both the rail's neighbours anchor to the first line, so the severity glyph and the
         action button sit level with the summary however tall the card grows. */
      .issue > vscode-icon {
        align-self: flex-start;
        flex: 0 0 auto;
      }

      /* The rail is the colour the timeline draws for the same issue — one problem seen
         twice. Opaque where the timeline band is translucent: 3px needs the full hue. */
      .issue__rail {
        flex: 0 0 3px;
        align-self: stretch;
        border-radius: 2px;
      }

      .issue--action {
        cursor: pointer;
      }

      .issue--action:hover {
        background-color: var(--lana-row-hover-bg);
      }

      .issue__body {
        display: flex;
        flex-direction: column;
        gap: 4px;
        min-width: 0;
        flex: 1 1 auto;
      }

      .issue__head {
        display: flex;
        align-items: flex-start;
        gap: 8px;
      }

      .issue__summary {
        font-weight: 600;
        font-size: var(--lana-text-base);
        flex: 1 1 auto;
        min-width: 0;
      }

      /* The meta line under the summary: kind pill, then the moment in the log. Its own
         row rather than a trailing decoration so the summary's clamp keeps the full width,
         and so fatal/thrown pairs with identical summaries stay distinguishable at a
         glance. The line-height sizes the pill's box too, so a pill-less row is the same
         height. */
      .issue__meta {
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: var(--lana-space-xs);
        font-size: var(--lana-text-sm);
        /* A length, not a ratio: the pill's smaller text would compute a shorter box. */
        line-height: calc(var(--lana-text-sm) * 1.45);
        color: var(--lana-fg-muted);
      }

      /* Kind pill (e.g. "Fatal error" vs "Exception") — the severity glyph says how bad,
         the pill says what kind, so the summary can stay the raw message. */
      .issue__label {
        flex: 0 0 auto;
        font-size: var(--lana-text-xs);
        font-weight: 600;
        padding: 0 var(--lana-space-xs);
        border-radius: var(--lana-radius-sm);
        color: var(--lana-badge-fg);
        background-color: var(--lana-badge-bg);
        white-space: nowrap;
      }

      /* Most summaries are a short label, but a FATAL ERROR carries the whole exception:
         wrap so short ones show in full, clamp so one long one can't fill the popover. The
         full string stays in the card's title. */
      .issue__clamp {
        display: -webkit-box;
        -webkit-box-orient: vertical;
        -webkit-line-clamp: 2;
        line-clamp: 2;
        overflow: hidden;
      }

      /* Stack traces are code: keep their line breaks and their font, so each
         "at Class.method" frame reads as a frame, not one run-on paragraph. */
      .issue__message {
        font-size: var(--lana-text-mono);
        font-family: var(--lana-font-mono);
        color: var(--lana-fg-muted);
        white-space: pre-wrap;
      }

      /* A clipped message is a real button so it toggles on Enter and Space too, but it must
         still read as body text — strip the button chrome, keep only the pointer. */
      button.issue__message {
        display: block;
        width: 100%;
        padding: 0;
        border: none;
        background: none;
        font: inherit;
        text-align: left;
        cursor: pointer;
      }

      button.issue__message.issue__clamp {
        /* -webkit-box beats display:block above, so restate the clamp for the button. */
        display: -webkit-box;
      }

      /* Room for a second action to become a sibling, without restyling the first. */
      .issue__actions {
        flex: 0 0 auto;
        display: flex;
        gap: 2px;
      }
    `,
  ];

  /**
   * Both popovers render their list while closed, where there is no layout at all — so the list
   * has to re-measure when it is given a size, not only when it renders.
   */
  private readonly _resize = new ResizeObserver(() => {
    this._measure();
  });

  override connectedCallback(): void {
    super.connectedCallback();
    this._resize.observe(this);
  }

  override disconnectedCallback(): void {
    this._resize.disconnect();
    super.disconnectedCallback();
  }

  /** Re-measure after every render: a new list, or an expansion, changes what is clipped. */
  override updated(): void {
    this._measure();
  }

  private _measure(): void {
    // Inside a closed popover every height is 0, so nothing measures as clipped — and caching
    // that would leave the message a plain span for good. The observer re-runs this on open.
    if (!this.clientHeight) {
      return;
    }

    const clipped = new Set<number>();
    this.shadowRoot?.querySelectorAll<HTMLElement>('.issue__message.issue__clamp').forEach((el) => {
      const index = Number(el.dataset.index);
      // 1px of slack: sub-pixel line heights round scrollHeight up on their own.
      if (el.scrollHeight - el.clientHeight > 1) {
        clipped.add(index);
      }
    });

    // Expanded cards drop their clamp, so they no longer measure as clipped — keep them
    // counted or the toggle would vanish and re-appear on the next render.
    for (const index of this._expanded) {
      clipped.add(index);
    }

    if (!sameSet(clipped, this._clipped)) {
      this._clipped = clipped;
    }
  }

  /** Sorted once per list: expanding a card re-renders, and the order can't have changed. */
  private _sorted: readonly LogIssue[] = [];

  override willUpdate(changed: PropertyValues<this>): void {
    if (!changed.has('issues')) {
      return;
    }

    this._sorted = sortBySeverity(this.issues);
    // Both sets are keyed by index, so their lifetime is this list's: the element is reused
    // across log loads, where index 0 becomes a different issue.
    this._expanded = new Set();
    this._clipped = new Set();
  }

  render() {
    return html`${this._sorted.map(
      (issue, index) =>
        html`${index > 0 ? html`<divider-line></divider-line>` : ''}${this._card(issue, index)}`,
    )}`;
  }

  private _card(issue: LogIssue, index: number): TemplateResult {
    const action = issue.action;
    // One composition for meta, title and aria, so the three can never drift apart.
    const time = issue.timestamp !== null ? formatDuration(issue.timestamp) : null;
    const meta = [issue.label, time].filter(Boolean);
    const head = meta.length ? `${issue.summary} (${meta.join(', ')})` : issue.summary;
    const label = action ? `${head} — ${action.label}` : head;

    // The card is a group, not a button: its message can itself be a button, and a control
    // inside a control is neither valid ARIA nor navigable. Pointer clicks still activate the
    // whole card; keyboard users reach the same action through `.issue__go`.
    return html`<div
      class="issue ${action ? 'issue--action' : ''}"
      title=${label}
      role="group"
      aria-label=${label}
      @click=${action ? () => this._activate(action) : null}
    >
      <span class="issue__rail" style="background-color: ${railColor(issue)}"></span>
      <vscode-icon
        name=${SEVERITY_META[issue.severity].icon}
        size="16"
        style="color: ${SEVERITY_META[issue.severity].color}"
      ></vscode-icon>
      <div class="issue__body">
        <div class="issue__head">
          <span class="issue__summary issue__clamp">${issue.summary}</span>
          ${
            action
              ? // action-icon is a real button, so it focuses and takes Enter/Space natively. No
                // handler of its own: its click bubbles to the card's, so pointer and keyboard
                // activation run the one action exactly once.
                html`<div class="issue__actions">
                  <vscode-icon
                    class="issue__go"
                    action-icon
                    name=${action.icon ?? 'arrow-right'}
                    label=${action.label}
                    title=${action.label}
                    size="16"
                  ></vscode-icon>
                </div>`
              : ''
          }
        </div>
        ${
          meta.length
            ? // No issue__clamp/data-index here: _measure() must only ever see messages.
              html`<div class="issue__meta">
                ${issue.label ? html`<span class="issue__label">${issue.label}</span>` : ''}
                ${issue.label && time ? html`<span>·</span>` : ''}
                ${time ? html`<span>${time}</span>` : ''}
              </div>`
            : ''
        }
        ${this._message(issue, index)}
      </div>
    </div>`;
  }

  /**
   * The message, as a toggle button only while it has more to show — a message that fits must
   * not advertise a click that would do nothing.
   */
  private _message(issue: LogIssue, index: number): TemplateResult | '' {
    if (!issue.message) {
      return '';
    }

    const expanded = this._expanded.has(index);
    const clamp = expanded ? '' : 'issue__clamp';

    return this._clipped.has(index)
      ? html`<button
          class="issue__message ${clamp}"
          type="button"
          data-index=${index}
          title=${expanded ? 'Show less' : 'Show more'}
          aria-expanded=${expanded}
          @click=${(event: Event) => this._toggle(event, index)}
          >${issue.message}</button
        >`
      : html`<span class="issue__message ${clamp}" data-index=${index}>${issue.message}</span>`;
  }

  /**
   * Runs the card's action, unless the click ended a text selection — a stack trace is there to
   * be read and copied, and selecting one must not navigate away from it.
   */
  private _activate(action: NonNullable<LogIssue['action']>): void {
    if (!isCollapsed(shadowSelection(this.shadowRoot) ?? document.getSelection())) {
      return;
    }

    action.run();
  }

  /** Toggling the message must not activate the card it sits inside. */
  private _toggle(event: Event, index: number): void {
    event.stopPropagation();
    const expanded = new Set(this._expanded);
    if (!expanded.delete(index)) {
      expanded.add(index);
    }
    this._expanded = expanded;
  }
}

/**
 * The timeline's colour for this issue where it draws one, else its severity token —
 * parser notifications and read failures appear on no timeline.
 */
function railColor(issue: LogIssue): string {
  return issue.category ? markerColorCss(issue.category) : SEVERITY_META[issue.severity].color;
}

/**
 * The selection inside a shadow root, where the browser exposes one. `document.getSelection()`
 * can't see into shadow DOM, so Chromium (which is all a webview runs on) adds this — it just
 * isn't in the DOM lib yet.
 */
function shadowSelection(root: ShadowRoot | null): Selection | null {
  const getSelection = (root as unknown as { getSelection?: () => Selection | null } | null)
    ?.getSelection;

  return getSelection ? getSelection.call(root) : null;
}

function isCollapsed(selection: Selection | null): boolean {
  return !selection || selection.isCollapsed;
}

function sameSet(a: ReadonlySet<number>, b: ReadonlySet<number>): boolean {
  return a.size === b.size && [...a].every((value) => b.has(value));
}
