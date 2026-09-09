/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import '#vscode-elements/vscode-icon.js';
import { consume } from '@lit/context';
import { LitElement, css, html, nothing, type PropertyValues, type TemplateResult } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import {
  aggregateVariablesFor,
  cachedAggregateVariables,
  MAX_MARKED_PER_VALUE,
  MAX_VALUES_PER_NAME,
  type AggregateVariables,
  type SpreadValue,
  type VariableSpread,
} from '../core/log/aggregateVariables.js';
import {
  frameVariablesFor,
  recordsVariables,
  variableIndexFor,
  type FrameVariables,
  type VariableIndex,
} from '../core/log/frameVariables.js';
import { logContext } from '../core/log/logContext.js';
import type { LogStore } from '../core/log/LogStore.js';
import { previewOf, RAW_CLAMP_CHARS, type VariableValue } from '../core/log/variableValue.js';
import { formatInteger } from '../core/utility/Util.js';
import { globalStyles } from '../styles/global.styles.js';
import { inspectorSectionStyles } from '../styles/inspectorSection.styles.js';
import { bleedRowStyles } from '../styles/revealRow.styles.js';
import { dispatchInspectorLocate } from './inspectorReveal.js';
import {
  parentOf,
  toSpreadRows,
  toTreeRows,
  type Lookups,
  type Shown,
  type VariableTreeRow,
} from './variableTree.js';

// web components
import './CodeBlock.js';

/** Any row that shows a value: a variable, a property, or the `this` group. */
type Valued = Shown & { open: boolean };

/**
 * What Apex could reach from the selected frame: its locals, its instance fields
 * and the statics, each value as the frame saw it.
 *
 * Only the log's own text is shown. A value is never re-serialised, so a
 * duplicate Map key, a truncation marker and an `{}` the log wrote all reach the
 * screen as the log wrote them. The log records one level, so one level opens.
 *
 * A keyboard tree: the arrow keys walk every row, the properties inside an
 * opened value included.
 */
@customElement('variables-detail')
export class VariablesDetail extends LitElement {
  @property({ type: Number })
  eventIndex = -1;

  /** The frames a merged row is, where the selection is one: the scope every
   *  call it counts held. Null for a single frame, which `eventIndex` names. */
  @property({ attribute: false })
  frames: number[] | null = null;

  /** The log on screen, from the app root. */
  @consume({ context: logContext, subscribe: true })
  @property({ attribute: false })
  logStore: LogStore | null = null;

  @state()
  private _index: VariableIndex | null = null;

  /** What the selected calls held, compared, or null while the walk runs. */
  @state()
  private _spread: AggregateVariables | null = null;

  /** The frames `_spread` describes, so a render for any other reason does not
   *  walk again, and a new selection does. */
  private _spreadKey?: readonly number[] | null;

  /** The comparison in flight; a new selection aborts it, and so does a
   *  disconnect. */
  private _walk: AbortController | null = null;

  /** Which rows the user has opened or closed, by their stable id, so disclosure
   *  survives walking the call stack. */
  @state()
  private _disclosure: ReadonlyMap<string, boolean> = new Map();

  /** The row holding the tab stop. One tab stop for the whole tree, as the tree
   *  pattern wants: the arrows move within it. */
  @state()
  private _focused: string | null = null;

  /** The whole-log walk threw, so there is nothing to read and nothing to
   *  retry from here: the section says so instead of reading forever. */
  @state()
  private _readError = false;

  /** The rows on screen, kept so a key finds the next one without walking the
   *  DOM. */
  private _rows: readonly VariableTreeRow[] = [];

  /** Row id to its place in {@link _rows}, so a key is a lookup. */
  private _at: ReadonlyMap<string, number> = new Map();

  /** A row on screen shows an object read through an address, so the reading is
   *  one call's. Fixed by {@link _rows}, so render never rescans them. */
  private _resolved = false;

  /** A value in the comparison holds more calls than its mark can name. Read
   *  from the spread, not the rows: a closed name would hide it. */
  private _partlyMarked = false;

