/*
 * Copyright (c) 2026 Certinia Inc. All rights reserved.
 */
import { LOG_LEVEL, type ApexLog, type LogEvent } from 'apex-log-parser';

import {
  CHECK_EVERY,
  frameBudget,
  type FrameBudgetOptions,
  type Tick,
} from '../utility/FrameBudget.js';
import type { LogStore, Stack } from './LogStore.js';
import {
  bareAddress,
  bareAddressOf,
  classOf,
  isFieldName,
  isStaticName,
  parseVariableScope,
  nestedAddressesOf,
  parseVariableWrite,
  reportedAddressOf,
  shortName,
  variableNameOf,
} from './variableLine.js';

/**
 * What Apex could reach from a frame, read from what the log recorded.
 *
 * Everything in scope, not only what the frame itself wrote:
 *
 * - **Local** — the frame's own writes, plus the locals it declared and never
 *   assigned, which are in scope at their default.
 * - **this** — the fields of the instance, gathered from every frame on the
 *   stack that shares the frame's class, since those share its `this`.
 * - **Static** — every static assigned anywhere by this point, plus those
 *   declared and never assigned. A static lives for the transaction.
 *
 * A calling frame's *locals* stay out: they are on the stack but out of scope
 * from a called method.
 *
 * Every value is the last write at or before the frame's cut point, so it reads
 * as the frame saw it.
 */

const ASSIGNMENT = 'VARIABLE_ASSIGNMENT';
const SCOPE_BEGIN = 'VARIABLE_SCOPE_BEGIN';
const CONSTRUCTOR_ENTRY = 'CONSTRUCTOR_ENTRY';

/**
 * Writes held per static name before the oldest is dropped, so a static
 * reassigned in a long loop cannot grow the index without bound.
 *
 * Dropping the *oldest* keeps a late frame's reading correct, which is the
 * common case; a frame whose cut falls before every retained write for that
 * name reads it as unassigned, which is the honest answer once its history is
 * gone. A real log holds at most a few thousand static lines in total, so this
 * is headroom, not a working limit.
 */
const MAX_WRITES_PER_STATIC = 10_000;

/** Distinct static names held. A codebase compiles a bounded number of static
 *  fields, so this only bites a pathological log. */
const MAX_STATIC_NAMES = 50_000;

/** Writes held per field of an object, dropping the oldest, as
 *  {@link MAX_WRITES_PER_STATIC} does for a static. Per field, not per object:
 *  one field written in a long loop must not evict the rest of the object. */
const MAX_WRITES_PER_FIELD = 2_000;

/** Distinct objects whose fields are held. */
const MAX_FIELD_OWNERS = 100_000;

/** One variable, as it stood at the frame. */
export interface VariableRow {
  /** What the row is called: bare for a local, the field name under `this`, the
   *  field name under its class for a static. */
  name: string;
  /** The value exactly as the log wrote it, empty where it wrote none. */
  value: string;
  declaredType: string | null;
  /** Where the log said the value lives, where it wrote an address in place of a
   *  value. Resolved by {@link VariableIndex.addressState}, never here. */
  address: string | null;
  /** False where the log declared the name and never wrote it: it is in scope at
   *  its default, and the log records no value for it. */
  assigned: boolean;
  /** The address of the object this row's value *is*, where the log named one.
   *  A `this.field` line reports the object the field belongs to instead, so it
   *  contributes none. */
  objectAddress: string | null;
}

/** What a whole-log walk takes.
 *
 *  Not the full {@link FrameBudgetOptions}: the walk cannot be abandoned, so it
 *  must not advertise a signal it would ignore. */
type WalkOptions = Pick<FrameBudgetOptions, 'yieldSlice'>;

/** What the log holds for one address, as a frame stood. */
export interface AddressState {
  /** The value the log wrote for it at or before the frame, or null. */
  text: string | null;
  /** Where the log first describes the object after the frame, so the reader can
   *  be sent to it. Null where the log describes it nowhere. */
  laterAt: number | null;
}

