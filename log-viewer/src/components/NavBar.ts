/*
 * Copyright (c) 2023 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-toolbar-button.js';
import { LitElement, css, html, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { eventBus } from '../core/events/EventBus.js';
import { formatDuration } from '../core/utility/Util.js';
import type { LogIdentityData } from '../features/app/logIdentity.js';
import type { LogIssue } from '../features/notifications/types.js';
import { computeVisibleCount } from './overflowFit.js';

// styles
import { globalStyles } from '../styles/global.styles.js';
import { menuRowStyles } from '../styles/menuRow.styles.js';

// web components
import '../features/notifications/components/IssueList.js';
import '../features/notifications/components/NotificationCentre.js';
import './Divider.js';
import './DotSeparator.js';
import './HeaderMenu.js';
import './LogIdentity.js';
import './LogMeta.js';
import './LogProblemsChip.js';
import './LogTitle.js';

/**
 * The identity chunks in keep order (the last row sheds first), tying each chunk to
 * its `LogIdentityData` field and its compact-label widths. `CHUNKS`, the render
 * loop, `_chunkActive`, and the title tooltip all derive from this, so adding an
 * item is one row here.
 */
const IDENTITY_CHUNKS = [
  { chunk: 'entry', field: 'entryPoint', cap: '24ch', skeletonWidth: '12ch' },
  { chunk: 'user', field: 'user', cap: '16ch', skeletonWidth: '8ch' },
  { chunk: 'time', field: 'startTime', cap: '', skeletonWidth: '8ch' },
] as const satisfies readonly {
  chunk: string;
  field: keyof LogIdentityData;
  cap: string;
  skeletonWidth: string;
}[];

/**
 * What the header sheds as it narrows, in the order it *keeps* them: the transaction
 * identity goes first, one item at a time from the right — time, then user, then entry
 * point (losing "when" before "who" before "what") — then log meta (all passive info
 * whose values survive in the title's tooltip), then the bell (tool-level, usually
 * empty), then the Inspector toggle (also on the command palette, and the docked panel
 * is visible either way), and log problems last — the only signal that can invalidate
 * the whole analysis. Shed controls reappear inside `•••`; shed values survive in the
 * title's tooltip.
 */
const CHUNKS = [
  'problems',
  'inspector',
  'bell',
  'meta',
  ...IDENTITY_CHUNKS.map(({ chunk }) => chunk),
] as const;
type Chunk = (typeof CHUNKS)[number];

/**
 * Allowed per chunk on top of its measured width, for the gap its group puts before it.
 * The right-hand group's gap is smaller, so those chunks are over-reserved by 2px —
 * erring toward collapsing a beat early rather than toward clipping.
 */
const CHUNK_GAP = 6;

/**
 * Used until `log-title` has been laid out and its real floor can be read. `16ch` in the
 * default font; measured rather than trusted, so the two can't drift.
 */
const TITLE_FLOOR_FALLBACK = 140;

@customElement('nav-bar')
export class NavBar extends LitElement {
  @property()
  logName = '';

  @property()
  logPath = '';

  @property()
  logSize: number | null = null;

  @property()
  logDuration: number | null = null;

  /** Problems found in the log. `null` while it is still parsing. */
  @property({ attribute: false })
  logProblems: readonly LogIssue[] | null = null;

  /** Notifications about the tool — today, parser diagnostics. */
  @property({ attribute: false })
  notifications: readonly LogIssue[] = [];

  /** Transaction identity (entry point · user · start time). `null` while parsing. */
  @property({ attribute: false })
  logIdentity: LogIdentityData | null = null;

  /** How many leading `CHUNKS` stay in the header; the rest are in the `•••` menu. */
  @state()
  private _visible: number = CHUNKS.length;

  /**
   * Natural width per chunk, measured while it is inline. Cached rather than
   * re-measured because a collapsed chunk has no box to measure — and so the cache is
   * dropped whenever content that can change a width arrives, see {@link willUpdate}.
   */
  private _widths = new Map<Chunk, number>();
  private _menuWidth = 0;
  private _hostWidth = 0;
  private _titleFloor = TITLE_FLOOR_FALLBACK;
  private _resizeObserver: ResizeObserver | null = null;