  /** The scope as read for the current selection.
   *
   *  Read once per selection, never per render: reading it back through a frame
   *  of hundreds of thousands of lines costs tens of ms, and opening a row must
   *  not pay that again. */
  private _frame: FrameVariables | null = null;

  /** One index view per point the section reads at: one for a frame, one per
   *  compared value's own call. Every row is built again whenever anything
   *  opens, so the views are held rather than remade. */
  private _views = new Map<number, Lookups>();

  /** Set when a key moved the tab stop, so `updated` moves focus with it. */
  private _takeFocus = false;

  static styles = [
    globalStyles,
    inspectorSectionStyles,
    bleedRowStyles,
    css`
      .tree {
        display: flex;
        flex-direction: column;
      }

      /* One row is one line at any width: the name holds, the value gives way.
         Depth is a variable, so every row shares one indent step. */
      .row {
        display: flex;
        align-items: center;
        gap: var(--lana-space-2xs);
        padding-left: calc(var(--depth, 0) * var(--lana-space-md));
      }

      .lead {
        display: flex;
        align-items: baseline;
        gap: var(--lana-space-2xs);
        flex: 1 1 auto;
        min-width: 0;
      }

      .chevron {
        flex: 0 0 auto;
        align-self: center;
        color: var(--lana-fg-muted);
        transition: transform 150ms ease-out;
      }

      .row[aria-expanded='true'] > .chevron {
        transform: rotate(90deg);
      }

      /* A row that opens on nothing still takes the chevron's width, so every
         name at one depth starts on the same edge. */
      .chevron-gap {
        flex: 0 0 auto;
        width: var(--lana-space-md);
      }

      .group-name {
        flex: 0 0 auto;
        font-weight: 600;
      }

      /* Whose frame, or whose class: metadata, so it gives way before the name. */
      .group-of,
      .type {
        min-width: 0;
        overflow: hidden;
        color: var(--lana-fg-muted);
        font-family: var(--lana-font-mono);
        font-size: var(--lana-text-sm);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .group-of {
        flex: 0 1 auto;
      }

      .type {
        flex: 0 0 auto;
        margin-left: auto;
      }

      .name {
        flex: 0 0 auto;
        font-family: var(--lana-font-mono);
      }

      /* The value is the log's own text: truncated rather than wrapped, so one
         variable stays one row. */
      .value {
        flex: 1 1 auto;
        min-width: 0;
        overflow: hidden;
        color: var(--lana-fg-muted);
        font-family: var(--lana-font-mono);
        font-variant-numeric: tabular-nums;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      /* The log wrote no value here, and its absence is the reading: the name
         was declared and never written, or the object was only ever an address. */
      .missing {
        flex: 0 0 auto;
        color: var(--lana-fg-muted);
        font-size: var(--lana-text-sm);
        font-style: italic;
      }

      .key {
        flex: 0 0 auto;
        color: var(--lana-fg-muted);
        font-family: var(--lana-font-mono);
      }

      /* The object's class leads its value, as Chrome does it: what the object
         *is* carries more than the muted text describing it. */
      .cls {
        color: var(--lana-fg);
      }

      /* Where the value was only an address, the object it names leads and the
         address trails it, so the row reads as the object with its provenance. */
      .ref {
        flex: 0 0 auto;
        color: var(--lana-fg-muted);
        font-family: var(--lana-font-mono);
        font-size: var(--lana-text-sm);
      }

      .count {
        flex: 0 0 auto;
        min-width: 1.4em;
        border-radius: var(--lana-radius-md);
        padding: 0 var(--lana-space-2xs);
        background-color: var(--lana-badge-bg);
        color: var(--lana-badge-fg);
        font-size: var(--lana-text-sm);
        font-variant-numeric: tabular-nums;
        text-align: center;
      }

      /* What the log said about the value rather than the value itself. */
      .chip {
        flex: 0 0 auto;
        border: var(--lana-stroke) solid var(--lana-surface-border);
        border-radius: var(--lana-radius-md);
        padding: 0 var(--lana-space-2xs);
        color: var(--lana-fg-muted);
        font-size: var(--lana-text-sm);
      }

      .row.is-note {
        color: var(--lana-fg-muted);
        cursor: default;
      }

      code-block {
        min-width: 0;
        flex: 1 1 auto;
      }
    `,
  ];