/** The log holds nothing for the address, at any point. */
export const NOT_RECORDED: AddressState = { text: null, laterAt: null };

/** One class's statics, since every static the log names is class-qualified. */
export interface StaticClass {
  className: string;
  rows: VariableRow[];
}

export interface FrameVariables {
  /** The frame these belong to, as the call tree names it. */
  frameLabel: string;
  /** The point on the eventIndex axis these were read at, so a reader resolving
   *  an address asks for the value as it stood here. */
  cut: number;
  /** The class owning the fields, where the frame's own name gives it. */
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

/** A declaration the log made, and where it made it. */
interface Declared {
  declaredType: string;
  eventIndex: number;
}

/** The Apex Code log level this log was captured at, or null if it says none. */
export function apexCodeLevel(log: ApexLog): string | null {
  return log.debugLevels.find((level) => level.logCategory === 'APEX_CODE')?.logLevel ?? null;
}

/** True where the log was captured at the only level that records variables. */
export function recordsVariables(log: ApexLog): boolean {
  return apexCodeLevel(log) === LOG_LEVEL.Finest;
}

/**
 * What the log says about variables, indexed so any frame is answered by a
 * search rather than a walk.
 *
 * Holds the two things the log only gives up at log scope:
 *
 * - **Statics.** A static lives for the whole transaction and is visible
 *   wherever its class is. A local cannot be indexed the same way: the log never
 *   emits `VARIABLE_SCOPE_END`, so two locals of one name in different blocks
 *   cannot be told apart outside their own frame.
 * - **Addresses.** Where a value would not serialise the log writes a bare
 *   address, and reports that same address beside a real value elsewhere. Nearly
 *   every bare address resolves that way, which turns unreadable hex into the
 *   object.
 *   A `this.field` line is no such witness: its reported address is the object
 *   the field belongs to, not the value the line wrote.
 * - **An object's fields.** That same owner address groups the writes to one
 *   object's fields, wherever they were made. A frame's own stack cannot see a
 *   constructor that has already returned; the index can.
 */
export class VariableIndex {
  /** The log recorded at least one write, so an empty answer means an empty
   *  scope rather than a log that records nothing. */
  readonly sawAnyWrite: boolean;
  /** A name or an object went unrecorded past its cap, so an answer may be
   *  missing something the log did record. */
  readonly capped: boolean;

  private readonly _writes: Map<string, LogEvent[]>;
  private readonly _declared: Map<string, Declared>;
  private readonly _byAddress: Map<string, LogEvent[]>;
  private readonly _classes: Map<string, ClassAt[]>;
  private readonly _fieldsByOwner: Map<string, Map<string, LogEvent[]>>;

  private constructor(
    writes: Map<string, LogEvent[]>,
    declared: Map<string, Declared>,
    byAddress: Map<string, LogEvent[]>,
    classes: Map<string, ClassAt[]>,
    fieldsByOwner: Map<string, Map<string, LogEvent[]>>,
    sawAnyWrite: boolean,
    capped: boolean,
  ) {
    this._writes = writes;
    this._declared = declared;
    this._byAddress = byAddress;
    this._classes = classes;
    this._fieldsByOwner = fieldsByOwner;
    this.sawAnyWrite = sawAnyWrite;
    this.capped = capped;
  }