  static styles = [
    globalStyles,
    menuRowStyles,
    css`
      :host {
        display: flex;
        flex-direction: column;
        justify-content: center;
        /* VS Code's side-bar/panel title height, so this row reads as a title bar rather
           than as content pressed against the top edge (and the count badges have room). */
        min-height: 35px;
        color: var(--lana-editor-fg);
      }

      .navbar {
        display: flex;
        /* Wide enough to read as a gap: the count badge overhangs its control by 3px. */
        gap: 16px;
        justify-content: space-between;
        font-family: var(--lana-font-ui);
        align-items: center;
        min-width: 0;
      }

      .navbar--left {
        display: flex;
        align-items: center;
        gap: 6px;
        min-width: 0;
        flex: 1 1 auto;
      }

      /* Cancel log-title's inner 6px so its text sits on the shared header left guide
         (the hover background keeps its padding). */
      .navbar--left > log-title {
        margin-left: -6px;
      }

      .navbar--right {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: 0 0 auto;
      }

      /* A collapsible unit, measured as one box. Never shrinks: a squeezed chunk would
         measure narrower than it needs and the ladder would oscillate. */
      .chunk {
        display: flex;
        align-items: center;
        gap: 6px;
        flex: 0 0 auto;
      }

      .menu-collapsed {
        display: flex;
        flex-direction: column;
        gap: 4px;
      }

      .menu-section__label {
        padding: 4px 8px 2px;
        font-size: var(--lana-text-sm);
        font-weight: 600;
        color: var(--lana-fg-muted);
      }

      .menu-section__empty {
        padding: 2px 8px 4px;
        font-size: var(--lana-text-base);
        color: var(--lana-fg-muted);
      }
    `,
  ];