  /** The selection merges calls, so the section compares them rather than
   *  reading one frame. */
  private get _isAggregate(): boolean {
    return (this.frames?.length ?? 0) > 1;
  }

  /**
   * The frame one reading is of.
   *
   * A merged row that comes down to a single frame is that frame, never the
   * calls it counts: a bottom-up caller row counts its callee's calls, so
   * `eventIndex` names one of those and reading it would show the called
   * method's scope under a row that names the caller.
   */
  private get _readIndex(): number {
    return this.frames?.length === 1 ? this.frames[0]! : this.eventIndex;
  }

  /** The index, but only once the log has a write in it. A log captured at
   *  FINEST can still record none, and reading every call to find that out
   *  costs seconds; one derivation, so the note and the walk cannot disagree. */
  private get _readable(): VariableIndex | null {
    return this._index?.sawAnyWrite ? this._index : null;
  }

  override willUpdate(changed: PropertyValues): void {
    // Only what the selection is made of, so a disclosure or a key does not
    // re-read the log.
    const reselected =
      changed.has('eventIndex') ||
      changed.has('frames') ||
      changed.has('logStore') ||
      changed.has('_index');
    if (reselected) {
      this._views.clear();
      // An aggregate answers with none of these: reading the frame back through
      // it costs tens of ms on a huge frame, and render() would throw it away
      // unread.
      this._frame =
        !this._isAggregate && this.logStore && this._index
          ? frameVariablesFor(this.logStore, this._readIndex, this._index)
          : null;
      // The comparison is resolved here, not in `updated`: a walk that runs a
      // step later would let this pass rebuild and render the *previous* row's
      // spread first, and repopulate the views with its cuts.
      this._spread = this._compareKey() ? this._held() : null;
    }
    // A key press moves the tab stop and nothing else, so the rows it walks are
    // rebuilt only when the scope or what is open changes.
    if (reselected || changed.has('_spread') || changed.has('_disclosure')) {
      this._rebuild();
    }
  }

  /** The frames to compare, or null where the section reads one frame or the
   *  log records nothing to compare. */
  private _compareKey(): readonly number[] | null {
    return this._isAggregate && this.logStore && this._readable ? this.frames : null;
  }

  /** A comparison already walked, so a re-selection shows no placeholder. */
  private _held(): AggregateVariables | null {
    const frames = this._compareKey();
    return frames ? (cachedAggregateVariables(frames) ?? null) : null;
  }

  /** The rows on screen, and where each one sits, from the scope and what is
   *  open. Scanning a value is the cost here, so it is paid once. */
  private _rebuild(): void {
    const isOpen = (id: string, byDefault: boolean): boolean =>
      this._disclosure.get(id) ?? byDefault;
    const frame = this._frame;
    this._rows = this._isAggregate
      ? // Read through what is held: a walk that has yet to answer shows its
        // placeholder, never the last row's spread.
        this._spread
        ? toSpreadRows(this._spread, isOpen, (cut) => this._viewAt(cut))
        : []
      : frame
        ? toTreeRows(frame, isOpen, this._viewAt(frame.cut))
        : [];
    this._at = new Map(this._rows.map((row, at) => [row.id, at]));
    // Fixed here, so neither is rescanned on every render.
    this._resolved = this._rows.some((row) => 'resolved' in row && row.resolved);
    const spread = this._spread;
    this._partlyMarked =
      (spread?.locals.some(partlyMarked) || spread?.fields.some(partlyMarked)) ?? false;
  }

  disconnectedCallback(): void {
    super.disconnectedCallback();
    // Comparing on into a detached host wastes frames and answers nobody.
    this._walk?.abort();
  }

  /** The log bound to one point in it, held per point. */
  private _viewAt(cut: number): Lookups {
    let held = this._views.get(cut);
    if (!held) {
      held = this._index?.viewAt(cut) ?? {};
      this._views.set(cut, held);
    }
    return held;
  }