  /** Reads the log, yielding between slices so the UI keeps its frames. */
  static async build(log: ApexLog, options: WalkOptions): Promise<VariableIndex> {
    const tick = frameBudget(options);
    const writes = new Map<string, LogEvent[]>();
    const declared = new Map<string, Declared>();
    // Only the addresses a value is ever written *as*. Every assignment reports
    // an address, so indexing all of them would hold a quarter of a million
    // events to answer about two thousand.
    const wanted = new Set<string>();
    // Address to the class of the object living there. A frame declares its own
    // object as `this`, so a `this` write names the class the address holds.
    const classes = new Map<string, ClassAt[]>();
    // The class a frame's own `VARIABLE_SCOPE_BEGIN|this|…` declared, keyed by
    // that frame. Walk-wide and keyed by name alone would leak: `this` is not
    // redeclared on every call, so a frame with no declaration of its own would
    // otherwise borrow whichever class was declared last, anywhere in the log.
    const thisClassOf = new Map<LogEvent, string>();
    // Owner address to that object's fields, each name to its own writes.
    const fieldsByOwner = new Map<string, Map<string, LogEvent[]>>();
    let sawAnyWrite = false;
    let dropped = false;

    await eachEvent(log, tick, (event) => {
      if (event.type === ASSIGNMENT) {
        sawAnyWrite = true;
        // The name only: the value is read when a row renders it.
        const name = variableNameOf(event.logLine);
        if (name && isStaticName(name)) {
          if (writes.has(name) || writes.size < MAX_STATIC_NAMES) {
            pushCapped(writes, name, event, MAX_WRITES_PER_STATIC);
          } else {
            dropped = true;
          }
        }
        // The trailing address on a field write is the object the field belongs
        // to, so it gathers that object's fields however far apart they were set.
        const owner = name && isFieldName(name) ? reportedAddressOf(event.logLine) : null;
        if (owner && name) {
          let held = fieldsByOwner.get(owner);
          if (!held && fieldsByOwner.size < MAX_FIELD_OWNERS) {
            held = new Map();
            fieldsByOwner.set(owner, held);
          }
          if (held) {
            pushCapped(held, name, event, MAX_WRITES_PER_FIELD);
          } else {
            dropped = true;
          }
        }
        if (name === 'this') {
          const frame = event.parent;
          const thisClass = frame && thisClassOf.get(frame);
          const object = thisClass && reportedAddressOf(event.logLine);
          if (frame && object) {
            keepClass(classes, object, thisClass, {
              at: event.eventIndex,
              until: lastDescendantIndex(frame),
              constructed: frame.type === CONSTRUCTOR_ENTRY,
            });
          }
        }
        const address = bareAddressOf(event.logLine);
        if (address) {
          wanted.add(address);
        } else {
          // An address named inside a value, such as a field holding a
          // reference.
          for (const nested of nestedAddressesOf(event.logLine)) {
            wanted.add(nested);
          }
        }
      } else if (event.type === SCOPE_BEGIN) {
        const scope = parseVariableScope(event.logLine);
        // The declared type of `this` is the concrete class, where the value's
        // own declared type is often only an interface.
        if (scope?.name === 'this' && scope.declaredType && event.parent) {
          thisClassOf.set(event.parent, scope.declaredType);
        }
        if (scope?.isStatic) {
          const first = declared.get(scope.name);
          // The earliest declaration: the point from which it is in scope.
          if (!first || first.eventIndex > event.eventIndex) {
            declared.set(scope.name, {
              declaredType: scope.declaredType,
              eventIndex: event.eventIndex,
            });
          }
        }
      }
    });

    const byAddress = new Map<string, LogEvent[]>();
    // A second read, and only where the first found an address to resolve.
    if (wanted.size) {
      await eachEvent(log, tick, (event) => {
        if (event.type !== ASSIGNMENT) {
          return;
        }
        // The reported address names the value only where the variable is that
        // value. A `this.field` line reports the *owner*, so one such address
        // usually carries two or more different values, and indexing it would
        // answer about an object with one of its fields.
        const name = variableNameOf(event.logLine);
        if (!name || isFieldName(name)) {
          return;
        }
        const address = reportedAddressOf(event.logLine);
        // A line whose value *is* the address tells us nothing about it.
        if (address && wanted.has(address) && !bareAddressOf(event.logLine)) {
          push(byAddress, address, event);
        }
      });
    }

    // Every read below searches by eventIndex, so every list has to be in it.
    const byIndex = (left: LogEvent, right: LogEvent): number => left.eventIndex - right.eventIndex;
    for (const found of [...writes.values(), ...byAddress.values()]) {
      found.sort(byIndex);
    }
    for (const fields of fieldsByOwner.values()) {
      for (const found of fields.values()) {
        found.sort(byIndex);
      }
    }
    return new VariableIndex(
      writes,
      declared,
      byAddress,
      classes,
      fieldsByOwner,
      sawAnyWrite,
      dropped,
    );
  }

