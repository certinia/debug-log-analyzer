/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import {
  type ApexLog,
  eventType,
  type ObjectState,
  type Variable,
} from '@apexdevtools/apex-log-parser';

import type { Derivation, LogStore } from './LogStore.js';

/**
 * What Apex could reach from a frame, read from what the log recorded.
 *
 * Everything in scope, not only what the frame itself wrote:
 *
 * - **Local** — the frame's own writes, plus the locals it declared and never
 *   assigned, which are in scope at their default.
 * - **this** — the fields of the instance, from every write against its object.
 * - **Static** — every static assigned anywhere by this point, plus those
 *   declared and never assigned. A static lives for the transaction.
 *
 * A calling frame's *locals* stay out: they are on the stack but out of scope
 * from a called method.
 *
 * Every value is the last write at or before the event, so it reads as the frame
 * saw it. The parser reads the variable lines; this shapes its answer for the
 * Variables section.
 */

/** One variable, as it stood at the frame. */
export interface VariableRow {
  /** What the row is called: bare for a local, the field name under `this`, the
   *  field name under its class for a static. */
  name: string;
  /** The value exactly as the log wrote it, empty where it wrote none. */
  value: string;
  declaredType: string | null;
  /** Where the log said the value lives, where it wrote an address in place of a
   *  value. Resolved by {@link IndexView.resolve}, never here. */
  address: string | null;
  /** False where the log declared the name and never wrote it: it is in scope at
   *  its default, and the log records no value for it. */
  assigned: boolean;
  /** The address of the object this row's value *is*, where the log named one.
   *  A `this.field` line reports the object the field belongs to instead, so it
   *  contributes none. */
  objectAddress: string | null;
}

/** What the log holds for one address, as it stood at `readAt`. */
export interface AddressState {
  /** The value the log wrote for it at or before `readAt`, or null. */
  text: string | null;
  /** Event id of the first write after `readAt` that states the value, when none at
   *  or before it does; else null. */
  laterWriteId: number | null;
}

/** The log holds nothing for the address, at any point. */
export const NOT_RECORDED: AddressState = { text: null, laterWriteId: null };

/** One class's statics, since every static the log names is class-qualified. */
export interface StaticClass {
  className: string;
  rows: VariableRow[];
}

export interface FrameVariables {
  /** The frame these belong to, as the call tree names it. */
  frameLabel: string;
  /** The event these were read at, so a reader resolving an address asks for the
   *  value as it stood here. */
  readAt: number;
  /** The class owning the fields: the type `this` was declared as, else the class the frame names. */
  thisType: string | null;
  locals: VariableRow[];
  /** The object the frame runs on, where the log wrote it. Its own row, not a
   *  local: `this` is the instance, and the fields below it are its parts. */
  thisRow: VariableRow | null;
  fields: VariableRow[];
  statics: StaticClass[];
  /** The frame or one of its callers ran past the end of a truncated log, so a
   *  missing write may be unrecorded rather than absent. */
  truncated: boolean;
}

/** What the log says about objects by address, as any event stood. */
export class VariableIndex {
  /** The log recorded at least one write, so an empty answer means an empty
   *  scope rather than a log that records nothing. */
  readonly sawAnyWrite: boolean;

  private readonly log: ApexLog;

  constructor(log: ApexLog) {
    this.log = log;
    this.sawAnyWrite = hasAnyWrite(log);
  }

  /**
   * The lookups an address needs, bound to event `readAt`. A tree row asks about the
   * same address many times as it renders, so each answer is held.
   */
  viewAt(readAt: number): IndexView {
    const event = this.log.event(readAt);
    const objects = new Map<string, ObjectState | null>();
    const objectAt = (address: string): ObjectState | null => {
      let held = objects.get(address);
      if (held === undefined) {
        held = event?.objectAt(address) ?? null;
        objects.set(address, held);
      }
      return held;
    };
    const fields = new Map<string, readonly VariableRow[]>();
    return {
      resolve: (address) => {
        const object = objectAt(address);
        return object
          ? { text: object.value, laterWriteId: object.laterWrite?.id ?? null }
          : NOT_RECORDED;
      },
      classOf: (address) => objectAt(address)?.className ?? null,
      fields: (address) => {
        let held = fields.get(address);
        if (!held) {
          held = (objectAt(address)?.fields ?? []).map(rowOf);
          fields.set(address, held);
        }
        return held;
      },
    };
  }
}

/** What a reader asks the log about an address, bound to one point in it. */
export interface IndexView {
  resolve(address: string): AddressState;
  classOf(address: string): string | null;
  fields(address: string): readonly VariableRow[];
}

/** What a caller wants left out of a read. */
export interface FrameReadOptions {
  /** False to leave the statics unread, for a caller that does not compare them. */
  statics?: boolean;
}

/**
 * What is in scope at `eventId`, or null where the shown log has no such
 * event, it sits in no frame, or the log records no variables.
 */
export function frameVariablesFor(
  store: LogStore,
  eventId: number,
  options: FrameReadOptions = {},
): FrameVariables | null {
  const variables = store.eventById(eventId)?.variables;
  if (!variables) {
    return null;
  }
  // Not always the frame the selection sits in: a query answers from the Apex
  // frame that built it, as the parser picks it.
  const scope = variables.frame;
  const frameLabel = scope.text ?? scope.type;
  return {
    frameLabel,
    readAt: eventId,
    thisType:
      variables.this?.type ??
      (scope.type === 'CONSTRUCTOR_ENTRY' ? scope.field('className') : classFromFrame(frameLabel)),
    locals: variables.locals.map(rowOf),
    thisRow: variables.this && rowOf(variables.this),
    fields: variables.fields.map(rowOf),
    statics:
      options.statics === false
        ? []
        : variables.statics.map((group) => ({
            className: group.className,
            rows: group.variables.map(rowOf),
          })),
    truncated: ranPastEnd(store, eventId),
  };
}

/**
 * The variable index for the log.
 *
 * Derived on the first ask rather than at load: a 100MB log must not pay for a
 * section nobody opened.
 */
export const variableIndex: Derivation<VariableIndex> = (_index, store) =>
  new VariableIndex(store.log);

function rowOf(variable: Variable): VariableRow {
  // A value the log could not serialise is written as the bare address it lives at.
  const bare = variable.value !== null && variable.value === variable.address;
  return {
    name: variable.name,
    value: variable.value ?? '',
    declaredType: variable.type,
    address: bare ? variable.address : null,
    assigned: variable.write !== null,
    objectAddress: bare ? null : variable.address,
  };
}

function hasAnyWrite(log: ApexLog): boolean {
  const assignment = eventType('VARIABLE_ASSIGNMENT').typeId;
  // A native scan: a log with no writes reads every event, and a JS loop here ran 5× slower.
  return log.columns.type.subarray(1, log.eventCount + 1).indexOf(assignment) !== -1;
}

/** Event `id` or a frame above it ended only because the log did. */
function ranPastEnd(store: LogStore, id: number): boolean {
  const { endedBy } = store.log.columns;
  for (let at = id; at > 0; at = store.parentOf(at)) {
    if (endedBy.at(at) === 'log-end') {
      return true;
    }
  }
  return false;
}

/** The class from a frame's own name, or null where its name gives none. */
function classFromFrame(label: string): string | null {
  const paren = label.indexOf('(');
  const call = (paren < 0 ? label : label.slice(0, paren)).trim();
  const lastDot = call.lastIndexOf('.');
  return lastDot > 0 ? call.slice(0, lastDot) : null;
}