  override updated(changed: PropertyValues): void {
    if (changed.has('logStore')) {
      this._index = null;
      this._readError = false;
      this._disclosure = new Map();
      this._focused = null;
      this._spreadKey = undefined;
      this._spread = null;
      void this._read();
    }
    // Comparing reads every call, so only a changed selection - or one we have
    // yet to resolve - earns the walk.
    if (changed.has('frames') || changed.has('_index') || this._spreadKey === undefined) {
      void this._compare();
    }
    if (this._takeFocus) {
      this._takeFocus = false;
      // By place, not by id: an id embeds names the log wrote, and rows render
      // in `_rows` order, so the place is exact and needs no escaping.
      const at = this._focused !== null ? this._at.get(this._focused) : undefined;
      if (at !== undefined) {
        this.renderRoot.querySelectorAll<HTMLElement>('.row')[at]?.focus();
      }
    }
  }

  render() {
    const log = this.logStore?.log;
    if (!log) {
      return nothing;
    }
    if (!recordsVariables(log)) {
      return note('Variables available with the Apex Code log level at FINEST.');
    }
    if (this._readError) {
      return note('Could not read the log for variables.');
    }
    if (!this._index) {
      return note('Reading the log…');
    }
    // A log can be captured at FINEST and still record no write, so this is not
    // the same as a frame that had nothing in scope.
    const index = this._readable;
    if (!index) {
      return note('This log records no variable assignments.');
    }
    return this._isAggregate ? this._spreadTree(index) : this._frameTree(index);
  }

  /** One frame: its locals, its object's fields and the statics in scope. */
  private _frameTree(index: VariableIndex): TemplateResult {
    const frame = this._frame;
    if (!frame || !this._rows.length) {
      return note('The log records no variables in scope here.');
    }
    return this._tree([frame.truncated && TRUNCATED_NOTE, index.capped && HELD_NOTE]);
  }

  /**
   * A merged row: what its calls held, compared. Which name varied is the
   * reading, and every value it lists names the calls that held it.
   */
  private _spreadTree(index: VariableIndex): TemplateResult {
    const spread = this._spread;
    if (!spread) {
      return note(`Comparing ${callsHeld(this.frames?.length ?? 0)}…`);
    }
    return this._tree([
      spread.truncated && TRUNCATED_NOTE,
      index.capped && HELD_NOTE,
      spread.capped && `Over ${formatInteger(MAX_VALUES_PER_NAME)} values, so some are not listed.`,
      this._partlyMarked &&
        `A value held by over ${formatInteger(MAX_MARKED_PER_VALUE)} calls marks that many of them.`,
      this._resolved && RESOLVED_NOTE,
      STATICS_NOTE,
    ]);
  }

  /** The rows, under whatever the scope has to say about them. */
  private _tree(notes: readonly (string | false)[]): TemplateResult {
    // The tab stop follows the tree: a row that has gone hands it back.
    const focused =
      this._focused !== null && this._at.has(this._focused)
        ? this._focused
        : (this._rows[0]?.id ?? null);

    return html`
      ${notes.map((text) => (text ? note(text) : ''))}
      <div class="tree" role="tree" aria-label="Variables in scope" @keydown=${this._onKeyDown}>
        ${this._rows.map((row) => this._render(row, row.id === focused))}
      </div>
    `;
  }

  /** Builds the index, which is the only walk of the whole log. */
  private async _read(): Promise<void> {
    const log = this.logStore?.log;
    if (!log || !recordsVariables(log)) {
      return;
    }
    try {
      const index = await variableIndexFor(log);
      // The log may have changed while the walk ran.
      if (this.logStore?.log === log) {
        this._index = index;
      }
    } catch {
      // Left "Reading the log…" forever otherwise, with no error shown and no
      // way to retry.
      if (this.logStore?.log === log) {
        this._readError = true;
      }
    }
  }