  /**
   * Every static in scope at `cut`, grouped by class, both sorted.
   *
   * A static declared by this point but never assigned is in scope at its
   * default, so it is listed without a value rather than left out.
   */
  at(cut: number): StaticClass[] {
    const byClass = new Map<string, VariableRow[]>();
    const listed = new Set<string>();
    const add = (name: string, row: VariableRow): void => {
      listed.add(name);
      push(byClass, classOf(name) ?? '', row);
    };

    for (const [name, writes] of this._writes) {
      const last = lastAtOrBefore(writes, cut);
      if (last) {
        add(
          name,
          rowFor(shortName(name), last, this._declared.get(name), reportedAddressOf(last.logLine)),
        );
      }
    }
    for (const [name, declared] of this._declared) {
      if (!listed.has(name) && declared.eventIndex <= cut) {
        add(name, unassignedRow(shortName(name), declared));
      }
    }
    return [...byClass]
      .map(([className, rows]) => ({ className, rows: rows.sort(byName) }))
      .sort((left, right) => left.className.localeCompare(right.className));
  }

  /**
   * What the log holds for `address` as the frame stood.
   *
   * The address is only the identity the runtime printed for the reference. The
   * object's contents are a separate event, and reach the log only where Apex
   * assigned that object to a variable and could serialise it. So a log may hold
   * the contents from before the frame, from after it, or not at all.
   */
  addressState(address: string, cut: number): AddressState {
    const writes = this._byAddress.get(address);
    if (!writes?.length) {
      return NOT_RECORDED;
    }
    const last = lastAtOrBefore(writes, cut);
    return last
      ? { text: parseVariableWrite(last.logLine)?.value ?? null, laterAt: null }
      : { text: null, laterAt: writes[0]?.eventIndex ?? null };
  }

  /**
   * The class of the object at `address` as the frame stood, or null where the
   * log names none.
   *
   * More telling than the declared type: an interface-typed variable holding a
   * `WithoutSharing` reads as `fflib_IDatabaseWriter` in its declaration, and
   * the log records the implementation only on that object's own frame.
   */
  classAt(address: string, cut: number): string | null {
    return this._runAt(address, cut)?.run.className ?? null;
  }

  /** The class run covering `cut`, and how many objects the log saw at this
   *  address before it. One reader of the runs, so the class a row names and the
   *  fields it opens on cannot disagree about which object lived here. */
  private _runAt(address: string, cut: number): { run: ClassAt; before: number } | null {
    const seen = this._classes.get(address);
    if (!seen) {
      return null;
    }
    const after = firstIndexWhere(seen.length, (index) => seen[index]!.at > cut);
    return after ? { run: seen[after - 1]!, before: after - 1 } : null;
  }

  /**
   * The fields the log recorded for the object at `address`, as the frame stood.
   *
   * This is what lets a value the log wrote as `{}` open: the object's own line
   * carries no contents, but the writes to its fields are lines of their own.
   */
  fieldsAt(address: string, cut: number): VariableRow[] {
    return fieldRowsOf(this.fieldWritesAt(address, cut));
  }

  /** {@link fieldsAt} as the writes behind it, for a caller merging them with
   *  writes of its own. */
  fieldWritesAt(address: string, cut: number): Map<string, LogEvent> {
    const found = new Map<string, LogEvent>();
    const held = this._fieldsByOwner.get(address);
    if (!held) {
      return found;
    }
    const from = this._objectFrom(address, cut);
    for (const [name, writes] of held) {
      const last = lastAtOrBefore(writes, cut);
      // Before this object's own history: the field belonged to the object that
      // used this address before it.
      if (last && last.eventIndex >= from) {
        found.set(name, last);
      }
    }
    return found;
  }