  override connectedCallback(): void {
    super.connectedCallback();
    this._resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      // Zero width means we're hidden, not narrow — keep the current layout.
      if (width > 0) {
        this._hostWidth = width;
        this._fit();
      }
    });
    this._resizeObserver.observe(this);
  }

  override disconnectedCallback(): void {
    this._resizeObserver?.disconnect();
    this._resizeObserver = null;
    super.disconnectedCallback();
  }

  /**
   * A new log can widen a chunk — a badge gaining a digit, or log meta replacing its
   * skeleton — and a collapsed chunk has no box to re-measure. So content changes reset
   * the ladder to fully inline and discard the cache; `updated` then re-measures every
   * chunk from its real box and re-settles.
   */
  override willUpdate(changed: PropertyValues<this>): void {
    if (
      changed.has('logSize') ||
      changed.has('logDuration') ||
      changed.has('logProblems') ||
      changed.has('notifications') ||
      changed.has('logIdentity')
    ) {
      this._widths.clear();
      this._visible = CHUNKS.length;
    }
  }

  /** Re-fit after content changes: a new log can change a badge's width. */
  override updated(): void {
    this._fit();
  }

  render() {
    const sizeText = this._toSize(this.logSize),
      elapsedText = this._formatDuration(this.logDuration);
    // Derived from CHUNKS rather than restated, so re-ordering the ladder is one edit.
    const show = Object.fromEntries(CHUNKS.map((chunk, i) => [chunk, i < this._visible])) as Record<
      Chunk,
      boolean
    >;
    const collapsed = this._collapsedSections(show);

    return html`
      <div class="navbar">
        <div class="navbar--left">
          <log-title
            logName="${this.logName}"
            logPath="${this.logPath}"
            details="${[
              sizeText,
              elapsedText,
              ...IDENTITY_CHUNKS.map(({ field }) => this.logIdentity?.[field]?.detail),
            ]
              .filter(Boolean)
              .join(' • ')}"
          ></log-title>
          ${
            show.meta
              ? html`<div class="chunk chunk--meta">
                  <dot-separator></dot-separator>
                  <log-meta logFileSize="${sizeText}" logDuration="${elapsedText}"></log-meta>
                </div>`
              : ''
          }
          ${IDENTITY_CHUNKS.map(({ chunk, field, cap, skeletonWidth }) =>
            show[chunk] && this._chunkActive(chunk)
              ? html`<div class="chunk chunk--${chunk}">
                  <dot-separator></dot-separator>
                  <log-identity
                    .item=${this.logIdentity?.[field] ?? null}
                    cap=${cap}
                    skeletonWidth=${skeletonWidth}
                  ></log-identity>
                </div>`
              : '',
          )}
          ${
            show.problems
              ? html`<div class="chunk chunk--problems">
                  <divider-line orientation="vertical"></divider-line>
                  <log-problems .issues="${this.logProblems}"></log-problems>
                </div>`
              : ''
          }
        </div>
        <div class="navbar--right">
          ${
            show.inspector
              ? html`<div class="chunk chunk--inspector">
                  <vscode-toolbar-button
                    icon="layout-sidebar-right"
                    label="Toggle Inspector"
                    title="Toggle Inspector"
                    @click=${this._toggleInspector}
                  ></vscode-toolbar-button>
                </div>`
              : ''
          }
          ${
            show.bell
              ? html`<div class="chunk chunk--bell">
                  <divider-line orientation="vertical"></divider-line>
                  <notification-centre .issues=${this.notifications}></notification-centre>
                </div>`
              : ''
          }
          <header-menu .marker=${this._collapsedMarker(show)} .collapsedCount=${collapsed.length}>
            ${
              collapsed.length
                ? html`<div slot="collapsed" class="menu-collapsed">
                    ${collapsed.map((section, i) =>
                      i ? html`<divider-line></divider-line>${section}` : section,
                    )}
                  </div>`
                : ''
            }
          </header-menu>
        </div>
      </div>
    `;
  }

  /**
   * Which chunks fit. The stage is a pure function of the host width, so it can't flap:
   * `computeVisibleCount` counts the leading (highest-priority) chunks that fit once the
   * title's floor and the always-present `•••` are set aside. Gaps are already folded
   * into the cached widths.
   */
  private _fit(): void {
    if (!this._hostWidth) {
      return;
    }

    this._measure();
    // An inactive chunk renders nothing: it costs the ladder no width, and its zero
    // width is legitimate rather than "not measured yet".
    const active = CHUNKS.map((chunk) => this._chunkActive(chunk));
    const widths = CHUNKS.map((chunk, i) => (active[i] ? (this._widths.get(chunk) ?? 0) : 0));
    // Nothing measured yet (first paint, or the webview is hidden) — leave the layout be.
    if (widths.some((width, i) => width === 0 && active[i])) {
      return;
    }

    const avail = this._hostWidth - this._titleFloor - this._menuWidth;
    // `_fit` also runs from `updated`, so this must settle: an unchanged stage is not a
    // change, so lit schedules nothing and the loop stops.
    this._visible = computeVisibleCount(widths, avail, 0, 0);
  }

  /**
   * Whether a chunk currently has anything to show. The identity chunks are the only
   * optional ones: each stays active while the log parses (skeleton) and goes inactive
   * when the parsed log carries no value for it (e.g. a cropped log with no USER_INFO).
   */
  private _chunkActive(chunk: Chunk): boolean {
    const field = IDENTITY_CHUNKS.find((identity) => identity.chunk === chunk)?.field;
    return !field || this.logIdentity === null || Boolean(this.logIdentity[field]);
  }

  private _measure(): void {
    const root = this.shadowRoot;
    if (!root) {
      return;
    }

    for (const chunk of CHUNKS) {
      const width = root.querySelector<HTMLElement>(`.chunk--${chunk}`)?.offsetWidth ?? 0;
      if (width > 0) {
        this._widths.set(chunk, width + CHUNK_GAP);
      }
    }

    const menuWidth = root.querySelector<HTMLElement>('header-menu')?.offsetWidth ?? 0;
    if (menuWidth > 0) {
      this._menuWidth = menuWidth + CHUNK_GAP;
    }

    // The floor belongs to log-title's stylesheet; read it rather than restate it in px
    // here, where a font change or a `ch` tweak would silently desync the ladder.
    const title = root.querySelector('log-title');
    const floor = title ? parseFloat(getComputedStyle(title).minWidth) : NaN;
    if (floor > 0) {
      this._titleFloor = floor;
    }
  }

  /**
   * Collapsed controls go into the menu as content, not as their own popover triggers:
   * a trigger inside an open popover means nesting native popovers and clicking twice.
   */
  private _collapsedSections(show: Record<Chunk, boolean>): TemplateResult[] {
    const sections: TemplateResult[] = [];

    if (!show.bell) {
      sections.push(
        this._issueSection('Notifications', this.notifications, 'Log parsed with no issues'),
      );
    }
    if (!show.inspector) {
      sections.push(
        html`<button class="filter-popover-row menu-row" @click=${this._toggleInspector}>
          <vscode-icon name="layout-sidebar-right" size="16"></vscode-icon>
          <span>Toggle Inspector</span>
        </button>`,
      );
    }
    if (!show.problems && this.logProblems) {
      sections.push(
        this._issueSection('Log problems', this.logProblems, 'No problems found in this log'),
      );
    }

    return sections;
  }

  private _issueSection(
    label: string,
    issues: readonly LogIssue[],
    emptyMessage: string,
  ): TemplateResult {
    return html`<div class="menu-section">
      <div class="menu-section__label"
        >${issues.length ? `${label} (${issues.length})` : label}</div
      >
      ${
        issues.length
          ? html`<issue-list .issues=${issues}></issue-list>`
          : html`<div class="menu-section__empty">${emptyMessage}</div>`
      }
    </div>`;
  }

  /**
   * The dot on `•••` stands in for whichever counts have left the header. Presence only,
   * not severity: header chrome carries no severity colour.
   */
  private _collapsedMarker(show: Record<Chunk, boolean>): boolean {
    return (
      (!show.bell && this.notifications.length > 0) ||
      (!show.problems && (this.logProblems?.length ?? 0) > 0)
    );
  }

  private _toggleInspector(): void {
    eventBus.emit('detail:toggle', {});
  }

  _formatDuration(duration: number | null) {
    if (!duration && duration !== 0) {
      return '';
    }

    return formatDuration(duration);
  }

  _toSize(fileSize: number | null) {
    if (!fileSize && fileSize !== 0) {
      return '';
    }

    return parseFloat((fileSize / 1_000_000).toFixed(2)) + ' MB';
  }
}