  /**
   * Compares the selected calls in frame-sized slices, so a wide selection never
   * blocks the panel, and abandons a walk the selection has moved past.
   */
  private async _compare(): Promise<void> {
    const store = this.logStore;
    const index = this._readable;
    const frames = this._compareKey();
    if (frames === this._spreadKey) {
      return;
    }
    this._spreadKey = frames;
    this._walk?.abort();
    const walk = (this._walk = new AbortController());
    if (!frames || !store || !index) {
      return;
    }
    // `willUpdate` already answered from the memo, so only an unwalked
    // selection reaches the walk.
    if (this._spread) {
      return;
    }
    const spread = await aggregateVariablesFor(store, frames, index, { signal: walk.signal });
    if (this._walk !== walk) {
      return;
    }
    if (spread) {
      this._spread = spread;
    } else {
      // Abandoned while the selection still stands - a disconnected host. Forget
      // the key, so a later render compares again instead of waiting on a dead
      // walk.
      this._spreadKey = undefined;
    }
  }

  private _render(row: VariableTreeRow, focused: boolean): TemplateResult {
    // A note is prose about the row above it, so it is read but never opened.
    const isNote = row.kind === 'note';
    return html`<div
      class="row ${isNote ? 'is-note' : 'bleed-row'}"
      data-id=${row.id}
      style="--depth:${row.depth}"
      role=${isNote ? 'none' : 'treeitem'}
      aria-level=${row.depth + 1}
      aria-expanded=${row.expandable ? String(row.open) : nothing}
      tabindex=${isNote ? nothing : focused ? 0 : -1}
      @click=${() => this._pick(row)}
      @pointerenter=${() => this._hover(row, true)}
      @pointerleave=${() => this._hover(row, false)}
    >
      ${row.expandable ? CHEVRON : html`<span class="chevron-gap"></span>`}${this._body(row)}
    </div>`;
  }

  private _body(row: VariableTreeRow): TemplateResult | string {
    switch (row.kind) {
      case 'group':
        return html`<span class="lead">
            <span class="group-name">${row.name}</span>
            ${row.of ? html`<span class="group-of" title=${row.of}>${row.of}</span>` : ''}
            ${row.self ? this._value({ ...row.self, open: row.open }, row.self.declaredType) : ''}
          </span>
          <span class="count">${row.count}</span>
          ${typeColumn(row.self?.declaredType ?? null)}`;
      case 'class':
        return html`<span class="lead">
            <span class="name" title=${row.className}>${row.className}</span>
          </span>
          <span class="count">${row.count}</span>`;
      case 'variable':
        return this._variable(row);
      case 'spread':
        return this._agreed(row);
      case 'spread-many':
        return this._varied(row);
      case 'spread-value':
        return html`<span class="lead">${this._value(row, null)}</span>
          ${runsChip(row.held)}
          <span class="count" title=${`${callsHeld(row.held.calls)} of ${callsHeld(row.of)}`}
            >${formatInteger(row.held.calls)}</span
          >`;
      case 'entry':
        return html`<span class="lead">
            <span class="key">${row.key === null ? '·' : `${row.key}:`}</span>
            ${this._value(row, null)}
          </span>
          ${partCount(row)}${chipFor(row.value)}`;
      case 'text':
        return html`<code-block language="plain" code=${row.raw}></code-block>`;
      case 'note':
        return html`<span>${row.text}</span>`;
    }
  }

  private _variable(row: Extract<VariableTreeRow, { kind: 'variable' }>): TemplateResult {
    const variable = row.row;
    return html`<span class="lead">
        <span class="name">${variable.assigned ? `${variable.name}:` : variable.name}</span>
        ${
          variable.assigned
            ? this._value(row, variable.declaredType)
            : html`<span class="missing">not assigned</span>`
        }
      </span>
      ${partCount(row)}${chipFor(row.value)}${typeColumn(variable.declaredType)}`;
  }

  /** A name every call agreed on: the value itself, so it reads and opens
   *  exactly as a single frame's row does. */
  private _agreed(row: Extract<VariableTreeRow, { kind: 'spread' }>): TemplateResult {
    const { name, declaredType } = row.row;
    return html`<span class="lead">
        <span class="name">${name}:</span>
        ${this._value(row, declaredType)}
      </span>
      ${partCount(row)}${chipFor(row.value)}${this._spreadCounts(row.row)}${typeColumn(
        declaredType,
      )}`;
  }