  /**
   * Where this object's own history starts, for an address the log has seen hold
   * more than one object.
   *
   * Zero where it has not: a field write can precede the `this` write that names
   * the class, so bounding every object at its own run would drop it.
   */
  private _objectFrom(address: string, cut: number): number {
    const found = this._runAt(address, cut);
    return found && found.before > 0 ? found.run.at : 0;
  }

  /**
   * The lookups a reader needs at one point in the log, bound to that point.
   *
   * An object's fields are read for every row that shows it, and every row is
   * built again whenever anything opens, so a read is held rather than repeated.
   */
  viewAt(cut: number): IndexView {
    const fields = new Map<string, readonly VariableRow[]>();
    return {
      resolve: (address) => this.addressState(address, cut),
      classOf: (address) => this.classAt(address, cut),
      fields: (address) => {
        let held = fields.get(address);
        if (!held) {
          held = this.fieldsAt(address, cut);
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

/**
 * What is in scope at `eventIndex`, or null where the log has no such event or
 * it sits in no frame.
 *
 * Pass `index` as null to answer the frame alone, before the index is built.
 */
export function frameVariablesFor(
  store: LogStore,
  eventIndex: number,
  index: VariableIndex | null,
): FrameVariables | null {
  const selected = store.eventByIndex(eventIndex);
  const stack = store.stackByEventIndex(eventIndex);
  const frame = stack[stack.length - 1];
  if (!selected || !frame) {
    return null;
  }

  // The cut is on the eventIndex axis, never on a timestamp: real logs repeat
  // timestamps, so they order nothing. A frame reads as it finished, an event
  // inside one as the log reached it.
  const cut = selected.isParent ? lastDescendantIndex(selected) : selected.eventIndex;
  // Not always the frame the selection sits in: see `scopeFrame`.
  const { frame: scope, scan: own } = scopeFrame(stack, cut, frame);
  const thisType = classFromFrame(scope.text);

  const locals: VariableRow[] = [];
  let thisRow: VariableRow | null = null;
  for (const [name, write] of own.writes) {
    // A static assigned here is still a static, and the index answers for it.
    if (name !== 'this' && name.includes('.')) {
      continue;
    }
    const row = rowFor(name, write, own.declared.get(name), reportedAddressOf(write.logLine));
    // `this` is the instance the frame runs on, so it heads its own group.
    if (name === 'this') {
      thisRow = row;
    } else {
      locals.push(row);
    }
  }
  for (const [name, declared] of own.declared) {
    if (name !== 'this' && !own.writes.has(name)) {
      locals.push(unassignedRow(name, declared));
    }
  }

  // Two sources, one rule: the latest write to a field wins. The index finds
  // every write against the frame's object wherever it was made, so a field a
  // returned constructor set is in scope here; the stack walk finds the writes
  // whose line reported no address, which the index never sees.
  //
  // Every field of the object, not only the ones the frame's own class wrote: a
  // base method reads fields a base constructor set, and the log names no class
  // hierarchy to tell an inherited field from a subclass's own. So a base frame
  // can list a field only the subclass declares. Filtering by the writing
  // frame's class would lose the inherited case, which is the common one.
  const object = thisAddressOf(own.writes);
  const found = fieldWrites(stack, scope, own, thisType, cut);
  if (object && index) {
    for (const [name, write] of index.fieldWritesAt(object, cut)) {
      const held = found.get(name);
      if (!held || held.eventIndex < write.eventIndex) {
        found.set(name, write);
      }
    }
  }
  const fields = fieldRowsOf(found);

  return {
    frameLabel: scope.text,
    cut,
    thisType,
    locals: locals.sort(byName),
    thisRow,
    fields,
    statics: index?.at(cut) ?? [],
    truncated: stack.some((entry) => entry.isTruncated) || selected.isTruncated,
  };
}

const indexes = new WeakMap<ApexLog, VariableIndex>();
const building = new WeakMap<ApexLog, Promise<VariableIndex>>();

/**
 * The variable index for `log`, read once and then shared.
 *
 * Built on the first ask rather than at load: a 100MB log must not pay for a
 * section nobody opened.
 */
export function variableIndexFor(log: ApexLog, options: WalkOptions = {}): Promise<VariableIndex> {
  const held = indexes.get(log);
  if (held) {
    return Promise.resolve(held);
  }
  let inFlight = building.get(log);
  if (!inFlight) {
    inFlight = VariableIndex.build(log, options)
      .then((index) => {
        indexes.set(log, index);
        return index;
      })
      // A failed build must not be cached, or nothing would ever retry.
      .finally(() => building.delete(log));
    building.set(log, inFlight);
  }
  return inFlight;
}

/** What one frame wrote and declared, up to `cut`. */
interface FrameScan {
  /** Name to its last write at or before the cut. */
  writes: Map<string, LogEvent>;
  /** Name to its first declaration, for the locals the frame never assigned. */
  declared: Map<string, Declared>;
  /** The frame recorded a variable line of its own, so it owns a scope even
   *  where every line was a static the index answers for. */
  sawAny: boolean;
}

/**
 * Reads one frame's own lines back from `cut`.
 *
 * Backwards, so the first write seen for a name is the last one the frame made.
 * It reads names only: a value is parsed for the handful of rows that win, not
 * for every line, which matters in a frame holding a hundred thousand of them.
 */
function scanFrame(frame: LogEvent, cut: number): FrameScan {
  const writes = new Map<string, LogEvent>();
  const declared = new Map<string, Declared>();
  let sawAny = false;
  const children = frame.children;
  for (let at = firstIndexWhere(children.length, (i) => children[i]!.eventIndex > cut); at--;) {
    const child = children[at]!;
    if (child.type === ASSIGNMENT || child.type === SCOPE_BEGIN) {
      sawAny = true;
    }
    if (child.type === ASSIGNMENT) {
      const name = variableNameOf(child.logLine);
      if (name && !writes.has(name)) {
        writes.set(name, child);
      }
    } else if (child.type === SCOPE_BEGIN) {
      const scope = parseVariableScope(child.logLine);
      // Only a local: a static is in scope everywhere, so the index holds it.
      if (scope && !scope.isStatic) {
        declared.set(scope.name, {
          declaredType: scope.declaredType,
          eventIndex: child.eventIndex,
        });
      }
    }
  }
  return { writes, declared, sawAny };
}

/** Only the writes that answer for the object a frame runs on.
 *
 *  For a caller frame, whose locals are out of scope and whose declarations are
 *  never read: a frame can hold hundreds of thousands of children, so the rest
 *  is thrown away. */
function thisWritesOf(frame: LogEvent, cut: number): Map<string, LogEvent> {
  return lastWritesByName(frame.children, cut, (name) => name === 'this' || isFieldName(name));
}

/**
 * The last write to each name at or before `cut`, from events in eventIndex
 * order.
 *
 * Backwards from the cut, so the first write seen for a name is the last one
 * made.
 */
function lastWritesByName(
  events: readonly LogEvent[],
  cut: number,
  keep: (name: string) => boolean,
): Map<string, LogEvent> {
  const found = new Map<string, LogEvent>();
  for (let at = firstIndexWhere(events.length, (i) => events[i]!.eventIndex > cut); at--;) {
    const event = events[at]!;
    const name = event.type === ASSIGNMENT ? variableNameOf(event.logLine) : null;
    if (name && keep(name) && !found.has(name)) {
      found.set(name, event);
    }
  }
  return found;
}

/** Field writes as their rows, sorted, carrying the `objectAddress` a field row
 *  must always have: its line reports the owner, never its own value. */
function fieldRowsOf(writes: ReadonlyMap<string, LogEvent>): VariableRow[] {
  const rows: VariableRow[] = [];
  for (const [name, write] of writes) {
    rows.push(rowFor(shortName(name), write, undefined, null));
  }
  return rows.sort(byName);
}

/**
 * The frame whose locals are in scope at the selection.
 *
 * Not always the frame the selection sits in. A SOQL statement, a
 * `STATEMENT_EXECUTE` and a system call such as `Database.query(String)` are not
 * Apex code with locals of their own: they are issued *by* Apex code, and
 * answering from them would report an empty scope for a query built two lines
 * above it.
 *
 * So the nearest frame up the stack recording a variable of its own owns the
 * scope. The group names that frame, so which scope answered is never a guess.
 */
function scopeFrame(stack: Stack, cut: number, innermost: LogEvent): Scope {
  for (let at = stack.length; at--;) {
    const frame = stack[at];
    if (frame) {
      const scan = scanFrame(frame, cut);
      if (scan.sawAny) {
        return { frame, scan };
      }
    }
  }
  return { frame: innermost, scan: scanFrame(innermost, cut) };
}

/** The frame that owns the scope, and the read that found it. */
interface Scope {
  frame: LogEvent;
  scan: FrameScan;
}

/**
 * The instance fields in scope, from every frame on the stack running on the
 * same object.
 *
 * A method of class X has a `this` of class X, and a method it calls on the same
 * instance sees the same fields. So a field the constructor set and this frame
 * never touched is still in scope, and reading only this frame's own writes
 * would leave it out.
 *
 * The class alone does not settle it: a frame can run with another *instance* of
 * its own class on the stack, and merging those would
 * report one object's fields as another's. So where both frames name their
 * object, the addresses decide.
 */
function fieldWrites(
  stack: Stack,
  frame: LogEvent,
  own: FrameScan,
  thisType: string | null,
  cut: number,
): Map<string, LogEvent> {
  const found = new Map<string, LogEvent>();
  const mine = thisAddressOf(own.writes);
  for (const entry of stack) {
    if (classFromFrame(entry.text) !== thisType) {
      continue;
    }
    const writes = entry === frame ? own.writes : thisWritesOf(entry, cut);
    const theirs = thisAddressOf(writes);
    if (mine && theirs && mine !== theirs) {
      continue;
    }
    for (const [name, write] of writes) {
      if (!isFieldName(name)) {
        continue;
      }
      const held = found.get(name);
      // The latest write wins, whichever frame on the stack made it.
      if (!held || held.eventIndex < write.eventIndex) {
        found.set(name, write);
      }
    }
  }
  return found;
}

/**
 * The object a frame is running on, or null where the log never named it.
 *
 * Both a `this` write and a `this.field` write report the owning object's
 * address, so either answers.
 */
function thisAddressOf(writes: ReadonlyMap<string, LogEvent>): string | null {
  for (const [name, write] of writes) {
    if (name === 'this' || isFieldName(name)) {
      const address = reportedAddressOf(write.logLine);
      if (address) {
        return address;
      }
    }
  }
  return null;
}

/**
 * One row, from a write the caller already knows the shape of.
 *
 * `objectAddress` is the caller's call: a `this.field` line reports the field's
 * *owner*, never the field's own value, so a field row must always be built
 * with `null`. Deciding this inside `rowFor` from the row's own `name` was the
 * bug behind #373 review finding 1 — by the time a field's name reaches here it
 * has already been shortened to drop the `this.` that the decision needed.
 */
function rowFor(
  name: string,
  write: LogEvent,
  declared: Declared | undefined,
  objectAddress: string | null,
): VariableRow {
  const value = parseVariableWrite(write.logLine)?.value ?? '';
  return {
    name,
    value,
    declaredType: declared?.declaredType ?? null,
    address: bareAddress(value),
    assigned: true,
    objectAddress,
  };
}

/** One address, and the class of the object that lived there from `at` until the
 *  end of the frame that named it. */
interface ClassAt {
  at: number;
  until: number;
  className: string;
}

/** Where a `this` write named its class, and whether it was a construction. */
interface NamedAt {
  at: number;
  until: number;
  constructed: boolean;
}

/**
 * Records the class of the object at an address.
 *
 * Two rules keep the answer the object's own class rather than an ancestor:
 *
 * - a write inside a run already recorded adds nothing. A superclass
 *   constructor runs on the same object, inside the subclass constructor, and
 *   would otherwise overwrite the concrete class with its parent;
 * - only a construction may start a new run. A method declares `this` as the
 *   type it was compiled against, which can be an ancestor, so it names the
 *   class only for an object constructed outside the log.
 *
 * An address is reused once its object is collected, hence runs rather than one
 * class per address. A construction past the last run is always a new object,
 * even of the same class: merging those two runs would let a collected object's
 * fields read as the new one's.
 */
function keepClass(
  classes: Map<string, ClassAt[]>,
  address: string,
  className: string,
  named: NamedAt,
): void {
  const run = { at: named.at, until: named.until, className };
  const seen = classes.get(address);
  if (!seen) {
    classes.set(address, [run]);
    return;
  }
  const last = seen[seen.length - 1]!;
  if (named.at <= last.until || !named.constructed) {
    return;
  }
  seen.push(run);
}

/** A name the log declared and never wrote: in scope, at its default. */
function unassignedRow(name: string, declared: Declared): VariableRow {
  return {
    name,
    value: '',
    declaredType: declared.declaredType,
    address: null,
    assigned: false,
    objectAddress: null,
  };
}

/** Visits every event below `log`, handing the frame back between slices. */
async function eachEvent(
  log: ApexLog,
  tick: Tick,
  visit: (event: LogEvent) => void,
): Promise<void> {
  const stack = [...log.children].reverse();
  for (let walked = 0; stack.length; walked++) {
    if (walked % CHECK_EVERY === 0) {
      await tick();
    }
    const event = stack.pop()!; // non-empty: the loop condition just checked
    visit(event);
    // Pushed back to front, so popping hands them over in log order: a line's
    // meaning can depend on one above it, such as a declaration before a write.
    for (let at = event.children.length; at--;) {
      stack.push(event.children[at]!);
    }
  }
}

function push<T>(into: Map<string, T[]>, key: string, value: T): void {
  const found = into.get(key);
  if (found) {
    found.push(value);
  } else {
    into.set(key, [value]);
  }
}

/** {@link push}, dropping the oldest once a name holds more than `cap`.
 *
 *  Trims to `cap` only once the array reaches double it, so the cost of
 *  dropping amortises to O(1) a write rather than paying an array shift on
 *  every one past the cap. */
function pushCapped<T>(into: Map<string, T[]>, key: string, value: T, cap: number): void {
  push(into, key, value);
  const found = into.get(key)!;
  if (found.length > cap * 2) {
    found.splice(0, found.length - cap);
  }
}

/** The highest eventIndex in `event`'s subtree: where the frame finished. */
function lastDescendantIndex(event: LogEvent): number {
  let node = event;
  // Children are appended in log order, so the last one holds the last index.
  while (node.children.length) {
    node = node.children[node.children.length - 1]!;
  }
  return node.eventIndex;
}

/** The class from a frame's own name, or null where its name gives none. */
function classFromFrame(label: string): string | null {
  const paren = label.indexOf('(');
  const call = (paren < 0 ? label : label.slice(0, paren)).trim();
  const lastDot = call.lastIndexOf('.');
  return lastDot > 0 ? call.slice(0, lastDot) : null;
}

/** The last write at or before `cut`, or null where every write came after. */
function lastAtOrBefore(writes: readonly LogEvent[], cut: number): LogEvent | null {
  const after = firstIndexWhere(writes.length, (index) => writes[index]!.eventIndex > cut);
  return after > 0 ? (writes[after - 1] ?? null) : null;
}

/** The leftmost index below `length` where `holds` becomes true, or `length` if
 *  it never does. `holds` must be false then true across the run. */
function firstIndexWhere(length: number, holds: (index: number) => boolean): number {
  let low = 0;
  let high = length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (holds(mid)) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}

function byName(left: VariableRow, right: VariableRow): number {
  return left.name.localeCompare(right.name);
}
