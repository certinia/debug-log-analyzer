/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import type { ApexLog, LogEvent } from 'apex-log-parser';
import { LitElement, html, type PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';

import { LogLoadedController } from '../core/events/LogLoadedController.js';
import { waitForNextFrame } from '../core/utility/FrameBudget.js';
import { DatabaseAccess } from '../features/database/services/Database.js';
import { globalStyles } from '../styles/global.styles.js';
import { inspectorSectionStyles } from '../styles/inspectorSection.styles.js';
import { segmentsWithTail } from './StackedTimeBar.js';
import './StackedTimeBar.js';
import {
  NAMESPACE_COLORS,
  cachedNamespaceSelfTimes,
  logNamespacePalette,
  scopedNamespaceSelfTimes,
  type NamespaceTime,
} from './namespaceTime.js';

/** Namespaces are few, so the whole scale fits; the cap only guards a log that
 *  somehow holds more than the palette does. */
const MAX_SEGMENTS = NAMESPACE_COLORS.length;

/** No scope resolved yet, so the first null scope still reads as a change. */
const UNRESOLVED = Symbol('unresolved scope');

/** The scope to add up: the roots to walk, and the object the walk is memoised on. */
interface Scope {
  log: ApexLog;
  key: object;
  roots: readonly LogEvent[];
}

/**
 * Self time split by the namespace whose code ran it: whose package burned the
 * time, which no grid says. Self time, so every nanosecond lands in exactly one
 * namespace.
 *
 * Whole log with no `eventIndex`, otherwise the selected frame and everything
 * below it, so the same section answers "and inside this method?".
 *
 * One namespace still gets its bar: that a scope mixes no packages is an answer,
 * and the full bar with its figure says it.
 */
@customElement('namespace-time-bar')
export class NamespaceTimeBar extends LitElement {
  /** The frame to scope to, with its descendants. Below zero: the whole log. */
  @property({ type: Number })
  eventIndex = -1;

  /** Every occurrence of an aggregated row, summed as one scope. */
  @property({ attribute: false })
  instances: number[] | null = null;

  /** The scope's slices, or null while the walk is still running. */
  @state()
  private _slices: NamespaceTime[] | null = null;

  /** A new log invalidates the scope, so the next render walks again. */
  private readonly _logLoaded = new LogLoadedController(this, () => {
    this._scopeKey = UNRESOLVED;
    this._slices = null;
    this.requestUpdate();
  });

  /** The scope `_slices` describes, so a render for any other reason does not
   *  walk again, and a new log or selection does. */
  private _scopeKey: object | null | typeof UNRESOLVED = UNRESOLVED;

  /** Bumped per walk; a walk whose epoch has moved on drops its result. */
  private _walkEpoch = 0;

  /** The log's palette, so a namespace keeps its colour across scopes. Null until
   *  a scope resolves, which needs a log. */
  private _color: ((namespace: string) => string) | null = null;

  static styles = [globalStyles, inspectorSectionStyles];

  render() {
    const slices = this._slices;
    if (!slices) {
      return html`<p class="note">Adding up the self time…</p>`;
    }
    const color = this._color;
    if (!slices.length || !color) {
      return html`<p class="note">No time was recorded here.</p>`;
    }
    const segments = segmentsWithTail(
      slices,
      MAX_SEGMENTS,
      (slice) => ({
        label: slice.namespace,
        timeNs: slice.selfTime,
        color: color(slice.namespace),
      }),
      (slice) => slice.selfTime,
    );

    return html`<stacked-time-bar
      legend
      label="Self time by namespace"
      .segments=${segments}
    ></stacked-time-bar>`;
  }

  protected updated(changed: PropertyValues): void {
    // Resolving a scope maps every instance index, so only a changed selection —
    // or a scope we have yet to resolve — earns the walk.
    if (changed.has('eventIndex') || changed.has('instances') || this._scopeKey === UNRESOLVED) {
      void this._addUp();
    }
  }

  /** Walks the scope in frame-sized slices, so a scope near the log's root never
   *  blocks the panel, and abandons a walk the selection has moved past. */
  private async _addUp(): Promise<void> {
    const scope = this._scope();
    if ((scope?.key ?? null) === this._scopeKey) {
      return;
    }
    this._scopeKey = scope?.key ?? null;
    const epoch = ++this._walkEpoch;
    if (!scope) {
      this._slices = [];
      return;
    }
    this._color = logNamespacePalette(scope.log);
    // A scope walked before answers now, so a re-selection shows no placeholder.
    this._slices = cachedNamespaceSelfTimes(scope.key) ?? null;
    if (this._slices) {
      return;
    }
    const slices = await scopedNamespaceSelfTimes(scope.key, scope.roots, {
      yieldFrame: waitForNextFrame,
      cancelled: () => epoch !== this._walkEpoch || !this.isConnected,
    });
    if (epoch !== this._walkEpoch) {
      return;
    }
    if (slices) {
      this._slices = slices;
    } else {
      // Abandoned while the scope still stands — a disconnected host. Forget the
      // key, so a later render walks it again instead of waiting on a dead walk.
      this._scopeKey = UNRESOLVED;
    }
  }

  private _scope(): Scope | null {
    const database = DatabaseAccess.instance();
    const log = database?.getApexLog();
    if (!database || !log) {
      return null;
    }
    const instances = this.instances?.length ? this.instances : null;
    const indexes = instances ?? (this.eventIndex >= 0 ? [this.eventIndex] : null);
    if (!indexes) {
      return { log, key: log, roots: log.children };
    }
    const roots = indexes
      .map((index) => database.getEventByIndex(index))
      .filter((event): event is LogEvent => event !== null);
    const [first] = roots;
    if (!first) {
      return null;
    }
    return { log, key: instances ?? first, roots };
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'namespace-time-bar': NamespaceTimeBar;
  }
}