  /** A name the calls disagreed on: how many values they held, opening on them. */
  private _varied(row: Extract<VariableTreeRow, { kind: 'spread-many' }>): TemplateResult {
    const { name, declaredType, values, capped } = row.row;
    return html`<span class="lead">
        <span class="name">${name}</span>
        ${
          values.length
            ? html`<span class="value"
                >${capped ? `over ${formatInteger(MAX_VALUES_PER_NAME)}` : formatInteger(values.length)}
                values</span
              >`
            : html`<span class="missing" title="Every call declared it and never wrote it."
                >not assigned</span
              >`
        }
      </span>
      ${this._spreadCounts(row.row)}${typeColumn(declaredType)}`;
  }

  /** What the calls did with a name, beside the value: how many had it in scope,
   *  and how many declared it and never wrote it. */
  private _spreadCounts(spread: VariableSpread): TemplateResult {
    const { calls, unassigned, values } = spread;
    return html`${
        // Assigned by some calls and not by others, which neither the value nor
        // the count says.
        unassigned && values.length
          ? html`<span class="chip" title="Calls that declared it and never wrote it"
              >${formatInteger(unassigned)} unassigned</span
            >`
          : ''
      }<span class="count" title=${callsHeld(calls)}>${formatInteger(calls)}</span>`;
  }

  /**
   * A value, and where it came from.
   *
   * One rule for an address: where the row's own text was only an address, that
   * address trails the row, every time. What leads is the object the log
   * recorded for it, or why it could not.
   *
   * Open, the rows below carry the value, so a preview here as well would print
   * the same value twice.
   */
  private _value(row: Valued, declaredType: string | null): TemplateResult {
    const missing = this._missing(row);
    return html`${this._slot(row, declaredType, missing)}${
      row.address
        ? html`<span class="ref" title=${missing?.why ?? WHY_RESOLVED(row.address)}
            >&rarr; ${row.address}</span
          >`
        : ''
    }`;
  }

  /** What leads the row: nothing when open, why not where there is no object,
   *  else the object's class and the log's own text. */
  private _slot(
    row: Valued,
    declaredType: string | null,
    missing: Missing | null,
  ): TemplateResult | string {
    if (row.open) {
      return '';
    }
    if (missing) {
      return html`<span class="missing" title=${missing.why}>${missing.text}</span>`;
    }
    // Left out where it matches the declared type: the type column says it.
    const className = row.className && row.className !== declaredType ? row.className : null;
    // An object the log wrote as `{}` previews the parts it opens on, or the row
    // would read as empty while holding eight fields.
    const shows = row.assembled ?? row.value;
    return html`<span
      class="value"
      title=${`${className ? `${className} ` : ''}${previewOf(shows, RAW_CLAMP_CHARS)}`}
      >${
        className ? html`<span class="cls">${lastSegment(className)}</span> ` : ''
      }${previewOf(shows)}</span
    >`;
  }

  /**
   * Why a row shows no object, or null where it shows one.
   *
   * The address is only the identity the runtime printed for the reference. The
   * object's contents reach the log as a separate event, and only where Apex
   * assigned that object to a variable it could serialise. That event may land
   * after the frame the reader picked, and often far from it, so the frame that
   * holds it is named.
   */
  private _missing(row: Valued): Missing | null {
    // The log wrote no value for the whole object and still recorded its parts,
    // which are what the row shows: saying it holds nothing would be false.
    if (row.address === null || row.resolved || row.assembled) {
      return null;
    }
    if (row.laterAt === null) {
      return {
        text: 'no value recorded',
        why: 'The log holds no value for this address, at any point.',
      };
    }
    const stack = this.logStore?.stackByEventIndex(row.laterAt) ?? [];
    const where = stack[stack.length - 1]?.text;
    return {
      text: 'recorded later',
      why: `The log describes this object after this frame${where ? `, in ${where}` : ''}, so it may differ from the value here.`,
    };
  }

  private _pick(row: VariableTreeRow): void {
    if (row.kind === 'note') {
      return;
    }
    this._focused = row.id;
    // A picked value holds its mark while the pointer is elsewhere. No
    // selection rides with it, so the panel keeps comparing: every other
    // section answers a merged row with aggregated figures, and dropping onto
    // one of its calls would throw away the reading the reader came for.
    if (row.kind === 'spread-value') {
      dispatchInspectorLocate(this, row.held.at, true);
    }
    if (row.expandable) {
      this._toggle(row.id, !row.open);
    }
  }

  /** The calls a value row stands for, marked in the tab while the pointer is
   *  over it. Nothing is selected and no section changes. */
  private _hover(row: VariableTreeRow, over: boolean): void {
    if (row.kind === 'spread-value') {
      dispatchInspectorLocate(this, over ? row.held.at : []);
    }
  }

  /** The tree keyboard pattern: the arrows walk and open, nothing tabs away. */
  private _onKeyDown(event: KeyboardEvent): void {
    const rows = this._rows;
    // Nothing focused yet means the tab stop is on the first row, so a key moves
    // from there rather than spending itself arriving.
    const at = (this._focused !== null ? this._at.get(this._focused) : undefined) ?? 0;
    const row = rows[at];
    if (!row) {
      return;
    }
    // A note is read, never focused: it carries no tabindex, so landing the
    // tab stop on one would leave the tree with none at all.
    const move = (to: number): void => {
      const found = nearestFocusable(rows, to, to >= at ? 1 : -1);
      if (found) {
        this._focused = found.id;
        this._takeFocus = true;
      }
    };

    switch (event.key) {
      case 'ArrowDown':
        move(at + 1);
        break;
      case 'ArrowUp':
        move(at - 1);
        break;
      case 'ArrowRight':
        // Open what is closed, then step into what is already open.
        if (row.expandable && !row.open) {
          this._toggle(row.id, true);
        } else if (row.expandable) {
          move(at + 1);
        }
        break;
      case 'ArrowLeft':
        // Close what is open, then step out to what holds it.
        if (row.expandable && row.open) {
          this._toggle(row.id, false);
        } else {
          const above = parentOf(rows, at);
          if (above >= 0) {
            move(above);
          }
        }
        break;
      case 'Home':
        move(0);
        break;
      case 'End':
        move(rows.length - 1);
        break;
      case 'Enter':
      case ' ':
        // What a click does: mark the calls that held the value, and open the
        // row where it opens. A value is often a scalar with nothing to open,
        // so toggling alone leaves the mark out of a keyboard's reach.
        // Fires once: a repeat would flap an expandable row open and shut.
        if (!event.repeat) {
          this._pick(row);
        }
        break;
      case '*':
        // Fires once: every row at this depth is open after the first press.
        if (!event.repeat) {
          this._openAll(row.depth);
        }
        break;
      default:
        return;
    }
    event.preventDefault();
    event.stopPropagation();
  }

  /** Opens every row at one depth, which is what `*` means in a tree. */
  private _openAll(depth: number): void {
    const next = new Map(this._disclosure);
    for (const row of this._rows) {
      if (row.expandable && row.depth === depth) {
        next.set(row.id, true);
      }
    }
    this._disclosure = next;
  }

  private _toggle(id: string, open: boolean): void {
    const next = new Map(this._disclosure);
    next.set(id, open);
    this._disclosure = next;
    this._focused = id;
    this._takeFocus = true;
  }
}

/**
 * The nearest row to `to` that can hold the tab stop, walking `step` first and
 * the far end of the list only if that runs out.
 *
 * A note is read, never focused: it carries no tabindex, so a move that lands
 * on one would leave the tree with no tab stop at all.
 */
function nearestFocusable(
  rows: readonly VariableTreeRow[],
  to: number,
  step: 1 | -1,
): VariableTreeRow | undefined {
  const clamped = Math.max(0, Math.min(rows.length - 1, to));
  for (let at = clamped; at >= 0 && at < rows.length; at += step) {
    if (rows[at]!.kind !== 'note') {
      return rows[at];
    }
  }
  for (let at = step > 0 ? rows.length - 1 : 0; at >= 0 && at < rows.length; at -= step) {
    if (rows[at]!.kind !== 'note') {
      return rows[at];
    }
  }
  return undefined;
}

const CHEVRON = html`<vscode-icon class="chevron" name="chevron-right"></vscode-icon>`;

/** Why a row shows no object: what it reads, and the sentence behind it. */
interface Missing {
  text: string;
  why: string;
}

/**
 * Whether a value was a phase the calls passed through or one that came and
 * went.
 *
 * Counts alone mislead: 328 of 340 calls reads as noise, and if those 328 are
 * one unbroken run it is a state the calls were in. One call is trivially one
 * run, so it says nothing.
 */
function runsChip(value: SpreadValue): TemplateResult | string {
  if (value.calls < 2) {
    return '';
  }
  return value.runs === 1
    ? html`<span class="chip" title="Consecutive calls, so this was a phase rather than noise"
        >one run</span
      >`
    : html`<span class="chip" title="Runs of consecutive calls that held it"
        >${value.runs} runs</span
      >`;
}

/** A call count as prose. The same shape `SelfTimeSpreadView` uses, which is
 *  where a shared `plural` helper would live if a third caller wants one. */
const callsHeld = (calls: number): string =>
  calls === 1 ? '1 call' : `${formatInteger(calls)} calls`;

/** The declared type, in its own column, where the log gave one. */
function typeColumn(declaredType: string | null): TemplateResult | string {
  return declaredType ? html`<span class="type" title=${declaredType}>${declaredType}</span>` : '';
}

/** How many parts the row opens into, on every row that opens into parts, as a
 *  group row already carries. */
function partCount(row: Shown & { expandable: boolean }): TemplateResult | string {
  // A cycle, or the depth bound, leaves a row that cannot open: a count would
  // promise rows the tree will not give.
  if (!row.expandable || !row.parts.length) {
    return '';
  }
  // Assembled from writes of their own, or written on this line: the reader is
  // owed the difference, since only the first can be as this frame stood.
  const title = row.assembled
    ? 'Fields the log recorded for this object, with any keys its own value held.'
    : 'Properties the log wrote for this value.';
  return html`<span class="count" title=${title}>${row.parts.length}</span>`;
}

/** A qualified class as its own name: the row has no width for the namespace,
 *  and the hover carries it whole. */
function lastSegment(className: string): string {
  return className.slice(className.lastIndexOf('.') + 1);
}

/** A name holds a value whose mark names fewer calls than held it. */
function partlyMarked(row: VariableSpread): boolean {
  return row.values.some((value) => value.at.length < value.calls);
}

/** The frame or a caller ran past the end of a truncated log. Shared: it is the
 *  same fact at either scope. */
const TRUNCATED_NOTE =
  'The log is truncated here, so a write may be unrecorded rather than absent.';

/** The index dropped writes past a cap, so an answer may be short of what the
 *  log recorded. Shared: it is the same fact at either scope. */
const HELD_NOTE = 'Too many assignments to hold them all, so some values are missing.';

/** A comparison reads each value at the point its first call stood, so an
 *  object it opens is that one call's reading. */
const RESOLVED_NOTE =
  'An object is shown as the first call that held it recorded it, so another call may have held a different one.';

/** Why a merged row's comparison stops at the locals and the fields. */
export const STATICS_NOTE =
  'Statics are not compared: a static lives for the whole transaction, so it moves for reasons this row does not own.';

const WHY_RESOLVED = (address: string): string =>
  `The log wrote no value here. This is what it recorded for ${address}.`;

function note(text: string): TemplateResult {
  return html`<p class="note">${text}</p>`;
}

/** What the log said about a value that its text alone does not show. */
function chipFor(value: VariableValue): TemplateResult | string {
  // Read out of a string, so the rows below are not what the log serialised.
  if (value.kind === 'container' && value.fromString) {
    return html`<span class="chip" title="A string holding JSON, shown as the object it holds"
      >json</span
    >`;
  }
  if (value.kind === 'string' && value.toStringLike) {
    return html`<span class="chip" title="Text: an Apex toString(), not an object">toString</span>`;
  }
  if (value.kind === 'string' && value.truncated) {
    return html`<span class="chip">truncated</span>`;
  }
  return '';
}

declare global {
  interface HTMLElementTagNameMap {
    'variables-detail': VariablesDetail;
  }
}
